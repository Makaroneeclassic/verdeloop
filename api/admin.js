/// หน้าหลังบ้านดูลีด — เปิดที่ /api/admin
///
/// ทำไมเป็น Vercel Function ไม่ใช่หน้า .astro:
/// เว็บนี้เป็น static ทั้งหมด (ไม่มี adapter) หน้า .astro ทุกหน้าถูกเรนเดอร์ตอน build
/// ถ้าเขียนเป็นหน้า .astro โค้ดเช็ครหัสผ่านจะรันบนเครื่องเราตอน npm run build ครั้งเดียว
/// แล้วข้อมูลลีดทั้งหมดจะถูกอบลงไฟล์ HTML ที่ใครก็โหลดได้ = ฐานลีดหลุดทั้งก้อน
///
/// ยังไม่ทำ rewrite /admin → /api/admin เพราะ source ต้องแยกทั้งแบบมีและไม่มี / ท้าย
/// (ทุกลิงก์ในเว็บนี้เป็น /sample/ /privacy/ เจ้าของจะพิมพ์ /admin/ ติดมือ)
import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const PAGE_SIZE = 100;
const DB_TIMEOUT_MS = 8000;

/// สร้างใหม่ทุกครั้ง ห้าม cache — AbortSignal.timeout() เริ่มนับตั้งแต่วินาทีที่สร้าง
/// ถ้าเก็บ client ไว้ข้าม request สัญญาณจะหมดอายุแล้วทุก query จะ abort ทิ้งทันที
function db() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return neon(url, { fetchOptions: { signal: AbortSignal.timeout(DB_TIMEOUT_MS) } });
}

/// ข้อมูลลีดคือข้อความที่คนนอกพิมพ์เข้ามา ถ้าต่อเป็น HTML ดิบ ๆ
/// คนยิงฟอร์มใส่ <script> ได้ = ยิง XSS ใส่เจ้าของเว็บเองตอนเปิดหน้านี้
/// ต้อง escape ทุกช่องโดยไม่มีข้อยกเว้น
const esc = (v) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const fmt = (d) =>
  d ? new Date(d).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '—';

/// เทียบรหัสแบบไม่รั่วเวลา
/// timingSafeEqual โยน RangeError ถ้าความยาวสองฝั่งไม่เท่ากัน — ซึ่งเกิดแน่นอนเวลาใส่รหัสผิด
/// แฮชให้เป็น 32 ไบต์เท่ากันก่อน จึงตัดปัญหาความยาวทิ้ง และไม่รั่วความยาวรหัสจริงด้วย
const same = (a, b) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASSWORD;

  /// ไม่ได้ตั้งรหัส = ปิดประตูไว้ก่อน ห้ามปล่อยผ่านเด็ดขาด
  /// ถ้าเผลอเขียนให้ "ไม่มีรหัส = ไม่ต้องตรวจ" ฐานลีดทั้งก้อนจะเปิดสาธารณะทันทีที่ env หลุด
  if (!user || !pass) {
    console.error('ADMIN_ENV_MISSING');
    return res.status(500).send(page('ยังไม่ได้ตั้ง ADMIN_USER / ADMIN_PASSWORD ใน Vercel'));
  }

  const auth = String(req.headers.authorization ?? '');
  if (!auth.startsWith('Basic ')) return challenge(res);

  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  // แยกที่ : ตัวแรกเท่านั้น — split(':') จะทำให้รหัสผ่านที่มี : อยู่ข้างในพัง
  const i = decoded.indexOf(':');
  if (i < 0) return challenge(res);

  if (!same(decoded.slice(0, i), user) || !same(decoded.slice(i + 1), pass)) {
    return challenge(res);
  }

  const sql = db();
  if (!sql) return res.status(500).send(page('ยังไม่ได้ตั้ง DATABASE_URL ใน Vercel'));

  if (req.method === 'POST') return remove(req, res, sql);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).send(page('ใช้ได้เฉพาะ GET กับ POST'));
  }

  return list(req, res, sql);
}

function challenge(res) {
  res.setHeader('WWW-Authenticate', 'Basic realm="Verdeloop Admin", charset="UTF-8"');
  return res.status(401).send(page('ต้องใส่รหัสผ่านก่อน'));
}

