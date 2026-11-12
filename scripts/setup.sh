#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm install
node scripts/generate-seed.mjs
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  echo "สร้าง .env.local แล้ว ใส่คีย์ Supabase ก่อน npm run dev"
else
  echo "มี .env.local อยู่แล้ว"
fi
echo "ขั้นต่อไป: รัน supabase/setup.sql ใน SQL Editor ของ Supabase แล้ว npm run dev"
