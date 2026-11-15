-- Short-lived log of menu-question replies so the same group does not get
-- the same answer twice within a minute. Additive only. Auto-send still uses menu_asks.
create table if not exists public.menu_reply_log (
  id uuid primary key default gen_random_uuid(),
  menu_date date not null,
  meals text[] not null default '{}'::text[],
  target_id text not null,
  question_norm text not null,
  created_at timestamptz not null default now()
);

create index if not exists menu_reply_log_lookup
  on public.menu_reply_log (target_id, menu_date, question_norm, created_at desc);

alter table public.menu_reply_log enable row level security;

do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant select, insert, update, delete on table public.menu_reply_log to %I', role_name);
    end if;
  end loop;
end $$;
