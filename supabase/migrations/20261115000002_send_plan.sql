-- Singleton schedule for auto-send: daily combined, twice, or per-meal.
-- Additive only. send_settings stays for per-meal times and enable flags.
create table if not exists public.send_plan (
  id integer primary key default 1 check (id = 1),
  mode text not null default 'daily' check (mode in ('daily', 'twice', 'per_meal')),
  daily_time time not null default '07:00',
  first_meals text[] not null default array['breakfast', 'lunch']::text[],
  first_time time not null default '07:00',
  second_meals text[] not null default array['dinner', 'late']::text[],
  second_time time not null default '16:30',
  quota_base integer not null default 300 check (quota_base > 0),
  effective_from date not null default '2026-11-16',
  updated_at timestamptz not null default now()
);

insert into public.send_plan (id) values (1) on conflict (id) do nothing;

alter table public.send_plan enable row level security;

do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant select, insert, update, delete on table public.send_plan to %I', role_name);
    end if;
  end loop;
end $$;
