begin;

create table public.school_periods (
  school_id uuid not null references public.schools,
  period integer not null check (period > 0),
  shift text not null check (length(trim(shift)) between 1 and 40),
  label text not null check (length(trim(label)) between 1 and 40),
  starts time not null,
  ends time not null,
  active boolean not null default true,
  primary key (school_id, period),
  check (starts < ends and ends < '24:00'::time)
);
alter table public.school_periods enable row level security;
revoke all on public.school_periods from public, anon, authenticated;
grant select on public.school_periods to authenticated;
create policy member_periods on public.school_periods for select to authenticated
using (school_id in (select school_id from public.school_members));

alter table public.reservations drop constraint reservations_period_check,
  add check (period > 0);
alter table public.calendar_restrictions drop constraint calendar_restrictions_period_check,
  add check (period >= 0);

create function public.save_school_periods(p_school uuid, p_rows jsonb, p_initialize boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  next_period integer;
  item record;
begin
  perform 1 from public.school_members where school_id = p_school and user_id = auth.uid() and role = 'admin' for share;
  if not found then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update public.schools set calendar_revision = calendar_revision + 1 where id = p_school;
  select max(period) into next_period from public.school_periods where school_id = p_school;
  if p_initialize is distinct from (next_period is null) then
    raise exception 'Recarregue a grade antes de salvar.' using errcode = 'P0001';
  end if;
  for item in select * from jsonb_to_recordset(p_rows)
    as r(period integer, shift text, label text, starts time, ends time, active boolean)
  loop
    if p_initialize then
      if item.period is null or item.period not between 1 and 5 or item.active is distinct from true then
        raise exception 'Preencha as cinco aulas existentes.' using errcode = 'P0001';
      end if;
      insert into public.school_periods values (p_school, item.period, trim(item.shift), trim(item.label), item.starts, item.ends, true);
    elsif item.period is null then
      next_period := next_period + 1;
      insert into public.school_periods values (p_school, next_period, trim(item.shift), trim(item.label), item.starts, item.ends, true);
    else
      update public.school_periods set active = item.active where school_id = p_school and period = item.period;
      if not found then raise exception 'Horário desconhecido.' using errcode = 'P0001'; end if;
    end if;
  end loop;
  if p_initialize and (select count(*) from public.school_periods where school_id = p_school) <> 5 then
    raise exception 'Preencha as cinco aulas existentes.' using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from public.school_periods a join public.school_periods b on a.school_id = b.school_id and a.period <> b.period
    where a.school_id = p_school and a.active and a.starts < b.ends and b.starts < a.ends
      and (b.active or exists (
        select 1 from public.reservations r
        where r.school_id = b.school_id and r.period = b.period and r.cancelled_at is null
      ))
  ) then raise exception 'Há sobreposição com outro horário ativo ou com uma reserva confirmada.' using errcode = 'P0001'; end if;
end;
$$;

revoke all on function public.save_school_periods(uuid,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.save_school_periods(uuid,jsonb,boolean) to authenticated;

create or replace function public.publish_school_calendar(
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
    where r.date < starts or r.date >= ends or (r.period > 5 and not exists (
      select 1 from public.school_periods h where h.school_id = p_school and h.period = r.period
    ))
  ) then raise exception 'Há datas fora do ano ou horários inválidos' using errcode = '22023'; end if;

  delete from public.calendar_restrictions where school_id = p_school and date >= starts and date < ends;
  insert into public.calendar_restrictions (school_id, date, period, reason)
  select p_school, r.date, r.period, trim(r.reason)
    from jsonb_to_recordset(p_rows) r(date date, period integer, reason text);
end;
$$;

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
  if p_date is null or not pg_catalog.isfinite(p_date) or p_period is null or p_period < 1
    or p_quantity is null or p_quantity < 1 then
    raise exception 'Data, período ou quantidade inválida' using errcode = '22023';
  end if;

  perform 1 from public.schools where id = p_school for share;
  if p_period > 5 or exists (select 1 from public.school_periods where school_id = p_school) then
    if not exists (select 1 from public.school_periods where school_id = p_school and period = p_period and active) then
      raise exception 'Horário indisponível' using errcode = 'P0001';
    end if;
  end if;
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

commit;


