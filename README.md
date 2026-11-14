# Canteen มีอารายกิน

แอปผู้ดูแลเมนูโรงอาหาร ส่งเมนูเช้า เที่ยง เย็น และดึกเข้า LINE เป็นข้อความตัวใหญ่ อ่านง่ายบนมือถือ ข้อมูลอยู่บน Supabase (Postgres) ใช้แผนฟรีได้ทั้ง Supabase และ Vercel Hobby

## รันในเครื่อง

ต้องมี Node.js 22

```bash
npm install
cp .env.example .env.local
# ใส่คีย์ Supabase ใน .env.local แล้วรัน SQL ตามหัวข้อถัดไป
npm run dev
```

เปิด http://127.0.0.1:43123

ถ้ายังไม่ใส่คีย์ Supabase แอปไม่ล่ม จะขึ้นแถบโหมดตัวอย่าง และเก็บข้อมูลไว้ในหน่วยความจำของเซิร์ฟเวอร์ชั่วคราว ปฏิทินพฤศจิกายน 2026 ยังดูได้ แต่รีสตาร์ทแล้วข้อมูลที่แก้จะหาย ให้ต่อ Supabase เพื่อเก็บถาวร

สคริปต์ช่วยเตรียมไฟล์: `bash scripts/setup.sh`

## สร้าง Supabase แผนฟรี

