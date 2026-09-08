/// สร้างตาราง leads บน Neon — รันครั้งเดียวตอนตั้งระบบ (รันซ้ำได้ ไม่พัง)
///
///   npx vercel env pull .env.local
///   node --env-file=.env.local scripts/db-init.mjs
///
/// ใช้ DATABASE_URL_UNPOOLED (ต่อตรง) ไม่ใช่ DATABASE_URL (ผ่าน PgBouncer)
/// เพราะคำสั่ง DDL ทำงานได้ไม่ครบผ่าน pooler
///
/// ⚠️ Neon HTTP รับได้ทีละ statement — ห้ามยัดหลายคำสั่งคั่น ; ในครั้งเดียว
/// จึงต้องแยก await sql`...` ทีละอัน
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error('ไม่พบ DATABASE_URL_UNPOOLED — รัน `npx vercel env pull .env.local` ก่อน');
  process.exit(1);
}

const sql = neon(url);

/// ทุกช่องเป็น text ห้ามใส่ varchar(n) เด็ดขาด
/// ถ้าลิมิตฝั่ง DB ไม่ตรงกับ .slice() ฝั่ง JS แล้ว INSERT จะ throw = ลีดที่จ่ายค่าแอดมาแล้วหาย
/// ยอมให้ข้อความยาวเกินดีกว่ายอมให้ลีดหาย
///
/// ไม่เก็บ IP / user-agent — PDPA ต้องแจ้งทุกอย่างที่เก็บ เก็บมาก็ไม่ได้ใช้
await sql`
  CREATE TABLE IF NOT EXISTS leads (
    id            bigserial PRIMARY KEY,
    created_at    timestamptz NOT NULL DEFAULT now(),
    name          text        NOT NULL,
    company       text,
    phone         text        NOT NULL,
    email         text,
    business_type text,
    size          text,
    volume        text,
    message       text,
    consent       boolean     NOT NULL,
    notified_at   timestamptz,
    spam          boolean     NOT NULL DEFAULT false
  )
`;

/// notified_at = NULL แปลว่า push LINE ไม่สำเร็จ → ยังไม่มีใครรู้ว่ามีลีดนี้
/// /admin ต้องเอาแถวพวกนี้ขึ้นบนสุด
await sql`COMMENT ON COLUMN leads.notified_at IS 'NULL = push LINE ไม่สำเร็จ ยังไม่มีใครเห็นลีดนี้'`;
await sql`COMMENT ON COLUMN leads.spam IS 'true = กรอก honeypot (น่าจะบอท) แต่เก็บไว้เผื่อเป็นคนจริง'`;

/// /admin เรียงใหม่สุดขึ้นก่อนเสมอ
await sql`CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at DESC)`;

const [{ count }] = await sql`SELECT count(*)::int AS count FROM leads`;
console.log(`✓ ตาราง leads พร้อมใช้งาน — ตอนนี้มี ${count} แถว`);
