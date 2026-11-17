begin;
create table public.access_requests (
  user_id uuid primary key references auth.users on delete cascade,
  school_id uuid not null references public.schools,
  registration text not null unique check (registration ~ '^[0-9]{1,30}$'),
  job_title text not null check (length(trim(job_title)) between 1 and 80),
  job_function text not null check (length(trim(job_function)) between 1 and 80),
  email text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected'))
);
alter table public.access_requests enable row level security;
revoke all on public.access_requests from public, anon, authenticated;
grant select on public.access_requests to authenticated;
create policy read_access_requests on public.access_requests for select to authenticated
using (user_id = (select auth.uid()) or school_id in (select school_id from public.school_members where role = 'admin'));

create function public.access_school_choices()
returns table(id uuid, name text) language sql stable security definer set search_path = '' as $$
  select s.id, s.name from public.schools s where exists (
    select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null
    and lower(u.email) ~ '^[^@[:space:]]+@prof[.]pmf[.]sc[.]gov[.]br$'
  ) order by s.name;
$$;

create function public.request_school_access(p_school uuid, p_registration text, p_title text, p_function text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  address text;
begin
  select lower(email) into address from auth.users
    where id = auth.uid() and email_confirmed_at is not null
    and lower(email) ~ '^[^@[:space:]]+@prof[.]pmf[.]sc[.]gov[.]br$';
  if address is null then raise exception 'Confirme seu e-mail funcional.' using errcode = '42501'; end if;
  insert into public.access_requests(user_id, school_id, registration, job_title, job_function, email)
  values (auth.uid(), p_school, trim(p_registration), trim(p_title), trim(p_function), address);
end;
$$;

create function public.review_school_access(p_school uuid, p_user uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.school_members where school_id = p_school and user_id = auth.uid() and role = 'admin' for share;
  if not found then raise exception 'Acesso negado.' using errcode = '42501'; end if;
  update public.access_requests set status = case when p_approve then 'approved' else 'rejected' end
    where school_id = p_school and user_id = p_user and status = 'pending';
  if not found then raise exception 'Pedido já analisado ou indisponível.' using errcode = 'P0001'; end if;
  if p_approve then
    insert into public.school_members(school_id,user_id,role) values(p_school,p_user,'teacher')
    on conflict (school_id,user_id) do nothing;
  end if;
end;
$$;

revoke all on function public.access_school_choices(), public.request_school_access(uuid,text,text,text),
  public.review_school_access(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.access_school_choices(), public.request_school_access(uuid,text,text,text),
  public.review_school_access(uuid,uuid,boolean) to authenticated;
commit;


