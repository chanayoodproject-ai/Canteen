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

-- เมนูพฤศจิกายน 2026 ถอดจากภาพปฏิทินโรงอาหาร
-- รันซ้ำได้: ไม่ทับเมนูที่แก้ไว้แล้ว
insert into public.menus (year, month, day, meal, dish_text, needs_review) values
(2026, 11, 1, 'breakfast', 'ก๋วยเตี๋ยวคั่วไก่', false),
(2026, 11, 1, 'lunch', 'ต้มยำขาหมู ยำไข่ดาว', false),
(2026, 11, 1, 'dinner', 'ต้มข่าไก่ หมูสับผัดหน่อไม้พริกแห้ง', false),
(2026, 11, 1, 'late', 'หมูผัดพริกขิง', false),
(2026, 11, 2, 'breakfast', 'ผัดเต้าหู้ทรงเครื่อง', false),
(2026, 11, 2, 'lunch', 'ลาบหมู ต้มแซ่บไก่', false),
(2026, 11, 2, 'dinner', 'ไก่ผัดผงกระหรี่ กระเพราหมูสับ', false),
(2026, 11, 2, 'late', 'กวางตุ้งหมูสับน้ำมันหอย', false),
(2026, 11, 3, 'breakfast', 'ข้าวหน้าไก่', false),
(2026, 11, 3, 'lunch', 'คั่วกลิ้งไก่ บวบผัดไข่', false),
(2026, 11, 3, 'dinner', 'กระเพราลูกชิ้นปลากรายหน่อไม้เหลือง ต้มจืดไข่น้ำ', true),
(2026, 11, 3, 'late', 'ผัดขิงไก่', false),
(2026, 11, 4, 'breakfast', 'ผัดซีอิ๊วไก่บด', false),
(2026, 11, 4, 'lunch', 'แกงไก่หน่อไม้ดอง ไข่เจียวผัก', false),
(2026, 11, 4, 'dinner', 'ผัดเผ็ดไก่มะเขือเปราะ วุ้นเส้นผัดไข่', false),
(2026, 11, 4, 'late', 'กะเพราลูกชิ้นปลา', false),
(2026, 11, 5, 'breakfast', 'ข้าวต้มไก่ฉีก', false),
(2026, 11, 5, 'lunch', 'ต้มยำไก่ หน่อไม้ดองผัดไข่', false),
(2026, 11, 5, 'dinner', 'กระเพราไก่ไส้กรอกแดง ดอกหอมผัดหมูสับ', false),
(2026, 11, 5, 'late', 'คั่วกลิ้งไก่', false),
(2026, 11, 6, 'breakfast', 'เกาเหลาลูกชิ้นปลา', false),
(2026, 11, 6, 'lunch', 'แกงเผ็ดฟักไก่ กระหล่ำปลีน้ำปลา', false),
(2026, 11, 6, 'dinner', 'คะน้าน้ำมันหอย ยำไก่ย่าง', false),
(2026, 11, 6, 'late', 'ข้าวผัดหมู', false),
(2026, 11, 7, 'breakfast', 'ฟักทองผัดไข่', false),
(2026, 11, 7, 'lunch', 'กระเพราไก่หน่อไม้ดอง ต้มจืดผักกาดขาวหมูสับ', false),
(2026, 11, 7, 'dinner', 'พะแนงหมู ไข่ต้มตานี', true),
(2026, 11, 7, 'late', 'ข้าวผัดต้มยำไก่', false),
(2026, 11, 8, 'breakfast', 'ผัดไทยไข่', false),
(2026, 11, 8, 'lunch', 'ก๋วยเตี๋ยวไก่มะระ', false),
(2026, 11, 8, 'dinner', 'ต้มข่าไก่ ผัดขิงหมูสับ', false),
(2026, 11, 8, 'late', 'ปลาดุกผัดเผ็ด', false),
(2026, 11, 9, 'breakfast', 'ผักกาดดองผัดไข่', false),
(2026, 11, 9, 'lunch', 'น้ำพริกกะปิ+ผัดทอด, ต้มจืดวุ้นเส้นหมูสับ', true),
(2026, 11, 9, 'dinner', 'ข้าวคลุกกะปิ', false),
(2026, 11, 9, 'late', 'ผัดสปาเก็ตตี้ขี้เมา', false),
(2026, 11, 10, 'breakfast', 'ข้าวต้มไก่ฉีก', false),
(2026, 11, 10, 'lunch', 'แกงส้มผักรวม ไข่เจียวไก่บด', false),
(2026, 11, 10, 'dinner', 'ลูกชิ้นกุ้งผัดพริกเผา ยำไก่ยอ', false),
(2026, 11, 10, 'late', 'ผัดพริกขิงหมู', false),
(2026, 11, 11, 'breakfast', 'ข้าวต้มหมูเด้ง', false),
(2026, 11, 11, 'lunch', 'แกงคั่วมะระหมู แตงกวาผัดไข่', false),
(2026, 11, 11, 'dinner', 'ผัดเผ็ดไก่ใบยี่หร่า แหนมผัดไข่', false),
(2026, 11, 11, 'late', 'ผัดซีอิ๊วหมู', false),
(2026, 11, 12, 'breakfast', 'ข้าวผัดรถไฟ', false),
(2026, 11, 12, 'lunch', 'ผัดมะเขือยาวไก่บด เต้าเจี้ยวหลน+ผักสด', true),
(2026, 11, 12, 'dinner', 'แกงป่าไก่ ไข่ลูกเขย', false),
(2026, 11, 12, 'late', 'ผัดซีอิ๊วหมู', false),
(2026, 11, 13, 'breakfast', 'ข้าวผัดรถไฟ', false),
(2026, 11, 13, 'lunch', 'ผัดมะเขือยาวไก่บด เต้าเจี้ยวหลน+ผักสด', true),
(2026, 11, 13, 'dinner', 'แกงป่าไก่ ไข่ลูกเขย', false),
(2026, 11, 13, 'late', 'ผัดพริกแกงไก่', false),
(2026, 11, 14, 'breakfast', 'ราดหน้าไก่', false),
(2026, 11, 14, 'lunch', 'แกงเทโพหมู หัวไชโป๊วผัดไข่', false),
(2026, 11, 14, 'dinner', 'ผัดพริกแกงไก่ ผัดกระหล่ำปลีไข่', false),
(2026, 11, 14, 'late', 'กระเพราไก่หน่อไม้', false),
(2026, 11, 15, 'breakfast', 'ผัดมักโรนีไก่', false),
(2026, 11, 15, 'lunch', 'ราดหน้าเกี๊ยวกรอบหมู-ไก่', false),
(2026, 11, 15, 'dinner', 'ต้มไข่พะโล้ ผัดพริกขิงไก่', false),
(2026, 11, 15, 'late', 'ข้าวผัดไส้กรอก', false),
(2026, 11, 16, 'breakfast', 'โจ๊กหมูเด้ง', false),
(2026, 11, 16, 'lunch', 'ขนมจีนน้ำยาป่า+น้ำยากะทิไก่', false),
(2026, 11, 16, 'dinner', 'พะแนงหมู ไข่ต้ม', false),
(2026, 11, 16, 'late', 'ข้าวหมูกระเทียม', false),
(2026, 11, 17, 'breakfast', 'ข้าวต้มกุ๊ย+ไก่กระเทียม', false),
(2026, 11, 17, 'lunch', 'แกงเขียวหวานไก่ ไข่เจียวแหนม', false),
(2026, 11, 17, 'dinner', 'ผัดเผ็ดไก่หน่อไม้ดอง ต้มจืดวุ้นเส้นหมูสับ', false),
(2026, 11, 17, 'late', 'ขี้เมาเส้นใหญ่', false),
(2026, 11, 18, 'breakfast', 'หัวไชโป๊วหวานผัดไข่', false),
(2026, 11, 18, 'lunch', 'ผัดฉ่าปลานิล ต้มจืดสาหร่ายไก่', false),
(2026, 11, 18, 'dinner', 'แกงอ่อมฟักไก่ ผัดกวางตุ้งน้ำมันหอย', false),
(2026, 11, 18, 'late', 'ข้าวผัดหมูเค็ม', false),
(2026, 11, 19, 'breakfast', 'ข้าวต้มไก่บด', false),
(2026, 11, 19, 'lunch', 'ข้าวมันไก่ต้ม-ไก่ทอด', false),
(2026, 11, 19, 'dinner', 'ไก่ผัดตะไคร้ ผักกาดขาวผัดแฮม', false),
(2026, 11, 19, 'late', 'คั่วกลิ้งหมู', false),
(2026, 11, 20, 'breakfast', 'เกาเหลาไก่ตุ๋น', false),
(2026, 11, 20, 'lunch', 'แกงเผ็ดหมูมะเขือ กระหล่ำปลีผัดน้ำปลา', false),
(2026, 11, 20, 'dinner', 'ข้าวหน้าไก่+น้ำซุป', false),
(2026, 11, 20, 'late', 'ข้าวไก่กระเทียม', false),
(2026, 11, 21, 'breakfast', 'ข้าวผัดกุนเชียง', false),
(2026, 11, 21, 'lunch', 'ต้มจืดฟักไก่มะนาวดอง คั่วกลิ้งไก่ชิ้น', true),
(2026, 11, 21, 'dinner', 'ลาบไก่ หมูกระเทียม', false),
(2026, 11, 21, 'late', 'ผัดไทย', false),
(2026, 11, 22, 'breakfast', 'ก๋วยเตี๋ยวคั่วไก่', false),
(2026, 11, 22, 'lunch', 'หมูผัดกะปิ ต้มจืดหน่อไม้ไก่', false),
(2026, 11, 22, 'dinner', 'ไก่ย่าง+น้ำจิ้มแจ่ว ผัดคะน้าน้ำมันหอย', false),
(2026, 11, 22, 'late', 'ผัดโหระพาไก่', false),
(2026, 11, 23, 'breakfast', 'ซุปมักกะโรนีไก่', false),
(2026, 11, 23, 'lunch', 'ต้มยำขาหมู ผัดดอกหอมไก่บด', false),
(2026, 11, 23, 'dinner', 'น้ำพริกลงเรือ+ผักสด ไข่ลูกเขย', false),
(2026, 11, 23, 'late', 'กระเพราไข่ดาว', false),
(2026, 11, 24, 'breakfast', 'ผัดซีอิ๊วไก่', false),
(2026, 11, 24, 'lunch', 'ผัดฉ่าไก่ มะระผัดไข่', false),
(2026, 11, 24, 'dinner', 'กระเพราหอยแมลงภู่ ไก่ทอด', false),
(2026, 11, 24, 'late', 'แหนมผัดไข่', false),
(2026, 11, 25, 'breakfast', 'ไก่ผัดพริกหยวก', false),
(2026, 11, 25, 'lunch', 'ยำไก่แซ่บ ต้มจืดผักกาดดองหมู', true),
(2026, 11, 25, 'dinner', 'ดอกกระหล่ำผัดน้ำมันหอย แกงเขียวหวานไก่', false),
(2026, 11, 25, 'late', 'หมูสับผัดหน่อไม้โหระพา', false),
(2026, 11, 26, 'breakfast', 'ผักกาดดองผัดไข่', false),
(2026, 11, 26, 'lunch', 'ข้าวหมูแดง+น้ำซุป', false),
(2026, 11, 26, 'dinner', 'ผัดพริกแกงหมูชิ้น ไก่ผัดเห็ดน้ำมันหอย', false),
(2026, 11, 26, 'late', 'ข้าวผัดเขียวหวานไก่', false),
(2026, 11, 27, 'breakfast', 'ข้าวผัดฮอตดอก', false),
(2026, 11, 27, 'lunch', 'ต้มจืดเต้าหู้ไก่บด กระเพราหมูสับ', false),
(2026, 11, 27, 'dinner', 'สุกี้หมู-ไก่', false),
(2026, 11, 27, 'late', 'ผักบุ้งไฟแดงไก่บด', false),
(2026, 11, 28, 'breakfast', 'ข้าวต้มหมู', false),
(2026, 11, 28, 'lunch', 'ก๋วยเตี๋ยวไก่ต้มยำ', false),
(2026, 11, 28, 'dinner', 'ผัดเห็ดรวมน้ำมันหอย แกงขี้เหล็ก', false),
(2026, 11, 28, 'late', 'ผัดพริกเผาหมู', false),
(2026, 11, 29, 'breakfast', 'ผัดกวางตุ้งลูกชิ้นกุ้ง', false),
(2026, 11, 29, 'lunch', 'ไก่ใส่น้ำ ผักกาดขาวผัดแฮม', true),
(2026, 11, 29, 'dinner', 'แกงเลี้ยงผักรวม ผัดเผ็ดไก่หน่อไม้ดอง', false),
(2026, 11, 29, 'late', 'ต้มจับฉ่ายไก่', false),
(2026, 11, 30, 'breakfast', 'มะระผัดไข่ไก่บด', false),
(2026, 11, 30, 'lunch', 'ก๋วยเตี๋ยวน้ำตกหมู-ไก่', false),
(2026, 11, 30, 'dinner', 'ต้มแซ่บหมู ผัดวุ้นเส้น', false),
(2026, 11, 30, 'late', 'ข้าวผัดกุนเชียง', false)
on conflict (year, month, day, meal) do nothing;