/// ลบลีด (สิทธิ์ขอลบตาม PDPA — ลูกค้าขอมาต้องทำให้ได้ภายใน 30 วัน)
///
/// ⚠️ ต้องกัน CSRF: เบราว์เซอร์แนบรหัส Basic Auth ให้อัตโนมัติทุก request ที่ยิงไปโดเมนนี้
/// ฟอร์ม urlencoded จากเว็บอื่นเป็น CORS-simple request → ไม่มี preflight → ยิงลบได้จริง
/// (คนยิงอ่านผลลัพธ์ไม่ได้ แต่การลบเป็นความเสียหายทางเดียวอยู่แล้ว อ่านไม่ได้ก็ไม่ช่วยอะไร)
/// กันด้วยการบังคับให้ Origin ตรงกับโดเมนตัวเอง ไม่ตรงหรือไม่มี = ปฏิเสธ
async function remove(req, res, sql) {
  const proto = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0];
  const expect = `${proto}://${req.headers.host}`;
  const origin = req.headers.origin;

  if (origin !== expect) {
    console.error('ADMIN_CSRF_BLOCKED', JSON.stringify({ origin: origin ?? null, expect }));
    return res.status(403).send(page('คำขอไม่ได้มาจากหน้านี้ ปฏิเสธการลบ'));
  }

  let body;
  try {
    body = req.body ?? {};
  } catch {
    return res.status(400).send(page('ข้อมูลที่ส่งมาไม่ถูกต้อง'));
  }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).send(page('id ไม่ถูกต้อง'));

  const rows = await sql`DELETE FROM leads WHERE id = ${id} RETURNING id`;
  console.log(JSON.stringify({ event: 'lead_deleted', id, found: rows.length > 0 }));

  // 303 กันกดรีเฟรชแล้วยิงลบซ้ำ และพากลับไปหน้าเดิมที่ค้างไว้
  const back = typeof body.back === 'string' && /^\d+$/.test(body.back) ? `?before=${body.back}` : '';
  return res.redirect(303, `/api/admin${back}`);
}

async function list(req, res, sql) {
  const raw = new URL(req.url, 'http://x').searchParams.get('before');
  const before = raw && /^\d+$/.test(raw) ? Number(raw) : null;

  /// แถวที่ push LINE ไม่สำเร็จ (notified_at เป็น NULL) = ยังไม่มีใครรู้ว่ามีลีดนี้
  /// ดึงแยกมาโชว์บนสุดเสมอ ไม่ปนกับการแบ่งหน้า — ไม่งั้นลีดที่ไม่มีใครเห็นจะจมอยู่หน้า 3
  const unseen = await sql`
    SELECT * FROM leads WHERE notified_at IS NULL AND spam = false ORDER BY id DESC LIMIT 50
  `;

  /// แบ่งหน้าแบบ keyset (ไล่ตาม id) ไม่ใช่ OFFSET — ทำตั้งแต่แรกเพราะย้อนมาใส่ทีหลังในโค้ดที่ต่อ HTML เป็น string เจ็บกว่า
  const rows = before
    ? await sql`SELECT * FROM leads WHERE id < ${before} ORDER BY id DESC LIMIT ${PAGE_SIZE}`
    : await sql`SELECT * FROM leads ORDER BY id DESC LIMIT ${PAGE_SIZE}`;

  const [{ total }] = await sql`SELECT count(*)::int AS total FROM leads`;
  const next = rows.length === PAGE_SIZE ? rows[rows.length - 1].id : null;

  const body = `
    <header>
      <h1>ลีดจากเว็บ Verdeloop</h1>
      <p class="muted">ทั้งหมด ${total} รายการ · เวลาไทย (Asia/Bangkok)</p>
    </header>

    ${
      unseen.length
        ? `<section class="warn">
             <h2>⚠️ ยังไม่ได้แจ้งเข้า LINE (${unseen.length} รายการ)</h2>
             <p class="muted">แจ้งเตือนล้มเหลว อาจยังไม่มีใครเห็นลีดพวกนี้ ติดต่อกลับด่วน</p>
             ${unseen.map((r) => card(r, before)).join('')}
           </section>`
        : ''
    }

    <section>
      <h2>ทั้งหมด</h2>
      ${rows.length ? rows.map((r) => card(r, before)).join('') : '<p class="muted">ยังไม่มีลีด</p>'}
    </section>

    ${next ? `<p><a class="more" href="/api/admin?before=${next}">ดูรายการเก่ากว่านี้ →</a></p>` : ''}
    ${before ? `<p><a class="more" href="/api/admin">← กลับไปหน้าล่าสุด</a></p>` : ''}
  `;

  return res.status(200).send(page(body, true));
}

