/// Vercel Function รับฟอร์มขอตัวอย่าง — วางที่ /api/ ระดับ root
/// ไม่ใช้ @astrojs/vercel adapter เพราะดึง path-to-regexp ที่มีช่องโหว่ high มาด้วย
/// วิธีนี้เว็บยังเป็น static 100% (เร็วกว่า ดีต่อ SEO) และ Vercel รัน function นี้ให้อยู่ดี
///
/// ลีดทุกอันมาจากเงินค่าโฆษณา — ห้ามหาย
///
/// ┌─ กติกาความสำเร็จ (หัวใจของไฟล์นี้ ห้ามแก้โดยไม่คิด) ────────────────┐
/// │ เก็บลง DB ได้  → 200 /thank-you/   แม้ LINE ล้ม (ลีดปลอดภัย กู้จาก /admin ได้)  │
/// │ LINE ส่งได้     → 200 /thank-you/   แม้ DB ล้ม (มีคนเห็นข้อความแล้ว)           │
/// │ ล้มทั้งคู่       → 502 + ให้ลูกค้าทัก LINE เอง                                │
/// └──────────────────────────────────────────────────────────────────┘
/// เหตุผล: ลีดปลอดภัยถ้า "มีที่เก็บ" หรือ "มีคนเห็น" อย่างใดอย่างหนึ่ง
/// ตอบ 502 ทั้งที่ DB เก็บได้ = ไล่ลูกค้าที่จ่ายเงินซื้อมาแล้วทิ้งฟรี ๆ
///
/// สำเร็จข้างเดียวต้องมีสัญญาณเสมอ ห้ามเงียบ:
///   DB ล้ม  → เติมบรรทัดเตือนไว้หัวข้อความ LINE ให้คนก๊อบเก็บเอง
///   LINE ล้ม → notified_at เป็น NULL แล้ว /admin ดันแถวนั้นขึ้นบนสุด
import { neon } from '@neondatabase/serverless';

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';

/// timeout ทั้งสองขา — งานนี้มี maxDuration จำกัด ถ้าปลายทางค้างแล้วเราไม่ตัด
/// function จะโดน Vercel ฆ่ากลางคัน ลูกค้าเห็นหน้า error ดิบของ Vercel
/// (ไม่ใช่ /thank-you/ ไม่ใช่แบนเนอร์ของเรา) ทั้งที่แถวอาจลง DB ไปแล้ว
const DB_TIMEOUT_MS = 5000;
const LINE_TIMEOUT_MS = 8000;

/// ตัวเลือกที่ยอมรับ — ต้องตรงกับ <select> ในฟอร์ม
/// กันคนยิง POST ตรงใส่ค่ามั่ว ๆ เข้ามาจนอ่านลีดไม่รู้เรื่อง
const BUSINESS_TYPES = [
  'ร้านกาแฟ / คาเฟ่',
  'ร้านชานมไข่มุก',
  'ร้านอาหาร',
  'โรงแรม / รีสอร์ท',
  'โรงงาน / ผู้ผลิต',
  'ตัวแทนจำหน่าย',
  'องค์กร / หน่วยงาน',
  'อื่น ๆ',
];
const SIZES = ['6 มม.', '8 มม.', '12 มม.', 'ยังไม่แน่ใจ'];
const VOLUMES = [
  'น้อยกว่า 5,000 ชิ้น',
  '5,000–20,000 ชิ้น',
  '20,000–50,000 ชิ้น',
  'มากกว่า 50,000 ชิ้น',
  'ยังไม่แน่ใจ',
];

const MAX_LEN = 200;

/// ตัดช่องว่างและจำกัดความยาว กัน payload บวมและกันข้อความยาวผิดปกติ
const clean = (v) => (typeof v === 'string' ? v.trim().slice(0, MAX_LEN) : '');

/// เบอร์ไทย: 9–10 หลัก อนุญาตให้พิมพ์ขีดหรือเว้นวรรคมาได้
const isPhone = (v) => /^[0-9]{9,10}$/.test(v.replace(/[\s-]/g, ''));

/// ตรวจอีเมลแบบหลวม ๆ พอ — กฎเข้มเกินไปจะปฏิเสธอีเมลที่ใช้ได้จริง
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

