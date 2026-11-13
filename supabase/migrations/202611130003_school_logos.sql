begin;

create table public.school_logos (
  school_id uuid primary key references public.schools on delete cascade,
  png bytea not null,
  constraint valid_logo check (
    case when octet_length(png) between 33 and 262144 then
      substring(png from 1 for 16) = decode('89504e470d0a1a0a0000000d49484452', 'hex')
      and get_byte(png,16) = 0 and get_byte(png,17) = 0
      and get_byte(png,20) = 0 and get_byte(png,21) = 0
      and get_byte(png,18) * 256 + get_byte(png,19) between 1 and 512
      and get_byte(png,22) * 256 + get_byte(png,23) between 1 and 512
    else false end
  )
);

alter table public.school_logos enable row level security;
revoke all on public.school_logos from public, anon, authenticated;
grant select, insert, update, delete on public.school_logos to authenticated;

create policy member_logo on public.school_logos for select to authenticated
  using (school_id in (select school_id from public.school_members));
create policy admin_logo on public.school_logos for all to authenticated
  using (school_id in (select school_id from public.school_members where role = 'admin'))
  with check (school_id in (select school_id from public.school_members where role = 'admin'));

commit;


