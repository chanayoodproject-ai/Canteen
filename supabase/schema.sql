-- Canteen มีอารายกิน
-- รันไฟล์นี้ใน Supabase SQL Editor (โปรเจกต์ฟรี) หรือใช้ supabase/setup.sql ที่รวมข้อมูลตั้งต้นแล้ว
-- service role ข้าม RLS ได้ ส่วน anon/authenticated ไม่มี policy จึงอ่านเขียนไม่ได้

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.menus (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2020 and 2100),
  month integer not null check (month between 1 and 12),
  day integer not null check (day between 1 and 31),
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner', 'late')),
  dish_text text not null default '',
  needs_review boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (year, month, day, meal)
);

create table if not exists public.send_settings (
  meal text primary key check (meal in ('breakfast', 'lunch', 'dinner', 'late')),
  send_time time not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.send_logs (
  id uuid primary key default gen_random_uuid(),
  menu_date date not null,
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner', 'late')),
  status text not null check (status in ('claimed', 'sent', 'simulated', 'failed', 'test')),
  target text,
  detail text,
  created_at timestamptz not null default now()
);

create unique index if not exists send_logs_one_open
  on public.send_logs (menu_date, meal)
  where status in ('sent', 'claimed');

create index if not exists send_logs_recent on public.send_logs (created_at desc);

create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  menu_date date not null,
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner', 'late')),
  line_user_id text not null,
  menu_score integer check (menu_score between 1 and 5),
  taste_score integer check (taste_score between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (menu_date, meal, line_user_id)
);

create index if not exists ratings_by_date on public.ratings (menu_date, meal);

drop trigger if exists menus_set_updated_at on public.menus;
create trigger menus_set_updated_at before update on public.menus
for each row execute function public.set_updated_at();

drop trigger if exists send_settings_set_updated_at on public.send_settings;
create trigger send_settings_set_updated_at before update on public.send_settings
for each row execute function public.set_updated_at();

drop trigger if exists ratings_set_updated_at on public.ratings;
create trigger ratings_set_updated_at before update on public.ratings
for each row execute function public.set_updated_at();

alter table public.menus enable row level security;
alter table public.send_settings enable row level security;
alter table public.send_logs enable row level security;
alter table public.ratings enable row level security;

-- ไม่สร้าง policy ให้ anon/authenticated: คีย์สาธารณะใช้จากเบราว์เซอร์ไม่ได้
-- เซิร์ฟเวอร์ใช้ service role ซึ่งข้าม RLS บน Supabase

insert into public.send_settings (meal, send_time, enabled) values
  ('breakfast', '06:30', true),
  ('lunch', '10:30', true),
  ('dinner', '15:30', true),
  ('late', '19:30', true)
on conflict (meal) do nothing;

do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant usage on schema public to %I', role_name);
      execute format('grant select, insert, update, delete on all tables in schema public to %I', role_name);
    end if;
  end loop;
end $$;