/// สร้าง client ตอนเรียกใช้ ไม่ใช่ตอนโหลด module
/// ถ้า DATABASE_URL ยังไม่ตั้งแล้ว module พังตั้งแต่โหลด = ทุก request ตาย 500
/// รวมถึงคนที่จริง ๆ แล้ว push LINE ได้อยู่แล้ว
///
/// ⚠️ ห้าม cache client ไว้ข้าม request — AbortSignal.timeout() เริ่มนับทันทีที่สร้าง
/// ถ้าเก็บ client ที่ผูกสัญญาณไว้ ครั้งต่อไปที่ instance เดิมถูกใช้ซ้ำ (Fluid compute ใช้ซ้ำแน่นอน)
/// สัญญาณจะหมดอายุไปแล้ว แล้วทุก query จะ abort ทันทีโดยไม่มีเหตุผล
/// ตัว client เป็นแค่ตัวห่อ fetch สร้างใหม่ทุกครั้งแทบไม่มีต้นทุน
function db() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return neon(url, { fetchOptions: { signal: AbortSignal.timeout(DB_TIMEOUT_MS) } });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  // ฟอร์มส่งมาแบบ urlencoded (ไม่ใช้ JS) แต่รองรับ JSON ด้วยเผื่อเรียกจากที่อื่น
  // req.body เป็น getter ที่ throw ได้ถ้า JSON เพี้ยน — ไม่ครอบไว้จะกลายเป็น 500
  let body;
  try {
    body = req.body ?? {};
  } catch {
    return res.status(400).json({ ok: false, error: 'bad_body' });
  }

  // ฟอร์มธรรมดา (ไม่มี JS) ต้องได้หน้าเว็บกลับ ไม่ใช่ JSON ดิบ ๆ เต็มจอ
  // ตรวจจาก Accept header: เบราว์เซอร์ที่ submit ฟอร์มขอ text/html เสมอ
  // ส่วน fetch() จะไม่ขอ — ทำให้แยกสองกรณีได้โดยไม่ต้องพึ่ง hidden field ที่บอทปลอมได้
  const wantsHtml = String(req.headers?.accept ?? '').includes('text/html');

  /// 303 บังคับให้เบราว์เซอร์เปลี่ยนเป็น GET — กัน "ส่งฟอร์มซ้ำ" ตอนผู้ใช้กดรีเฟรช
  const reply = (status, payload, redirectTo) => {
    if (wantsHtml && redirectTo) return res.redirect(303, redirectTo);
    return res.status(status).json(payload);
  };

  const lead = {
    name: clean(body.name),
    company: clean(body.company),
    phone: clean(body.phone),
    email: clean(body.email),
    businessType: clean(body.businessType),
    size: clean(body.size),
    volume: clean(body.volume),
    message: typeof body.message === 'string' ? body.message.trim().slice(0, 1000) : '',
    consent: body.consent === 'on' || body.consent === true || body.consent === 'true',
  };

  // honeypot: ช่องที่ซ่อนไว้ คนจริงมองไม่เห็นจึงไม่กรอก บอทกรอกทุกช่อง
  //
  // ⚠️ ไม่ทิ้งลีดเด็ดขาด — เก็บลง DB โดยติดธง spam ไว้แทน
  // เพราะ password manager กรอกช่องชื่อ "website" ให้คนจริงได้ ถ้าทิ้งเลย
  // ลีดที่จ่ายค่าคลิกมาแล้วจะหายเงียบโดยไม่มีใครรู้ว่าเคยมี
  const isSpam = Boolean(clean(body.website));
  if (isSpam) {
    // ตอบสำเร็จหลอกบอท เพื่อไม่ให้รู้ว่าโดนจับได้แล้วลองใหม่ด้วยวิธีอื่น
    await store(lead, true).catch((e) => console.error('SPAM_STORE_FAILED', String(e)));
    return reply(200, { ok: true }, '/thank-you/');
  }

  const errors = [];
  if (!lead.name) errors.push('name');
  if (!lead.phone || !isPhone(lead.phone)) errors.push('phone');
  if (lead.email && !isEmail(lead.email)) errors.push('email');
  // PDPA: ต้องได้รับความยินยอมก่อนเก็บข้อมูลส่วนบุคคล และ Google Ads บังคับด้วย
  if (!lead.consent) errors.push('consent');
  if (lead.businessType && !BUSINESS_TYPES.includes(lead.businessType)) errors.push('businessType');
  if (lead.size && !SIZES.includes(lead.size)) errors.push('size');
  if (lead.volume && !VOLUMES.includes(lead.volume)) errors.push('volume');

  if (errors.length) {
    // ส่งช่องที่ผิดกลับไปทาง query string ให้ฟอร์มไฮไลต์ได้ แม้ไม่มี JS
    return reply(
      400,
      { ok: false, error: 'validation', fields: errors },
      `/sample/?error=${encodeURIComponent(errors.join(','))}#form`
    );
  }

  /// log ลีดแบบเต็มเสมอ — ตาข่ายชั้นสุดท้ายถ้าทั้ง DB และ LINE ล้มพร้อมกัน
  /// (log ของ Vercel มีอายุจำกัด ไม่ใช่ที่เก็บถาวร จึงเป็นชั้นสุดท้ายจริง ๆ ไม่ใช่ชั้นหลัก)
  console.log(JSON.stringify({ event: 'lead', lead }));

  // ── ชั้นที่ 1: เก็บลงฐานข้อมูล (ตัวหลัก) ──
  let leadId = null;
  try {
    leadId = await store(lead, false);
  } catch (e) {
    console.error('LEAD_STORE_FAILED', JSON.stringify({ reason: String(e), lead }));
  }
  const storeOk = leadId !== null;

  // ── ชั้นที่ 2: แจ้งเตือน LINE (ตัวรอง) ──
  const stamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  const lines = [
    // เก็บไม่ได้ = ข้อความ LINE นี้คือสำเนาเดียวที่เหลือ ต้องบอกให้ชัดว่าห้ามปล่อยผ่าน
    !storeOk && '⚠️ ไม่ได้บันทึกลงฐานข้อมูล — คัดลอกเก็บไว้ก่อน',
    storeOk && `ลีด #${leadId}`,
    `ชื่อ: ${lead.name}`,
    lead.company && `ร้าน/บริษัท: ${lead.company}`,
    `เบอร์: ${lead.phone}`,
    lead.email && `อีเมล: ${lead.email}`,
    lead.businessType && `ประเภทธุรกิจ: ${lead.businessType}`,
    lead.size && `ขนาดที่สนใจ: ${lead.size}`,
    lead.volume && `ปริมาณต่อเดือน: ${lead.volume}`,
    lead.message && `ข้อความ: ${lead.message}`,
    `เวลา: ${stamp}`,
  ].filter(Boolean);

  let lineOk = false;
  try {
    lineOk = await pushLine(lines);
  } catch (e) {
    console.error('LINE_PUSH_FAILED', JSON.stringify({ reason: String(e), leadId }));
  }

  /// บันทึกว่าแจ้งแล้ว — ล้มได้ ไม่กระทบลูกค้า แค่ทำให้ /admin ดันแถวนี้ขึ้นบนโดยไม่จำเป็น
  if (storeOk && lineOk) {
    try {
      const sql = db();
      if (sql) await sql`UPDATE leads SET notified_at = now() WHERE id = ${leadId}`;
    } catch (e) {
      console.error('NOTIFIED_AT_FAILED', String(e));
    }
  }

  // ล้มทั้งคู่เท่านั้นถึงถือว่าลีดหาย — บอกความจริง ให้ลูกค้าทัก LINE เอง
  // ดีกว่าตอบ 200 แล้วเขานั่งรอสายที่ไม่มีวันโทรกลับ
  if (!storeOk && !lineOk) {
    console.error('LEAD_LOST', JSON.stringify({ lead }));
    return reply(502, { ok: false, error: 'delivery_failed' }, '/sample/?error=delivery#form');
  }

  return reply(200, { ok: true, id: leadId }, '/thank-you/');
}

