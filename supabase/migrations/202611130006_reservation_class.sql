begin;

alter table public.reservations add column class_group text
  check (class_group is null or length(trim(class_group)) between 1 and 40);

create or replace function public.reserve_resource_for_class(
  p_school uuid, p_resource uuid, p_date date, p_period integer, p_quantity integer, p_class_group text
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  capacity integer;
  used bigint;
  reservation_id uuid;
  actor uuid := auth.uid();
begin
  if p_class_group is null or length(trim(p_class_group)) not between 1 and 40 then
    raise exception 'Informe a turma (até 40 caracteres)' using errcode = 'P0001';
  end if;
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

  used := public.school_slot_usage(p_school, p_resource, p_date, p_period);
  if used + p_quantity > capacity then
    raise exception 'Quantidade indisponível neste período' using errcode = 'P0001';
  end if;
  insert into public.reservations (school_id, resource_id, user_id, date, period, quantity, class_group)
  values (p_school, p_resource, actor, p_date, p_period, p_quantity, trim(p_class_group))
  returning id into reservation_id;
  return reservation_id;
end;
$$;

revoke all on function public.reserve_resource_for_class(uuid,uuid,date,integer,integer,text) from public, anon, authenticated;
grant execute on function public.reserve_resource_for_class(uuid,uuid,date,integer,integer,text) to authenticated;
revoke execute on function public.reserve_resource(uuid,uuid,date,integer,integer) from public, anon, authenticated;

commit;
