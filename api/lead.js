/// Vercel Function รับฟอร์มขอตัวอย่าง — วางที่ /api/ ระดับ root
/// ไม่ใช้ @astrojs/vercel adapter เพราะดึง path-to-regexp ที่มีช่องโหว่ high มาด้วย
/// วิธีนี้เว็บยังเป็น static 100% (เร็วกว่า ดีต่อ SEO) และ Vercel รัน function นี้ให้อยู่ดี
///
/// ลีดทุกอันมาจากเงินค่าโฆษณา — ห้ามหาย
/// จึงส่ง 2 ทาง (อีเมล + LINE) และถ้าล้มทั้งคู่ต้องตอบ error ให้ผู้ใช้รู้ว่าไม่สำเร็จ
/// ไม่ใช่ตอบ 200 แล้วลีดหายเงียบ

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  // ฟอร์มส่งมาแบบ urlencoded (ไม่ใช้ JS) แต่รองรับ JSON ด้วยเผื่อเรียกจากที่อื่น
  const body = req.body ?? {};

  // ฟอร์มธรรมดา (ไม่มี JS) ต้องได้หน้าเว็บกลับ ไม่ใช่ JSON ดิบ ๆ เต็มจอ
  // ตรวจจาก Accept header: เบราว์เซอร์ที่ submit ฟอร์มขอ text/html เสมอ
  // ส่วน fetch() จะไม่ขอ — ทำให้แยกสองกรณีได้โดยไม่ต้องพึ่ง hidden field ที่บอทปลอมได้
  const wantsHtml = String(req.headers?.accept ?? '').includes('text/html');

  /// 303 บังคับให้เบราว์เซอร์เปลี่ยนเป็น GET — กัน "ส่งฟอร์มซ้ำ" ตอนผู้ใช้กดรีเฟรช
  const reply = (status, payload, redirectTo) => {
    if (wantsHtml && redirectTo) return res.redirect(303, redirectTo);
    return res.status(status).json(payload);
  };

  // honeypot: ช่องที่ซ่อนไว้ คนจริงมองไม่เห็นจึงไม่กรอก บอทกรอกทุกช่อง
  // ตอบสำเร็จหลอกบอท เพื่อไม่ให้รู้ว่าโดนจับได้แล้วลองใหม่ด้วยวิธีอื่น
  if (clean(body.website)) {
    return reply(200, { ok: true }, '/thank-you/');
  }

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

  const stamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  const lines = [
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

  // ส่งสองทางพร้อมกัน ทางไหนล้มไม่ให้ฉุดอีกทาง
  const [mail, line] = await Promise.allSettled([sendEmail(lead, lines), pushLine(lines)]);

  const mailOk = mail.status === 'fulfilled' && mail.value;
  const lineOk = line.status === 'fulfilled' && line.value;

  // log ไว้เสมอ — ถ้าทั้งสองทางล้ม ยังกู้ลีดจาก Vercel runtime log ได้
  console.log(
    JSON.stringify({ event: 'lead', mailOk, lineOk, lead: { ...lead, message: undefined } })
  );

  if (!mailOk && !lineOk) {
    console.error('lead delivery failed', {
      mail: mail.status === 'rejected' ? String(mail.reason) : mail.value,
      line: line.status === 'rejected' ? String(line.reason) : line.value,
    });
    // บอกความจริงว่าส่งไม่สำเร็จ ให้ผู้ใช้โทรหรือทัก LINE แทน
    // ดีกว่าตอบ 200 แล้วเขานั่งรอสายที่ไม่มีวันโทรกลับ
    return reply(
      502,
      { ok: false, error: 'delivery_failed' },
      '/sample/?error=delivery#form'
    );
  }

  return reply(200, { ok: true }, '/thank-you/');
}

/// ส่งอีเมลผ่าน Resend — ถ้ายังไม่ได้ตั้ง env var จะข้ามไป (ไม่ throw)
/// ช่วงแรกที่ยังไม่มี API key ระบบยังใช้ได้ด้วย LINE ทางเดียว
async function sendEmail(lead, lines) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.LEAD_EMAIL_TO;
  const from = process.env.LEAD_EMAIL_FROM;
  if (!key || !to || !from) return false;

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: to.split(',').map((s) => s.trim()),
      // ตอบกลับไปหาลูกค้าได้ทันทีจากในอีเมล
      reply_to: lead.email || undefined,
      subject: `[ลีดใหม่] ${lead.name}${lead.company ? ` — ${lead.company}` : ''}`,
      html: `<h2>ขอตัวอย่างหลอดชานอ้อย</h2><ul>${lines
        .map((l) => `<li>${esc(l)}</li>`)
        .join('')}</ul>`,
    }),
  });

  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
  return true;
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
  });

  if (!res.ok) throw new Error(`line ${res.status}: ${await res.text()}`);
  return true;
}
