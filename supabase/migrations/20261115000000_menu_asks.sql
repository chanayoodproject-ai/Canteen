-- Remember when a group (or 1:1 user) asked about today's meal so the
-- automatic push does not send a second card to that group. Additive only.
create table if not exists public.menu_asks (
  id uuid primary key default gen_random_uuid(),
  menu_date date not null,
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner', 'late')),
  target_id text not null,
  created_at timestamptz not null default now(),
  unique (menu_date, meal, target_id)
);

create index if not exists menu_asks_lookup on public.menu_asks (menu_date, meal, target_id);

alter table public.menu_asks enable row level security;

do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant select, insert, update, delete on table public.menu_asks to %I', role_name);
    end if;
  end loop;
end $$;
