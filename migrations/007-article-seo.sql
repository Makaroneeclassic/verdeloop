-- ชุด SEO บทความ: ชื่อเรื่องสำหรับผลค้นหาแยกจาก H1, FAQ แบบมีโครงสร้าง (FAQPage schema), รายชื่อบทความที่เกี่ยวข้อง
-- เพิ่มคอลัมน์อย่างเดียว ไม่แตะข้อมูลเดิม รันซ้ำได้ (idempotent)
ALTER TABLE article_drafts ADD COLUMN IF NOT EXISTS seo_title text NOT NULL DEFAULT '';
ALTER TABLE article_drafts ADD COLUMN IF NOT EXISTS faq jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE article_drafts ADD COLUMN IF NOT EXISTS related jsonb NOT NULL DEFAULT '[]'::jsonb;