/// เขียนลีดลง Neon แล้วคืน id — คืน null ถ้ายังไม่ได้ตั้ง DATABASE_URL
/// ไม่ใส่ unique index บนเบอร์โทร: ลูกค้าเก่ากลับมาถามใหม่ต้องเข้าได้เสมอ
/// ลีดซ้ำแก้ด้วยตาที่ /admin ได้ แต่ลีดที่ถูกปฏิเสธหายไปเลย
async function store(lead, spam) {
  const sql = db();
  if (!sql) return null;

  const [row] = await sql`
    INSERT INTO leads (name, company, phone, email, business_type, size, volume, message, consent, spam)
    VALUES (${lead.name}, ${lead.company || null}, ${lead.phone}, ${lead.email || null},
            ${lead.businessType || null}, ${lead.size || null}, ${lead.volume || null},
            ${lead.message || null}, ${lead.consent}, ${spam})
    RETURNING id
  `;
  return row.id;
}

/// แจ้งเตือนเข้า LINE ผ่าน Messaging API push
/// LINE Notify ปิดบริการไปแล้ว 31 มี.ค. 2025 จึงใช้ push ผ่าน LINE OA แทน
/// LINE_TO = userId หรือ groupId ของกลุ่มทีมขาย (ขึ้นต้นด้วย U หรือ C)
async function pushLine(lines) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.LINE_TO;
  if (!token || !to) return false;

  const res = await fetch(LINE_PUSH_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      // ข้อความ LINE จำกัด 5000 ตัวอักษร — ลีดเราสั้นกว่านั้นมาก
      messages: [{ type: 'text', text: `🌱 ลีดใหม่จากเว็บ\n\n${lines.join('\n')}` }],
    }),
    // ไม่ตัดเวลา = ปลายทางค้างแล้วลากเราไปตายด้วย
    signal: AbortSignal.timeout(LINE_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`line ${res.status}: ${await res.text()}`);
  return true;
}
