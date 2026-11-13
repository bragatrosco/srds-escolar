begin;

alter table public.schools add column calendar_revision bigint not null default 0;

create table public.calendar_restrictions (
  school_id uuid not null references public.schools,
  date date not null check (isfinite(date)),
  period integer not null check (period between 0 and 5),
  reason text not null check (length(trim(reason)) between 1 and 200),
  primary key (school_id, date, period)
);
alter table public.calendar_restrictions enable row level security;
revoke all on public.calendar_restrictions from public, anon, authenticated;
grant select on public.calendar_restrictions to authenticated;
create policy member_calendar on public.calendar_restrictions for select to authenticated
  using (school_id in (select school_id from public.school_members));

create function public.publish_school_calendar(
  p_school uuid, p_year integer, p_rows jsonb, p_revision bigint
) returns void language plpgsql security definer set search_path = '' as $$
declare
  starts date;
  ends date;
begin
  perform 1 from public.school_members
    where school_id = p_school and user_id = auth.uid() and role = 'admin' for share;
  if not found then raise exception 'Acesso negado' using errcode = '42501'; end if;

  if p_year is null or p_year not between 1900 and 9998 or p_rows is null
    or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Calendário inválido' using errcode = '22023';
  end if;
  starts := make_date(p_year, 1, 1);
  ends := make_date(p_year + 1, 1, 1);

  -- A revisão impede que um rascunho antigo substitua alterações publicadas.
  update public.schools set calendar_revision = calendar_revision + 1
    where id = p_school and calendar_revision = p_revision;
  if not found then
    raise exception 'O calendário foi atualizado. Reabra o ano antes de publicar.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) r(date date, period integer, reason text)
    where r.date < starts or r.date >= ends
  ) then raise exception 'Há datas fora do ano selecionado' using errcode = '22023'; end if;

  delete from public.calendar_restrictions where school_id = p_school and date >= starts and date < ends;
  insert into public.calendar_restrictions (school_id, date, period, reason)
  select p_school, r.date, r.period, trim(r.reason)
    from jsonb_to_recordset(p_rows) r(date date, period integer, reason text);
end;
$$;
revoke all on function public.publish_school_calendar(uuid, integer, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.publish_school_calendar(uuid, integer, jsonb, bigint) to authenticated;

create or replace function public.reserve_resource(
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

  perform 1 from public.schools where id = p_school for share;
  if exists (
    select 1 from public.calendar_restrictions
    where school_id = p_school and date = p_date and period in (0, p_period)
  ) then raise exception 'Data ou aula bloqueada pelo calendário escolar' using errcode = 'P0001'; end if;

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

create function public.calendar_conflict(booking public.reservations)
returns text language sql stable security invoker set search_path = '' as $$
  select reason from public.calendar_restrictions
  where school_id = ($1).school_id and date = ($1).date and period in (0, ($1).period)
  order by period limit 1;
$$;
revoke all on function public.calendar_conflict(public.reservations) from public, anon, authenticated;
grant execute on function public.calendar_conflict(public.reservations) to authenticated;

commit;