function card(r, back) {
  const phone = esc(r.phone);
  // เบอร์ผ่าน isPhone มาแล้ว (ตัวเลข 9–10 หลัก) จึงเอาไปทำลิงก์ tel: ได้ปลอดภัย
  const tel = String(r.phone ?? '').replace(/[^0-9]/g, '');

  const rows = [
    ['ร้าน/บริษัท', r.company],
    ['อีเมล', r.email],
    ['ประเภทธุรกิจ', r.business_type],
    ['ขนาด', r.size],
    ['ปริมาณ/เดือน', r.volume],
  ].filter(([, v]) => v);

  return `
    <article class="lead${r.spam ? ' spam' : ''}">
      <div class="head">
        <span class="id">#${r.id}</span>
        <strong>${esc(r.name)}</strong>
        ${r.spam ? '<span class="tag">น่าจะเป็นบอท</span>' : ''}
        ${r.notified_at ? '' : '<span class="tag warn-tag">ไม่ได้แจ้ง LINE</span>'}
      </div>
      <p class="phone"><a href="tel:${esc(tel)}">${phone}</a></p>
      ${rows.map(([k, v]) => `<p><span class="k">${k}</span> ${esc(v)}</p>`).join('')}
      ${r.message ? `<pre class="msg">${esc(r.message)}</pre>` : ''}
      <p class="muted small">เข้ามา ${esc(fmt(r.created_at))} · แจ้ง LINE ${esc(fmt(r.notified_at))}</p>
      <form method="POST" action="/api/admin" onsubmit="return confirm('ลบลีด #${r.id} ถาวร?')">
        <input type="hidden" name="id" value="${r.id}" />
        ${back ? `<input type="hidden" name="back" value="${back}" />` : ''}
        <button type="submit">ลบถาวร</button>
      </form>
    </article>`;
}

/// เขียน CSS ฝังในไฟล์ ไม่ดึงจากภายนอก — หน้านี้ต้องเปิดได้แม้เว็บหลักล่ม
/// สีเขียวเข้ม/ครีมให้เข้าชุดกับเว็บ แต่ไม่แชร์ไฟล์กับเว็บหลักเพื่อไม่ให้พังตามกัน
function page(inner, wide = false) {
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>หลังบ้าน Verdeloop</title>
<style>
  :root { color-scheme: light }
  body { margin:0; padding:1.5rem 1rem 4rem; background:#faf7ef; color:#1b3025;
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; line-height:1.6 }
  main { max-width:${wide ? '52rem' : '32rem'}; margin:0 auto }
  h1 { font-size:1.5rem; margin:0 0 .25rem }
  h2 { font-size:1.05rem; margin:2rem 0 .75rem; color:#2f5a45 }
  p { margin:.2rem 0 }
  .muted { color:#5b7266 }
  .small { font-size:.8rem; margin-top:.6rem }
  .lead { border:1px solid #d6e0d8; background:#fff; padding:1rem 1.1rem; margin-bottom:.85rem }
  .lead.spam { opacity:.55 }
  .head { display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; margin-bottom:.4rem }
  .head strong { font-size:1.05rem }
  .id { font-variant-numeric:tabular-nums; color:#8a9c92; font-size:.85rem }
  .tag { font-size:.7rem; background:#e8ece9; color:#5b7266; padding:.1rem .45rem; border-radius:2px }
  .warn-tag { background:#fde8e8; color:#a11 }
  .phone a { font-size:1.15rem; font-weight:600; color:#1b3025 }
  .k { display:inline-block; min-width:8rem; color:#5b7266; font-size:.85rem }
  /* ข้อความยาวได้ถึง 1000 ตัวและมีขึ้นบรรทัดใหม่ — ต้อง pre-wrap ไม่งั้นยุบเป็นบรรทัดเดียว */
  .msg { white-space:pre-wrap; word-break:break-word; background:#f2f5f2; padding:.65rem .8rem;
         margin:.6rem 0 0; font:inherit; font-size:.9rem }
  .warn { border-left:4px solid #c33; padding-left:1rem }
  form { margin-top:.75rem }
  button { background:none; border:1px solid #d99; color:#a11; padding:.3rem .8rem; cursor:pointer; font:inherit; font-size:.85rem }
  button:hover { background:#fde8e8 }
  .more { display:inline-block; margin-top:1.5rem; color:#2f5a45; font-weight:600 }
</style>
</head>
<body><main>${inner}</main></body>
</html>`;
}
