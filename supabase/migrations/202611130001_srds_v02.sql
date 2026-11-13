begin;

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0)
);
create table public.school_members (
  school_id uuid references public.schools not null,
  user_id uuid references auth.users not null,
  role text not null check (role in ('teacher', 'admin')),
  primary key (school_id, user_id)
);
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools not null,
  name text not null check (length(trim(name)) > 0),
  category text not null check (category in ('Espaços', 'Equipamentos', 'Materiais')),
  quantity integer not null check (quantity > 0),
  active boolean not null default true,
  revision bigint not null default 0,
  unique (school_id, id)
);
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  resource_id uuid not null,
  user_id uuid not null,
  date date not null check (isfinite(date)),
  period integer not null check (period between 1 and 5),
  quantity integer not null check (quantity > 0),
  cancelled_at timestamptz,
  foreign key (school_id, resource_id) references public.resources (school_id, id),
  foreign key (school_id, user_id) references public.school_members (school_id, user_id)
);
create index reservations_active_slot on public.reservations (school_id, resource_id, date, period)
  where cancelled_at is null;
create index reservations_owner on public.reservations (user_id, school_id);
create index school_members_user on public.school_members (user_id);

alter table public.schools enable row level security;
alter table public.school_members enable row level security;
alter table public.resources enable row level security;
alter table public.reservations enable row level security;

revoke all on public.schools, public.school_members, public.resources, public.reservations
  from public, anon, authenticated;
grant select on public.schools, public.school_members, public.resources, public.reservations to authenticated;
grant insert (school_id, name, category, quantity), update (active) on public.resources to authenticated;

create policy own_memberships on public.school_members for select to authenticated
  using (user_id = (select auth.uid()));
create policy member_schools on public.schools for select to authenticated
  using (id in (select school_id from public.school_members));
create policy member_resources on public.resources for select to authenticated
  using (school_id in (select school_id from public.school_members));
create policy admin_insert on public.resources for insert to authenticated
  with check (school_id in (select school_id from public.school_members where role = 'admin'));
create policy admin_update on public.resources for update to authenticated
  using (school_id in (select school_id from public.school_members where role = 'admin'))
  with check (school_id in (select school_id from public.school_members where role = 'admin'));
create policy own_or_admin_reservations on public.reservations for select to authenticated
  using (school_id in (
    select school_id from public.school_members
    where role = 'admin' or reservations.user_id = (select auth.uid())
  ));

create function public.reserve_resource(
  p_school uuid, p_resource uuid, p_date date, p_period integer, p_quantity integer
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  capacity integer;
  used bigint;
  reservation_id uuid;
  actor uuid := auth.uid();
begin
  perform 1 from public.school_members where school_id = p_school and user_id = actor for share;
  if not found then raise exception 'Acesso à escola negado' using errcode = '42501'; end if;
  if p_date is null or not pg_catalog.isfinite(p_date) or p_period is null or p_period not between 1 and 5
    or p_quantity is null or p_quantity < 1 then
    raise exception 'Data, período ou quantidade inválida' using errcode = '22023';
  end if;

  -- A escrita serializa reservas e alterações de estado do mesmo recurso.
  -- Em isolamento por snapshot, uma escrita concorrente provoca erro de serialização.
  update public.resources set revision = revision + 1
  where school_id = p_school and id = p_resource and active
  returning quantity into capacity;
  if not found then raise exception 'Recurso indisponível' using errcode = 'P0001'; end if;

  select coalesce(sum(quantity), 0) into used from public.reservations
  where school_id = p_school and resource_id = p_resource and date = p_date
    and period = p_period and cancelled_at is null;
  if used + p_quantity > capacity then
    raise exception 'Quantidade indisponível neste período' using errcode = 'P0001';
  end if;
  insert into public.reservations (school_id, resource_id, user_id, date, period, quantity)
  values (p_school, p_resource, actor, p_date, p_period, p_quantity)
  returning id into reservation_id;
  return reservation_id;
end;
$$;

create function public.resource_availability(p_school uuid, p_resource uuid, p_date date)
returns table (period integer, used bigint)
language sql stable security definer set search_path = '' as $$
  select r.period, sum(r.quantity)
  from public.reservations r
  where r.school_id = p_school and r.resource_id = p_resource and r.date = p_date
    and r.cancelled_at is null
    and exists (select 1 from public.school_members m where m.school_id = p_school and m.user_id = auth.uid())
  group by r.period;
$$;

create function public.cancel_reservation(p_school uuid, p_reservation uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.reservations r set cancelled_at = statement_timestamp()
  where r.school_id = p_school and r.id = p_reservation and r.cancelled_at is null
    and exists (
      select 1 from public.school_members m where m.school_id = p_school and m.user_id = auth.uid()
      and (m.role = 'admin' or r.user_id = m.user_id)
    );
  if not found then raise exception 'Reserva indisponível para cancelamento' using errcode = 'P0001'; end if;
end;
$$;

revoke all on function public.reserve_resource(uuid, uuid, date, integer, integer),
  public.resource_availability(uuid, uuid, date), public.cancel_reservation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_resource(uuid, uuid, date, integer, integer),
  public.resource_availability(uuid, uuid, date), public.cancel_reservation(uuid, uuid) to authenticated;

commit;