1. สมัครที่ [supabase.com](https://supabase.com) แล้วสร้างโปรเจกต์ใหม่ ไม่ต้องอัปเกรดแผน
2. เปิด **SQL Editor** แล้ววางทั้งไฟล์ `supabase/setup.sql` จากนั้นกด Run ครั้งเดียว
   - ไฟล์นี้สร้างตาราง เปิด RLS ใส่เวลาส่งเริ่มต้น และใส่เมนูพฤศจิกายน 2026
   - รันซ้ำได้ เมนูที่มีอยู่แล้วจะไม่ถูกทับ
3. ที่ **Project Settings → API** คัดลอกค่าเหล่านี้ไปใส่ `.env.local` หรือ Environment Variables บน Vercel
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` ใช้เฉพาะบนเซิร์ฟเวอร์ ห้ามใส่ในโค้ดฝั่งเบราว์เซอร์

ถ้าใช้ Supabase CLI และมี Docker:

```bash
npx supabase start
npx supabase db reset
```

โฟลเดอร์ `supabase/migrations` และ `supabase/seed.sql` พร้อมสำหรับ `db reset` ถ้ายังไม่มี `config.toml` ให้รัน `npx supabase init` ก่อน แล้วอย่าทับไฟล์ SQL ที่มีอยู่

ถ้าไม่มี Docker ใช้ `bash scripts/local-db.sh` ได้บนเครื่องที่มี PostgreSQL และ PostgREST สคริปต์นี้สร้างฐานที่พูดภาษาเดียวกับ `@supabase/supabase-js` คีย์สาธิตของ `supabase start` เป็นคีย์สาธารณะสำหรับเครื่องตัวเองเท่านั้น ห้ามเอาไปใช้บนโปรเจกต์จริง

## ตัวแปรแวดล้อม

| ตัวแปร | ใช้ทำอะไร |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL ของโปรเจกต์ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | คีย์ anon เบราว์เซอร์ไม่ได้ใช้เขียนข้อมูล เพราะ RLS ปิดไว้ |
| `SUPABASE_SERVICE_ROLE_KEY` | เซิร์ฟเวอร์อ่านเขียนทุกตาราง |
| `CRON_SECRET` | รหัสเรียก `/api/cron/send` |
| `LINE_CHANNEL_ACCESS_TOKEN` | ส่งข้อความ |
| `LINE_CHANNEL_SECRET` | ตรวจลายเซ็น webhook |
| `LINE_TARGET_ID` | รหัสผู้ใช้ กลุ่ม ห้อง หรือคำว่า `broadcast` |
| `AI_VISION_MODEL` | ไม่บังคับ เปลี่ยนโมเดลอ่านภาพ (ค่าเริ่มต้น `google/gemini-3-flash` ผ่าน Vercel AI Gateway ใช้ OIDC อัตโนมัติบน Vercel) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | คีย์ Gemini ฟรีสำหรับอ่านภาพ (ทางหลัก) ใส่ใน env หรือเก็บใน `public.app_secrets` ก็ได้ |
| `GEMINI_MODEL` / `GEMINI_THINKING` | ไม่บังคับ (ค่าเริ่มต้น `gemini-3-flash-preview`, `minimal` ถ้าโมเดลถูกปลด แอปจะหาโมเดล flash รุ่นใหม่ที่คีย์ใช้ได้เอง) |
| `AI_GATEWAY_API_KEY` / `OPENAI_API_KEY` | ไม่บังคับ ทางสำรองในการอ่านภาพ (ลำดับ: Gemini → AI Gateway → OpenAI) |

> AI Gateway บน Vercel ต้องผูกบัตรเครดิตในหน้า AI Gateway ของทีมก่อน จึงจะได้เครดิตฟรีรายเดือน ถ้ามีคีย์ Gemini แล้วไม่จำเป็น

ดูแม่แบบใน `.env.example` ห้ามคอมมิตค่าจริง

## สิ่งที่แอปทำ

- ปุ่ม **อัปโหลดเมนูอาหาร** บนหน้าแรกและหน้าปฏิทิน อัปโหลดทีละเดือน เป็นภาพ CSV หรือ XLSX แล้วแก้ทุกวันทุกมื้อก่อนบันทึก
- ถ้าเดือนนั้นมีเมนูอยู่แล้ว ต้องกดยืนยันก่อนแทนที่
- อัปโหลดภาพถ่ายปฏิทินได้สูงสุด 4 ภาพต่อครั้ง ระบบย่อภาพในเครื่องก่อนส่ง แล้วให้ AI (Vercel AI Gateway) อ่านเมนูเป็นตาราง ต้องตรวจก่อนกดบันทึกทุกครั้ง
- ถ้า AI อ่านไม่ได้ (เครดิตหมด เน็ตขัดข้อง ฯลฯ) ยังเปิดรูปคู่กับตาราง แล้วพิมพ์แก้ได้
- ทดสอบ: `npm test` (เวลาไทย, ข้ามเดือน/ปี, CSV, ผล OCR, คำถามเมนู, ข้อความ Flex)
- ตั้งเวลาส่ง 4 มื้อ ค่าเริ่มต้น เช้า 06:30 เที่ยง 10:30 เย็น 15:30 ดึก 19:30 เขตเวลา Asia/Bangkok เปิดปิดได้
- ข้อความ LINE เป็น Flex Message แสดงแค่วันที่ มื้อ และเมนูอาหารตัวใหญ่ ไม่มีปุ่มให้คะแนน
- Webhook `/api/line/webhook` บันทึกกลุ่ม ตอบคำถามเมนู และละเว้น postback เก่าจากปุ่มคะแนน (ถ้ามี)
- ไม่มี LINE ก็ยังดูตัวอย่างข้อความได้ในหน้า `/preview`

## LINE Messaging API

1. สร้าง Provider และ Messaging API channel ที่ [LINE Developers](https://developers.line.biz/)
2. ออก Channel access token และจด Channel secret
3. ใส่สามตัวแปร LINE ในสภาพแวดล้อมของเซิร์ฟเวอร์
4. ตั้ง Webhook URL เป็น `https://โดเมนของคุณ/api/line/webhook` แล้วกด Verify
5. เปิด Use webhook
6. `LINE_TARGET_ID` เป็นรหัสผู้ใช้ (`U...`) กลุ่ม (`C...`) ห้อง (`R...`) หรือ `broadcast`
7. ในหน้าตั้งค่า LINE ของแอป กดส่งทดสอบได้

## ส่งตามเวลาบน Vercel Hobby

Vercel Hobby ตั้ง cron ได้ประมาณวันละครั้ง จึงไม่พอสำหรับ 4 มื้อ แอปจึงไม่พึ่ง cron ของ Vercel

`POST /api/cron/send` หรือ `GET` เดียวกัน ตรวจเวลาประเทศไทย แล้วส่งเฉพาะมื้อที่ถึงเวลา เปิดอยู่ มีเมนู และยังไม่มีแถวสถานะส่งสำเร็จของวันนั้น เรียกซ้ำได้ ไม่ส่งซ้ำ

ตัวยิงฟรีที่เรียก endpoint นี้ทุก 5–15 นาที เลือกอย่างใดอย่างหนึ่ง

### GitHub Actions

ไฟล์ `.github/workflows/send-menu.yml` ยิงทุก 10 นาที ตั้ง repository secret

- `APP_URL` เช่น `https://ชื่อแอป.vercel.app` ไม่ต้องมี `/` ท้าย
- `CRON_SECRET` ให้ตรงกับตัวแปรบน Vercel

GitHub อาจเหลื่อมเวลาเล็กน้อยในแผนฟรี แต่ละรอบยังส่งได้ถูกมื้อเพราะเช็คจากฐานข้อมูล

### cron-job.org

สร้างงานฟรี ยิง `https://โดเมน/api/cron/send` ทุก 10 นาที ใส่หัวข้อ

```text
Authorization: Bearer ค่าของ CRON_SECRET
```

เครื่องพัฒนาที่ไม่ได้ตั้ง `CRON_SECRET` จะใช้ `dev-cron-secret` บน production ต้องตั้งค่าเอง ไม่งั้น endpoint นี้ตอบ 401

## ขึ้น Vercel

ไม่ต้องใช้แผนเสียเงินและไม่ต้องเปิด add-on

1. นำโค้ดขึ้น Git แล้วสร้างโปรเจกต์บน Vercel เลือก framework Next.js
2. ใส่ตัวแปรใน `.env.example` ทั้งหมดที่มีค่าจริง โดยเฉพาะ Supabase, `CRON_SECRET` และ LINE ถ้าจะส่งจริง
3. Deploy
4. ตั้ง GitHub Action หรือ cron-job.org ตามด้านบน
5. วาง webhook ของ LINE

`vercel.json` กันแคชของ API ไว้ ไม่ได้ตั้ง cron ของ Vercel

## ตารางในฐานข้อมูล

- `menus` ปี เดือน วัน มื้อ (`breakfast` `lunch` `dinner` `late`) ข้อความเมนู และธง `needs_review`
- `send_settings` เวลาส่งและสถานะเปิดปิดของแต่ละมื้อ
- `send_logs` ประวัติส่ง สถานะ `sent` ใช้เป็นตัวกันส่งซ้ำในวันเดียวกัน
- `ratings` ตารางเดิมที่ยังอยู่ในฐานข้อมูล แต่แอปไม่ได้ใช้แล้ว

เปิด RLS ทุกตาราง และไม่สร้าง policy ให้ anon หรือ authenticated คีย์ anon จึงอ่านเขียนไม่ได้ เส้นทาง API ใช้ service role ซึ่งข้าม RLS

มื้อที่ถอดจากภาพปฏิทินพฤศจิกายน 2026 แล้วตัวอักษรเล็กหรือคำไม่คุ้น จะมีจุดให้ตรวจในปฏิทิน แก้ในช่องนั้นได้เลย ภาพต้นฉบับอยู่ที่ `public/sample/november-2026-calendar.jpg` และมี CSV ตัวอย่างที่ `public/sample/november-2026.csv`

## โครงสร้างหน้า

- `/` วันนี้ทั้ง 4 มื้อ มื้อถัดไป และปุ่มอัปโหลด
- `/calendar` ปฏิทินรายเดือน แก้รายวัน
- `/upload` อัปโหลดและตรวจก่อนบันทึก
- `/schedule` เวลาส่งและประวัติ
- `/line` สถานะการเชื่อม LINE
- `/preview` ตัวอย่าง Flex Message
