-- Multi-group auto-send: remember every LINE group/room the bot is in, and dedupe sends per group.
create table if not exists public.line_targets (
  id text primary key,
  type text,
  last_seen timestamptz default now()
);
alter table public.line_targets enable row level security;
alter table public.line_targets add column if not exists active boolean not null default true;
alter table public.line_targets add column if not exists joined_at timestamptz default now();
alter table public.line_targets add column if not exists left_at timestamptz;

alter table public.send_logs add column if not exists target_id text not null default '';
-- Existing history belongs to the group that was the only target before this change.
update public.send_logs
set target_id = coalesce((select id from public.line_targets order by last_seen desc nulls last limit 1), '')
where target_id = '' and status in ('sent', 'claimed', 'failed', 'test');

create unique index if not exists send_logs_one_open_per_target
  on public.send_logs (menu_date, meal, target_id)
  where status in ('sent', 'claimed');
drop index if exists public.send_logs_one_open;
create index if not exists send_logs_lookup on public.send_logs (menu_date, meal, target_id);
