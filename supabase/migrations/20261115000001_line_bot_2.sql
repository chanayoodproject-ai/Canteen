-- Second LINE Official Account: remember which bot is in each group,
-- and record which bot sent each auto-send. Additive only.
alter table public.send_logs add column if not exists bot text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'send_logs_bot_check') then
    alter table public.send_logs add constraint send_logs_bot_check check (bot is null or bot in ('1', '2'));
  end if;
end $$;

alter table public.line_targets add column if not exists bot_1 boolean not null default true;
alter table public.line_targets add column if not exists bot_2 boolean not null default false;
