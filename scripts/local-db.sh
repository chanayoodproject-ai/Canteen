#!/usr/bin/env bash
# ทางเลือกเมื่อไม่มี Docker สำหรับ supabase start
# สร้าง Postgres + PostgREST ที่เข้ากับ @supabase/supabase-js และไฟล์ SQL ชุดเดียวกัน
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node scripts/generate-seed.mjs

if ! command -v psql >/dev/null 2>&1; then
  echo "ไม่พบ psql ติดตั้ง PostgreSQL ก่อน หรือใช้ Supabase บนคลาวด์ตาม README"
  exit 1
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  ELSE
    ALTER ROLE service_role BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'canteen-authenticator';
  END IF;
END $$;
GRANT anon TO authenticator;
GRANT authenticated TO authenticator;
GRANT service_role TO authenticator;
SELECT 'CREATE DATABASE canteen' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'canteen')\gexec
SQL

sudo -u postgres psql -d canteen -v ON_ERROR_STOP=1 -f "$ROOT/supabase/setup.sql"

if ! command -v postgrest >/dev/null 2>&1; then
  echo "สร้างฐานข้อมูลแล้ว แต่ไม่พบ postgrest จึงยังไม่มี REST API"
  exit 0
fi

cat > /tmp/canteen-postgrest.conf <<'EOF'
db-uri = "postgres://authenticator:canteen-authenticator@127.0.0.1:5432/canteen"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "super-secret-jwt-token-with-at-least-32-characters-long"
server-host = "127.0.0.1"
server-port = 54322
EOF

if ! curl -sf "http://127.0.0.1:54322/" >/dev/null 2>&1; then
  nohup postgrest /tmp/canteen-postgrest.conf > /tmp/canteen-postgrest.log 2>&1 &
  sleep 1
fi
if ! curl -sf "http://127.0.0.1:54321/rest/v1/" >/dev/null 2>&1; then
  nohup node "$ROOT/scripts/rest-proxy.mjs" > /tmp/canteen-rest-proxy.log 2>&1 &
  sleep 0.4
fi
echo "API พร้อมที่ http://127.0.0.1:54321/rest/v1 (รูปแบบเดียวกับ Supabase)"
