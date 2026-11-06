// Public lead form: validate, shared rate limit, idempotent storage, and queued LINE delivery.
// If notification fails after saving, keep the lead and retry through maintenance/admin.
import { normalizePhone } from '../lib/phone.js';
import { neon } from '@neondatabase/serverless';
import { limit, attribution, validUUID } from '../lib/core.js';
import { notifyLead, push, leadMessage } from '../lib/notifications.js';



/// timeout ทั้งสองขา — งานนี้มี maxDuration จำกัด ถ้าปลายทางค้างแล้วเราไม่ตัด
/// function จะโดน Vercel ฆ่ากลางคัน ลูกค้าเห็นหน้า error ดิบของ Vercel
/// (ไม่ใช่ /thank-you/ ไม่ใช่แบนเนอร์ของเรา) ทั้งที่แถวอาจลง DB ไปแล้ว
const DB_TIMEOUT_MS = 5000;


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
  return neon(url, { fetchOptions: { get signal(){return AbortSignal.timeout(DB_TIMEOUT_MS)} } });
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
    phone: normalizePhone(body.phone),
    email: clean(body.email),
    businessType: clean(body.businessType),
    size: clean(body.size),
    volume: clean(body.volume),
    message: typeof body.message === 'string' ? body.message.trim().slice(0, 1000) : '',
    consent: body.contactRequest === 'sample-v2' || body.consent === 'on' || body.consent === true || body.consent === 'true',
  };

  const isSpam = Boolean(clean(body.website));
  const allConsent=body.allConsent==='on'||body.allConsent==='true'||body.allConsent===true;
  const explicit=allConsent||body.consentVersion==='2'||Object.hasOwn(body,'analyticsConsent')||Object.hasOwn(body,'adsConsent');
  const analytics=allConsent|| (explicit?(body.analyticsConsent==='true'||body.analyticsConsent===true):body.measurementConsent==='accepted');
  const ads=allConsent|| (explicit?(body.adsConsent==='true'||body.adsConsent===true):body.measurementConsent==='accepted');
  lead.attribution = analytics||ads ? attribution(body.attribution) : {};
  if(!ads)for(const touch of ['first','last'])if(lead.attribution[touch])for(const key of ['gclid','gbraid','wbraid'])delete lead.attribution[touch][key];
  lead.attribution._consent={version:explicit?2:1,analytics,ads,source:allConsent?'form':['form','banner','settings'].includes(body.consentSource)?body.consentSource:'form_submission',recordedAt:new Date().toISOString()};
  lead.submissionId = validUUID(body.submissionId) ? body.submissionId : null;
  const sql = db();
  try {
    if (!sql) throw new Error('database_unavailable');
    const rate = await limit(sql, req, 'lead', 5, 600);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfter));
      return reply(429, {ok:false,error:'rate_limit'}, '/sugarcane-straw/?error=rate_limit#form');
    }
  } catch {
    // Without the shared limiter, reject with a retry message instead of allowing an unbounded flood.
    return reply(503, {ok:false,error:'temporarily_unavailable'}, '/sugarcane-straw/?error=delivery#form');
  }

  const errors = [];
  if (!lead.name) errors.push('name');
  if (!lead.phone) errors.push('phone');
  if (lead.email && !isEmail(lead.email)) errors.push('email');
  // A request to be contacted is separate from optional analytics/advertising consent.
  if (!lead.consent) errors.push('consent');
  if (lead.businessType && !BUSINESS_TYPES.includes(lead.businessType)) errors.push('businessType');
  if (lead.size && !SIZES.includes(lead.size)) errors.push('size');
  if (lead.volume && !VOLUMES.includes(lead.volume)) errors.push('volume');

  if (errors.length) {
    // ส่งช่องที่ผิดกลับไปทาง query string ให้ฟอร์มไฮไลต์ได้ แม้ไม่มี JS
    return reply(
      400,
      { ok: false, error: 'validation', fields: errors },
      `/sugarcane-straw/?error=${encodeURIComponent(errors.join(','))}#form`
    );
  }

  let saved;
  try { saved = await store(lead, isSpam); }
  catch {
    console.error('LEAD_STORE_FAILED');
    if (!isSpam) {
      const fallback = await push('⚠️ ไม่ได้บันทึกลงฐานข้อมูล — คัดลอกเก็บไว้ก่อน\n' + leadMessage({
        ...lead,id:'รอบันทึก',business_type:lead.businessType,created_at:new Date().toISOString(),
      }));
      if (fallback.ok) return reply(200,{ok:true},'/thank-you/');
    }
    return reply(502,{ok:false,error:'delivery_failed'},'/sugarcane-straw/?error=delivery#form');
  }
  if (!saved) return reply(502,{ok:false,error:'delivery_failed'},'/sugarcane-straw/?error=delivery#form');
  if (!isSpam && saved.inserted) {
    try { await notifyLead(sql,saved.id); }
    catch { console.error('LINE_NOTIFICATION_PENDING',JSON.stringify({leadId:saved.id})); }
  }
  return reply(200,{ok:true,id:saved.id,duplicate:!saved.inserted},'/thank-you/');
}

/// เขียนลีดลง Neon แล้วคืน id — คืน null ถ้ายังไม่ได้ตั้ง DATABASE_URL
/// ไม่ใส่ unique index บนเบอร์โทร: ลูกค้าเก่ากลับมาถามใหม่ต้องเข้าได้เสมอ
/// ลีดซ้ำแก้ด้วยตาที่ /admin ได้ แต่ลีดที่ถูกปฏิเสธหายไปเลย
async function store(lead, spam) {
  const sql = db();
  if (!sql) return null;
  const [row] = await sql`
    INSERT INTO leads (name, company, phone, phone_key, email, business_type, size, volume, message, consent, spam, attribution, submission_id)
    VALUES (${lead.name}, ${lead.company || null}, ${lead.phone}, ${lead.phone}, ${lead.email || null},
            ${lead.businessType || null}, ${lead.size || null}, ${lead.volume || null},
            ${lead.message || null}, ${lead.consent}, ${spam}, ${JSON.stringify(lead.attribution)}::jsonb, ${lead.submissionId})
    ON CONFLICT (submission_id) DO NOTHING RETURNING id
  `;
  if (row) return {...row,inserted:true};
  const [existing] = await sql`SELECT id FROM leads WHERE submission_id=${lead.submissionId}`;
  return existing ? {...existing,inserted:false} : null;
}
