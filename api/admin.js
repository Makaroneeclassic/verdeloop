import {staffLogin,canManage,canEdit} from '../lib/staff.js';
import {filters,leadRows,leadCSV} from '../lib/crm.js';
import {crmActions,settingsAction,updateLead} from '../lib/crm-actions.js';
import {lineTrackingUI} from '../lib/line-tracking-ui.js';
import {teamUI,salesFields,integrationsUI} from '../lib/crm-ui.js';
import {lineSettings,readIntegration} from '../lib/integrations.js';
import {offlineCSV} from '../lib/ads-offline.js';
import { normalizePhone } from '../lib/phone.js';
/// หน้าหลังบ้านดูลีด — เปิดที่ /admin
///
/// ทำไมเป็น Vercel Function ไม่ใช่หน้า .astro:
/// เว็บนี้เป็น static ทั้งหมด (ไม่มี adapter) หน้า .astro ทุกหน้าถูกเรนเดอร์ตอน build
/// ถ้าเขียนเป็นหน้า .astro โค้ดเช็ครหัสผ่านจะรันบนเครื่องเราตอน npm run build ครั้งเดียว
/// แล้วข้อมูลลีดทั้งหมดจะถูกอบลงไฟล์ HTML ที่ใครก็โหลดได้ = ฐานลีดหลุดทั้งก้อน
///
/// Vercel rewrite ให้ /admin เรียก function นี้ โดยไม่สร้างหน้าข้อมูลลูกค้าแบบ static
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { SALES_STATUSES, limit } from '../lib/core.js';
import { retryPending, notifyLead } from '../lib/notifications.js';
import { maintenance } from '../lib/maintenance.js';
import { makeBackup, encryptBackup } from '../lib/backup.js';
import { uploadDocument, removeDocument } from '../lib/documents.js';

const WRITER_ACTIONS = ['writer_settings','writer_check','writer_new','writer_save','writer_generate','writer_publish','writer_unpublish'];
const PAGE_SIZE = 100;
const DB_TIMEOUT_MS = 8000;

/// สร้างใหม่ทุกครั้ง ห้าม cache — AbortSignal.timeout() เริ่มนับตั้งแต่วินาทีที่สร้าง
/// ถ้าเก็บ client ไว้ข้าม request สัญญาณจะหมดอายุแล้วทุก query จะ abort ทิ้งทันที
function db() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return neon(url, { fetchOptions: { get signal(){return AbortSignal.timeout(DB_TIMEOUT_MS)} } });
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

const SESSION_COOKIE = '__Host-verdeloop_admin';
const SESSION_SECONDS = 8 * 60 * 60;

function sessionKey() {
  return createHash('sha256').update(JSON.stringify([
    'verdeloop-admin-session-v1', process.env.ADMIN_USER, process.env.ADMIN_PASSWORD,
  ])).digest();
}

function signature(payload) {
  return createHmac('sha256', sessionKey()).update(payload).digest('base64url');
}

function newSession(staff=null) {
  const payload = Buffer.from(JSON.stringify({
    staffId:staff?.id,staffVersion:staff?.session_version,
    expires: Date.now() + SESSION_SECONDS * 1000,
    nonce: randomBytes(24).toString('base64url'),
  })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

function authenticated(req) {
  const value = String(req.headers.cookie ?? '').split(';').map(x => x.trim())
    .find(x => x.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!value || value.length > 1024) return false;
  const [payload, sig, extra] = value.split('.');
  if (!payload || !sig || extra || !same(sig, signature(payload))) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return Number.isSafeInteger(session.expires) && session.expires > Date.now()
      && session.expires <= Date.now() + SESSION_SECONDS * 1000 ? session : false;
  } catch { return false; }
}

function setSession(res, value, age = SESSION_SECONDS) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'none'; form-action 'self'");

  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASSWORD;
  if (!user || !pass) {
    return res.status(503).send(page('<h1>ระบบกำลังเตรียมพร้อม</h1><p>กรุณาลองใหม่อีกครั้งในภายหลัง</p>'));
  }
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).send(page('ไม่รองรับคำขอนี้'));
  }

  if (req.method === 'POST') {
    const proto = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0];
    if (req.headers.origin !== `${proto}://${req.headers.host}`) {
      return res.status(403).send(page('<h1>ไม่สามารถทำรายการได้</h1><p>กรุณากลับไปทำรายการจาก <a href="/admin">หน้าหลังบ้าน</a></p>'));
    }
    let body;
    try { body = req.body ?? {}; } catch { return res.status(400).send(loginPage('กรุณากรอกข้อมูลอีกครั้ง')); }
    if (body.action === 'login') {
      const loginDb=db();
      if(loginDb) {
        try {const rate=await limit(loginDb,req,'admin-login',10,900);if(!rate.allowed){res.setHeader('Retry-After',String(rate.retryAfter));return res.status(429).send(loginPage('ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอแล้วลองใหม่'));}}
        catch{return res.status(503).send(loginPage('ระบบขัดข้องชั่วคราว กรุณาลองใหม่'));}
      }
      const name = typeof body.username === 'string' ? body.username.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const validName = same(name, user);
      const validPassword = same(password, pass);
      let staff=null;
      if(!(validName&&validPassword)&&loginDb){try{staff=await staffLogin(loginDb,name,password);}catch{return res.status(503).send(loginPage('ระบบขัดข้องชั่วคราว'));}}
      if (!(validName && validPassword) && !staff) {
        await new Promise(resolve => setTimeout(resolve, 350));
        return res.status(401).send(loginPage('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', name.slice(0, 100)));
      }
      setSession(res, newSession(staff));
      return res.redirect(303, '/admin');
    }
    if (body.action === 'logout') {
      setSession(res, '', 0);
      return res.redirect(303, '/admin');
    }
    if (!authenticated(req)) return res.status(401).send(loginPage('กรุณาเข้าสู่ระบบเพื่อทำรายการ'));
    if (!['delete','update','retry','maintenance','backup','document_upload','document_delete','retry_confirmed',...crmActions,...WRITER_ACTIONS].includes(body.action)) return res.status(400).send(page('ไม่รองรับรายการนี้'));
  } else if (!authenticated(req)) {
    return res.status(200).send(loginPage());
  }

  const sql = db();
  if (!sql) return res.status(503).send(page('<h1>ยังโหลดข้อมูลไม่ได้</h1><p>กรุณาลองใหม่ภายหลัง</p>'));
  try {
    const session=authenticated(req);
    let actor={id:null,username:user,display_name:user,role:'owner'};
    if(session.staffId){const [staff]=await sql`SELECT id,username,display_name,role FROM staff_users WHERE id=${session.staffId}::uuid AND active=true AND session_version=${session.staffVersion}`;if(!staff){setSession(res,'',0);return res.status(401).send(loginPage('บัญชีหรือสิทธิ์มีการเปลี่ยนแปลง กรุณาเข้าสู่ระบบใหม่'));}actor=staff;}
    req.actor=actor;
    if(WRITER_ACTIONS.includes(req.body?.action) || (req.method==='GET' && new URL(req.url,'https://verdeloopthailand.com').searchParams.get('view')==='writer')) {
      const writer=await import('../lib/writer.js');
      return req.method==='POST' ? await writer.writerPost(req,res,sql) : await writer.writerGet(req,res,sql,page);
    }
    return req.method === 'POST' ? await mutate(req, res, sql) : await list(req, res, sql);
  } catch (error) {
    console.error('ADMIN_DATABASE_FAILED', JSON.stringify({
      name: error?.name, code: error?.code,
      sharp: String(error?.message).includes('sharp'),
      module: /module|package/.test(String(error?.message)),
      writer: String(error?.message).includes('writer'),
    }));
    return res.status(503).send(page('<h1>ยังโหลดข้อมูลไม่ได้</h1><p>กรุณา <a href="/admin">ลองอีกครั้ง</a></p>'));
  }
}

function loginPage(error = '', username = '') {
  return page(`
    <div class="login-shell">
      <aside class="welcome">
        <a class="brand" href="/"><img src="/img/verdeloop-logo.png" width="640" height="139" alt="Verdeloop" /></a>
        <div class="welcome-copy"><span class="eyebrow">เติบโตไปด้วยกัน</span>
          <h2>ทุกการติดต่อ<br>คือจุดเริ่มต้นที่ดี</h2>
          <p>ดูแลคำขอตัวอย่างและข้อมูลลูกค้า<br>ให้ทุกโอกาสได้รับการตอบกลับ</p>
        </div>
        <p class="welcome-foot">หลอดชานอ้อย เพื่อทางเลือกที่ยั่งยืน</p>
      </aside>
      <section class="login-panel">
        <span class="eyebrow">สำหรับผู้ดูแลเว็บไซต์</span>
        <h1>ยินดีต้อนรับกลับ</h1>
        <p class="muted intro">เข้าสู่ระบบเพื่อจัดการลูกค้าของ Verdeloop</p>
        ${error ? `<p class="login-error" role="alert">${esc(error)}</p>` : ''}
        <form method="POST" action="/admin" class="login-form">
          <input type="hidden" name="action" value="login" />
          <label for="username">ชื่อผู้ใช้</label>
          <input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="100" value="${esc(username)}" required />
          <label for="password">รหัสผ่าน</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required />
          <button type="submit" class="primary">เข้าสู่ระบบ <span aria-hidden="true">→</span></button>
        </form>
        <p class="login-help">หากลืมรหัสผ่าน กรุณาติดต่อผู้ดูแลระบบ</p>
        <a href="/" class="back-link">← กลับหน้าเว็บไซต์</a>
      </section>
    </div>`, false, true);
}

async function mutate(req, res, sql) {
  const body=req.body;
  if(crmActions.includes(body.action)){if(!canManage(req.actor))return res.status(403).send(page('ไม่มีสิทธิ์จัดการระบบ'));try{const message=await settingsAction(sql,body,req.actor);return res.redirect(303,'/admin?notice='+encodeURIComponent(message)+(body.action.startsWith('staff')?'#team':'#integrations'));}catch(error){return res.status(400).send(page('<p>'+esc(error.name==='FormError'?error.message:'ระบบขัดข้องชั่วคราว กรุณาลองใหม่')+'</p><a href="/admin">กลับหลังบ้าน</a>'));}}
  if(!['update'].includes(body.action)&&!canManage(req.actor))return res.status(403).send(page('รายการนี้ต้องใช้สิทธิ์ผู้ดูแล'));
  if(body.action==='document_upload'){try{const file=await uploadDocument(sql,body);return res.status(200).json({ok:true,id:file.id});}catch{return res.status(400).json({ok:false,error:'อัปโหลดไม่ได้ กรุณาใช้ PDF ไม่เกิน 3 MB และตรวจการเชื่อมต่อ'});}}
  if(body.action==='document_delete'){await removeDocument(sql,body.documentId);return res.redirect(303,'/admin#documents');}
  if(body.action==='delete')return remove(req,res,sql);
  if(body.action==='maintenance') {await maintenance();return res.redirect(303,'/admin#system');}
  if(body.action==='backup') {
    const buffer=encryptBackup(await makeBackup(sql));
    res.setHeader('Content-Type','application/octet-stream');
    res.setHeader('Content-Disposition',`attachment; filename="verdeloop-${new Date().toISOString().slice(0,10)}.json.enc"`);
    return res.status(200).send(buffer);
  }
  const id=String(body.id||'');
  if(!/^\d+$/.test(id))return res.status(400).send(page('รายการไม่ถูกต้อง'));
  if(body.action==='retry_confirmed') {
    if(body.confirmed!=='on')return res.status(400).send(page('โปรดตรวจว่าไม่มีข้อความนี้ใน LINE ก่อนส่งใหม่'));
    await sql`UPDATE leads SET notify_key=${randomUUID()},notify_attempts=0,notify_started_at=NULL,notify_error=NULL,notify_after=now(),notify_locked_until=NULL WHERE id=${id} AND notified_at IS NULL AND notify_attempts>=5`;
    await notifyLead(sql,id);return res.redirect(303,`/admin#lead-${id}`);
  }
  if(body.action==='retry') {
    // Retry only within the safe idempotency window; uncertain expired requests need review.
    await sql`UPDATE leads SET notify_after=now() WHERE id=${id} AND notify_attempts<5`;
    await notifyLead(sql,id);
    return res.redirect(303,`/admin#lead-${id}`);
  }
  try{const result=await updateLead(sql,body,req.actor);if(result.status!==303)return res.status(result.status).send(page('<p>'+esc(result.message)+'</p><a href="/admin">กลับหลังบ้าน</a>'));}catch(error){return res.status(400).send(page('<p>'+esc(error.name==='FormError'?error.message:'ระบบขัดข้องชั่วคราว กรุณาลองใหม่')+'</p><a href="/admin">กลับหลังบ้าน</a>'));}
  return res.redirect(303,`/admin#lead-${id}`);
}

/// ลบลีด (สิทธิ์ขอลบตาม PDPA — ลูกค้าขอมาต้องทำให้ได้ภายใน 30 วัน)
///
/// ⚠️ ต้องกัน CSRF: เบราว์เซอร์แนบ session cookie ให้อัตโนมัติทุก request ที่ยิงไปโดเมนนี้
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
  return res.redirect(303, `/admin${back}`);
}

async function list(req,res,sql) {
  const params=new URL(req.url,'https://verdeloopthailand.com').searchParams;
  const f=filters(params),{before,status,q}=f,due=f.view==='due',actor=req.actor,manager=canManage(actor);
  if(params.get('export')==='leads'){const exported=await leadRows(sql,actor,{...f,before:null},20001);if(exported.length>20000)return res.status(400).send(page('ข้อมูลเกิน 20,000 รายการ กรุณาใช้ตัวกรอง'));res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="verdeloop-customers.csv"');return res.status(200).send(leadCSV(exported));}
  if(params.get('export')==='ads'){if(!manager)return res.status(403).send(page('ไม่มีสิทธิ์'));const config=await readIntegration(sql,'ads');const queue=await sql`SELECT * FROM ads_conversions WHERE status IN ('pending','failed') AND payload ? 'gclid' ORDER BY created_at LIMIT 20000`;if(queue.some(r=>!(r.kind==='won'?config.wonName:config.qualifiedName)))return res.status(400).send(page('กรอกชื่อ Conversion สำหรับ CSV ให้ครบก่อนดาวน์โหลด <a href="/admin#integrations">กลับตั้งค่า</a>'));res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="verdeloop-ads.csv"');return res.status(200).send(offlineCSV(queue,config));}
  const rows=await leadRows(sql,actor,f,PAGE_SIZE);
  const scope=manager||actor.role==='viewer';
  const [totals]=await sql`SELECT count(*)::int AS total,count(*) FILTER(WHERE sales_status='new' AND spam=false)::int AS fresh,count(*) FILTER(WHERE notified_at IS NULL AND spam=false)::int AS pending,count(*) FILTER(WHERE follow_up_at<=now() AND sales_status NOT IN ('won','lost') AND spam=false)::int AS due,count(*) FILTER(WHERE (follow_up_at AT TIME ZONE 'Asia/Bangkok')::date=(now() AT TIME ZONE 'Asia/Bangkok')::date AND sales_status NOT IN ('won','lost') AND spam=false)::int AS today,count(*) FILTER(WHERE (follow_up_at AT TIME ZONE 'Asia/Bangkok')::date<(now() AT TIME ZONE 'Asia/Bangkok')::date AND sales_status NOT IN ('won','lost') AND spam=false)::int AS overdue,count(*) FILTER(WHERE sales_status='won')::int AS won FROM leads WHERE (${scope} OR assigned_to=${actor.id}::uuid OR assigned_to IS NULL)`;
  const staff=await sql`SELECT id,username,display_name,role,active FROM staff_users ORDER BY created_at`;
  const lineTracking=manager?await readIntegration(sql,'line_tracking'):{};
  const lineStats=manager?await sql`SELECT s.path,s.placement,count(*)::int AS verified FROM line_friend_conversions c JOIN line_login_sessions s ON s.id=c.session_id WHERE c.created_at>now()-interval '30 days' GROUP BY 1,2 ORDER BY verified DESC LIMIT 30`:[];
  const lineClicks=manager?await sql`SELECT placement,count(*)::int AS clicks FROM contact_events WHERE event='line_click' AND created_at>now()-interval '30 days' GROUP BY 1 ORDER BY clicks DESC`:[];
  const line=manager?await lineSettings(sql):{},ads=manager?await readIntegration(sql,'ads'):{};
  const lineGroups=manager?await sql`SELECT value FROM system_state WHERE key LIKE 'line_group:%' ORDER BY updated_at DESC LIMIT 30`:[];
  const reminders=manager?await sql`SELECT id,lead_id,status,error,attempts FROM followup_reminders ORDER BY scheduled_at DESC LIMIT 20`:[];
  const conversions=manager?await sql`SELECT id,lead_id,kind,status,error FROM ads_conversions ORDER BY created_at DESC LIMIT 30`:[];
  const events=await sql`SELECT event,count(*)::int AS count FROM contact_events WHERE created_at>now()-interval '30 days' GROUP BY event`;
  const campaigns=await sql`SELECT COALESCE(NULLIF(attribution#>>'{last,utm_source}',''),NULLIF(attribution#>>'{last,referrer}',''),'ไม่ได้ระบุ') AS source,COALESCE(attribution#>>'{last,utm_campaign}','') AS campaign,count(*)::int AS leads,count(*) FILTER(WHERE sales_status='won')::int AS won FROM leads WHERE (${scope} OR assigned_to=${actor.id}::uuid OR assigned_to IS NULL) AND spam=false AND created_at>now()-interval '30 days' GROUP BY 1,2 ORDER BY leads DESC LIMIT 20`;
  const systems=await sql`SELECT key,value,updated_at FROM system_state WHERE key IN ('maintenance','backup','alert_delivery')`;
  const documents=await sql`SELECT id,title,kind,size FROM document_files ORDER BY created_at DESC LIMIT 100`;
  const ids=rows.map(r=>r.id);
  const history=ids.length?await sql`SELECT * FROM (SELECT *,row_number() OVER(PARTITION BY lead_id ORDER BY id DESC) AS rank FROM lead_history WHERE lead_id=ANY(${ids}::bigint[])) h WHERE rank<=5`:[];
  const lineReady=Boolean(line.token&&line.to);
  const backup=systems.find(s=>s.key==='backup'),check=systems.find(s=>s.key==='maintenance');
  const next=rows.length===PAGE_SIZE?rows[rows.length-1].id:null;
  const nextParams=new URLSearchParams(params);if(next)nextParams.set('before',String(next));
  const body=`
    <nav class="admin-nav"><a class="brand" href="/"><img src="/img/verdeloop-logo.png" width="640" height="139" alt="Verdeloop" /></a><form method="POST" action="/admin"><input type="hidden" name="action" value="logout" /><button class="logout">ออกจากระบบ</button></form></nav>
    <header><h1>ลูกค้าและการขาย</h1><p>${esc(actor.display_name)}</p>${params.get('notice')?`<p role="status">${esc(params.get('notice').slice(0,300))}</p>`:''}<p class="muted">จัดการการติดต่อ นัดติดตาม และผลการขาย · เวลาไทย</p></header>
    <div class="stats"><div><strong>${totals.total}</strong>ลูกค้าทั้งหมด</div><div><strong>${totals.due}</strong><a href="/admin?view=due">ถึงนัดติดตาม</a></div><div><strong>${totals.won}</strong>ปิดการขาย</div><div><strong>${totals.pending}</strong>ค้างแจ้ง LINE</div></div>
    <div class="stats"><div><strong>${totals.fresh}</strong><a href="/admin?view=new">ลูกค้าใหม่รอติดต่อ</a></div><div><strong>${totals.today}</strong><a href="/admin?view=today">นัดวันนี้</a></div><div><strong>${totals.overdue}</strong><a href="/admin?view=overdue">เลยกำหนดวันนัด</a></div></div>
    <nav class="section-links">${manager?'<a href="/admin?view=writer">เขียนบทความ AI</a><a href="#team">ทีมงาน</a><a href="#integrations">ตั้งค่า LINE / Ads</a>':''}<a href="#customers">ลูกค้า</a><a href="#reports">รายงาน</a><a href="#system">ระบบและสำรองข้อมูล</a><a href="#documents">เอกสาร</a></nav>
    <section id="customers"><h2>รายการลูกค้า</h2>
    <form method="GET" action="/admin" class="filters"><label>ค้นหาชื่อ ร้าน หรือเบอร์<input name="q" value="${esc(q)}" /></label><label>สถานะ<select name="status"><option value="">ทุกสถานะ</option>${Object.entries(SALES_STATUSES).map(([k,v])=>`<option value="${k}" ${status===k?'selected':''}>${v}</option>`).join('')}</select></label><label>นัด/ลูกค้าใหม่<select name="view"><option value="">ทั้งหมด</option>${[['new','ลูกค้าใหม่'],['today','นัดวันนี้'],['overdue','เลยกำหนดวันนัด'],['due','ถึงเวลานัดแล้ว']].map(([k,v])=>`<option value="${k}" ${f.view===k?'selected':''}>${v}</option>`).join('')}</select></label><label>ผู้รับผิดชอบ<select name="owner"><option value="">ทั้งหมด</option>${staff.filter(u=>scope||u.id===actor.id).map(u=>`<option value="${u.id}" ${f.owner===u.id?'selected':''}>${esc(u.display_name)}</option>`).join('')}</select></label>${f.phone?`<input type="hidden" name="phone" value="${esc(f.phone)}"/>`:''}<button class="logout">ค้นหา</button><a href="/admin">ล้างตัวกรอง</a></form>
    <p><a href="/admin?${esc(new URLSearchParams({...Object.fromEntries(params),export:'leads'}).toString())}">ดาวน์โหลด CSV ตามตัวกรอง</a>${f.phone?' · ประวัติคำขอของเบอร์ '+esc(f.phone):''}</p>
    ${rows.length?rows.map(r=>card(r,before,history.filter(h=>h.lead_id===r.id),staff,actor)).join(''):'<p class="empty">ยังไม่มีรายการที่ตรงกับตัวกรอง</p>'}
    ${next?`<a class="more" href="/admin?${esc(nextParams.toString())}">ดูรายการเก่ากว่านี้ →</a>`:''}</section>
    <section id="reports"><h2>ผลการติดต่อใน 30 วันที่ผ่านมา</h2><p class="muted">การกดติดต่อไม่ใช่ยอดขาย · สถิติการเข้าชมและคลิกนับเฉพาะผู้อนุญาตการวัดผล</p>
    <div class="stats">${[['page_view','เปิดหน้า'],['phone_click','กดโทร'],['line_click','กด LINE'],['document_download','ดาวน์โหลดเอกสาร']].map(([k,v])=>`<div><strong>${events.find(e=>e.event===k)?.count||0}</strong>${v}</div>`).join('')}</div>
    <div class="table-wrap"><table><thead><tr><th>แหล่งที่มา</th><th>แคมเปญ</th><th>ส่งฟอร์ม</th><th>ปิดการขาย</th></tr></thead><tbody>${campaigns.map(r=>`<tr><td>${esc(r.source)}</td><td>${esc(r.campaign)||'—'}</td><td>${r.leads}</td><td>${r.won}</td></tr>`).join('')}</tbody></table></div></section>
    ${manager?`<section id="documents"><h2>เอกสารสำหรับฝ่ายจัดซื้อ</h2><p class="muted">อัปโหลด PDF ฉบับจริงที่ตรวจแล้ว เอกสารจะเปิดให้ดาวน์โหลดบนเว็บไซต์ทันที · สูงสุด 3 MB ต่อไฟล์</p>
    <form id="document-upload" class="sales-form"><label>ชื่อเอกสาร<input name="title" maxlength="160" required /></label><label>ประเภท<select name="kind"><option value="certificate">ใบรับรอง</option><option value="specification">สเปกสินค้า</option><option value="other">เอกสารอื่น</option></select></label><label class="full">ไฟล์ PDF<input type="file" name="file" accept="application/pdf,.pdf" required /></label><label class="full"><input type="checkbox" required /> ตรวจเอกสารแล้วและต้องการเปิดให้ดาวน์โหลด</label><button class="logout">อัปโหลดและเผยแพร่</button><p id="document-feedback" role="status"></p></form>
    ${documents.map(d=>`<div class="history"><a href="/api/documents?id=${d.id}">${esc(d.title)}</a> · ${Math.ceil(d.size/1024)} KB<form method="POST" action="/admin" onsubmit="return confirm('นำเอกสารนี้ออกจากหน้าดาวน์โหลด?')"><input type="hidden" name="action" value="document_delete"/><input type="hidden" name="documentId" value="${d.id}"/><button>นำเอกสารออก</button></form></div>`).join('')||'<p class="muted small">ยังไม่มีไฟล์อัปโหลด สเปกมาตรฐานดาวน์โหลดได้ที่หน้าเอกสาร</p>'}</section>
    <section id="system"><h2>ระบบและสำรองข้อมูล</h2>
    <p>GA4: ${process.env.PUBLIC_GA4_ID?'เชื่อมแล้ว':'ยังไม่ได้ใส่รหัสบัญชี'} · Google Ads: ${process.env.PUBLIC_GOOGLE_ADS_ID&&process.env.PUBLIC_GOOGLE_ADS_LEAD_LABEL?'เชื่อมแล้ว':'ยังไม่ได้ใส่รหัส Conversion'}</p><p>LINE: ${lineReady?'ตั้งค่าแล้ว':'ยังไม่ได้ตั้งค่าโทเคนและผู้รับ'}</p><p>ตรวจระบบล่าสุด: ${check?esc(fmt(check.updated_at)):'ยังไม่เคยตรวจ'} ${check?(check.value.ok?'· ผ่าน':'· มีรายการต้องตรวจสอบ'):''}</p>
    <p>สำรองข้อมูลล่าสุด: ${backup?esc(fmt(backup.updated_at))+' · '+backup.value.leads+' รายการ':'ยังไม่มีไฟล์สำรอง'}</p>
    <p class="muted small">ตรวจระบบ ส่งแจ้งเตือนซ้ำ และสำรองข้อมูลอัตโนมัติวันละครั้ง ช่วง 06:00–07:00 น. เก็บไฟล์สำรองเข้ารหัส 30 วัน</p>
    <div class="system-actions"><form method="POST" action="/admin"><input type="hidden" name="action" value="maintenance" /><button class="logout">ตรวจระบบและสำรองตอนนี้</button></form><form method="POST" action="/admin"><input type="hidden" name="action" value="backup" /><button class="logout">ดาวน์โหลดสำรองเข้ารหัส</button></form></div>
    <p class="muted small">ไฟล์สำรองต้องใช้กุญแจที่เก็บแยกไว้เพื่อกู้คืน · <a href="/documents/">เอกสารสำหรับฝ่ายจัดซื้อ</a></p></section>${teamUI(staff,actor)}${lineTrackingUI(lineTracking,lineStats,lineClicks)}${integrationsUI(line,ads,reminders,conversions,lineGroups.map(r=>r.value)).replace('<h2>การเชื่อมต่อและแจ้งเตือน</h2>', '<h2>การเชื่อมต่อและแจ้งเตือน</h2>'+(params.get('notice')?'<p role="status" class="history">'+esc(params.get('notice').slice(0,300))+'</p>':''))}`:''}`;
  return res.status(200).send(page(body,true));
}

function card(r, back, history = [], staff = [], actor) {
  const normalizedPhone = normalizePhone(r.phone) || String(r.phone ?? '');
  const phone = esc(normalizedPhone);
  // Keep international + prefixes; normalize older formatted records for display.
  const tel = normalizedPhone.replace(/[^+0-9]/g, '');

  const rows = [
    ['ร้าน/บริษัท', r.company],
    ['อีเมล', r.email],
    ['ประเภทธุรกิจ', r.business_type],
    ['ขนาด', r.size],
    ['ปริมาณ/เดือน', r.volume],
  ].filter(([, v]) => v);

  return `
    <article id="lead-${r.id}" class="lead${r.spam ? ' spam' : ''}">
      <div class="head">
        <span class="id">#${r.id}</span>
        <strong>${esc(r.name)}</strong>
        ${r.spam ? '<span class="tag">น่าจะเป็นบอท</span>' : ''}
        ${r.notified_at ? '' : '<span class="tag warn-tag">ไม่ได้แจ้ง LINE</span>'}
      </div>
      <p class="status-line"><span class="tag">${esc(SALES_STATUSES[r.sales_status]||r.sales_status)}</span> ${r.follow_up_at?`นัด ${esc(fmt(r.follow_up_at))}`:''}</p>
      <p class="phone"><a href="tel:${esc(tel)}">${phone}</a></p>
      ${rows.map(([k, v]) => `<p><span class="k">${k}</span> ${esc(v)}</p>`).join('')}
      ${r.message ? `<pre class="msg">${esc(r.message)}</pre>` : ''}
      <p class="muted small">เข้ามา ${esc(fmt(r.created_at))} · แจ้ง LINE ${esc(fmt(r.notified_at))}</p>
      <p class="muted small">แหล่งที่มา: ${esc(r.attribution?.last?.utm_source||r.attribution?.last?.referrer||'ไม่ได้ระบุ')} ${esc(r.attribution?.last?.utm_campaign||'')}</p>
      <p>ผู้รับผิดชอบ: ${esc(r.owner_name||'ยังไม่มอบหมาย')} · <a href="/admin?phone=${encodeURIComponent(r.phone_key||normalizedPhone)}">ดูคำขอของเบอร์นี้ (${r.related_count||1})</a></p>
      ${canEdit(actor,r)?`<details><summary>อัปเดตสถานะและนัดติดตาม</summary><form method="POST" action="/admin" class="sales-form">
        <input type="hidden" name="action" value="update" /><input type="hidden" name="id" value="${r.id}" /><input type="hidden" name="version" value="${esc(r.version)}" />
        <label>สถานะ<select name="salesStatus">${Object.entries(SALES_STATUSES).map(([k,v])=>`<option value="${k}" ${r.sales_status===k?'selected':''}>${v}</option>`).join('')}</select></label>
        <label>นัดติดตาม (เวลาไทย)<input type="datetime-local" name="followUp" value="${r.follow_up_at?new Date(new Date(r.follow_up_at).getTime()+7*3600000).toISOString().slice(0,16):''}" /></label>
        <label class="full">บันทึกการขาย<textarea name="note" rows="3" maxlength="3000">${esc(r.sales_note)}</textarea></label>
        ${salesFields(r,staff,actor)}<button class="logout">บันทึกการติดตาม</button>
      </form></details>`:`<p>บันทึก: ${esc(r.sales_note)}</p><p>เลขพัสดุ: ${esc(r.shipment?.tracking)} · ยอดขาย: ${esc(r.deal?.saleAmount)}</p>`}
      ${history.length?`<details><summary>ประวัติการติดตามล่าสุด</summary>${history.map(h=>`<div class="history"><p>${esc(fmt(h.created_at))} · ${esc(SALES_STATUSES[h.status]||h.status)} · ${esc(h.actor)}</p><p class="msg">${esc(h.note)}</p>${h.follow_up_at?`<p>นัด ${esc(fmt(h.follow_up_at))}</p>`:''}</div>`).join('')}</details>`:''}
      ${canManage(actor)&&!r.notified_at&&!r.spam?`<p class="muted small">แจ้ง LINE: ${esc(r.notify_error||'รอส่ง')} · ลองแล้ว ${r.notify_attempts} ครั้ง</p>${r.notify_attempts<5?`<form method="POST" action="/admin"><input type="hidden" name="action" value="retry" /><input type="hidden" name="id" value="${r.id}" /><button class="logout">ลองแจ้ง LINE อีกครั้ง</button></form>`:`<form method="POST" action="/admin"><input type="hidden" name="action" value="retry_confirmed"/><input type="hidden" name="id" value="${r.id}"/><label class="small"><input type="checkbox" name="confirmed" required/> ตรวจ LINE แล้วว่ายังไม่ได้รับข้อความนี้</label> <button class="logout">เริ่มส่งใหม่</button></form>`}`:''}
      ${canManage(actor)?`<form method="POST" action="/admin" onsubmit="return confirm('ลบลีด #${r.id} ถาวร?')">
        <input type="hidden" name="action" value="delete" />
        <input type="hidden" name="id" value="${r.id}" />
        ${back ? `<input type="hidden" name="back" value="${back}" />` : ''}
        <button type="submit">ลบถาวร</button>
      </form>`:''}
    </article>`;
}

/// เขียน CSS ฝังในไฟล์ ไม่ดึงจากภายนอก — หน้านี้ต้องเปิดได้แม้เว็บหลักล่ม
/// สีเขียวเข้ม/ครีมให้เข้าชุดกับเว็บ แต่ไม่แชร์ไฟล์กับเว็บหลักเพื่อไม่ให้พังตามกัน
function page(inner, wide = false, login = false) {
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>หลังบ้าน Verdeloop</title>
<link rel="icon" href="/favicon-48.png?v=20260926" type="image/png" sizes="48x48" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=20260926" sizes="180x180" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  :root { color-scheme: light }
  body { margin:0; padding:1.5rem 1rem 4rem; background:#faf7ef; color:#1b3025;
         font-family:"IBM Plex Sans Thai",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; line-height:1.6 }
  main { max-width:${wide ? '72rem' : '32rem'}; margin:0 auto }
  h1 { font-size:1.5rem; margin:0 0 .25rem }
  h2 { font-size:1.05rem; margin:2rem 0 .75rem; color:#2f5a45 }
  p { margin:.2rem 0 }
  .muted { color:#5b7266 }
  .small { font-size:.8rem; margin-top:.6rem }
  .lead { border:1px solid #d6e0d8; background:#fff; padding:1rem 1.1rem; border-radius:20px; margin-bottom:.85rem }
  .lead.spam { opacity:.55 }
  .head { display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; margin-bottom:.4rem }
  .head strong { font-size:1.05rem }
  .id { font-variant-numeric:tabular-nums; color:#8a9c92; font-size:.85rem }
  .tag { font-size:.7rem; background:#e8ece9; color:#5b7266; padding:.1rem .45rem; border-radius:999px }
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
  .sales-form button { border:1px solid #b8cab9; border-radius:999px; padding:10px 18px; color:#234734; background:#eef3e9; justify-self:start }
  .sales-form button:hover { background:#dde8d8 }
  section { scroll-margin-top:20px }
  input,select,textarea { min-width:0; max-width:100% }
  p,summary,label { overflow-wrap:anywhere }
  .more { display:inline-block; margin-top:1.5rem; color:#2f5a45; font-weight:600 }

  * { box-sizing:border-box }
  a { color:inherit }
  :focus-visible { outline:3px solid #b58c47; outline-offset:4px }
  .login-body { min-height:100svh; padding:32px 20px; display:grid; place-items:center; background:radial-gradient(ellipse at top left,#e7eee5,transparent 60%),#f8f5ed }
  .login-body main { width:100%; max-width:960px }
  .login-shell { display:grid; grid-template-columns:1fr 1fr; border:1px solid #dce5da; border-radius:28px; overflow:hidden; box-shadow:0 24px 80px #173b2510; background:#fffdf8 }
  .welcome { padding:42px; background:linear-gradient(145deg,#264d3b,#172e25); color:#faf7ef; display:flex; flex-direction:column; justify-content:space-between; min-height:590px }
  .brand { font-size:25px; font-weight:650; text-decoration:none; letter-spacing:-.6px }
  .brand img { display:block; width:210px; max-width:100%; height:auto; background:#faf9f5; padding:12px; border-radius:8px; box-sizing:border-box }
  .brand span { display:block; font-size:10px; letter-spacing:3px; color:#ccb17f; margin-top:2px }
  .eyebrow { font-size:12px; letter-spacing:1px; color:#91703f; font-weight:600 }
  .welcome .eyebrow { color:#cfb887 }
  .welcome h2 { font-size:35px; line-height:1.5; font-weight:500; color:#fffdf8; margin:18px 0 }
  .welcome p { color:#c3d0c5; font-size:14px; line-height:1.9 }
  .welcome .welcome-foot { font-size:11px; color:#a7b9aa }
  .login-panel { padding:64px 42px; align-self:center; margin:0 }
  .login-panel h1 { font-size:29px; font-weight:600; margin:10px 0 }
  .intro { font-size:14px; line-height:1.8 }
  .login-form { display:grid; gap:10px; margin-top:30px }
  .login-form label { font-size:14px; font-weight:600 }
  .login-form input:not([type=hidden]) { width:100%; min-width:0; font:inherit; border:1px solid #cbd8cd; border-radius:12px; padding:13px 15px; background:#fff; color:#1b3025; margin-bottom:10px }
  .primary { display:flex; justify-content:space-between; align-items:center; width:100%; padding:14px 20px; border:0; border-radius:999px; background:#234734; color:#fffdf8; font-size:15px; font-weight:600; margin-top:10px }
  .primary:hover { background:#173323 }
  .login-help { font-size:12px; color:#677c6c; margin-top:22px; line-height:1.8 }
  .back-link { display:inline-block; font-size:13px; margin-top:30px; text-underline-offset:4px }
  .login-error { margin-top:20px; background:#fff0eb; border:1px solid #efd1c5; border-radius:12px; color:#943b24; padding:12px 14px; font-size:13px }
  .admin-nav { display:flex; align-items:center; justify-content:space-between; gap:16px; padding-bottom:28px }
  .admin-nav form { margin:0 }
  .logout { border:1px solid #bbcbbb; border-radius:999px; padding:8px 16px; color:#234734 }
  .logout:hover { background:#e5ece3 }
  @media(max-width:640px) {
    .login-body { padding:20px 16px; display:block }
    .login-shell { grid-template-columns:1fr; border-radius:24px; max-width:440px; margin:auto }
    .welcome { min-height:0; padding:24px 28px }
    .welcome-copy,.welcome-foot { display:none }
    .brand span { display:inline; margin-left:12px; letter-spacing:2px }
    .login-panel { padding:32px 28px 36px }
    .login-panel h1 { font-size:26px }
    .login-form { margin-top:24px }
    .login-help { font-size:12px }
  }

  .stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:24px 0}.stats>div{padding:18px;border:1px solid #d6e0d8;border-radius:18px;background:#fffdf8;font-size:13px}.stats strong{display:block;font-size:28px;font-weight:600}.section-links{display:flex;gap:20px;flex-wrap:wrap;padding:10px 0}.filters{display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin:18px 0 24px}.filters label{font-size:13px}.filters input:not([type=checkbox]),select,textarea,.sales-form input:not([type=hidden]):not([type=checkbox]){display:block;max-width:100%;width:100%;padding:10px;border:1px solid #c7d5c9;border-radius:10px;background:white;color:#1b3025;font:inherit}.sales-form{display:grid;grid-template-columns:1fr 1fr;gap:14px}.sales-form .full{grid-column:1/-1}.sales-form label{min-width:0;font-size:13px}.sales-form button{justify-self:start}details{padding:12px 0;border-top:1px solid #e1e8df}summary{cursor:pointer;font-weight:500}.history{padding:12px;border-radius:12px;background:#f3f6f1;margin:10px 0;font-size:13px}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;margin-top:20px;min-width:480px}td,th{text-align:left;padding:12px;border-bottom:1px solid #d6e0d8;overflow-wrap:anywhere}.system-actions{display:flex;gap:14px;flex-wrap:wrap}.lead{overflow-wrap:anywhere}.empty{padding:28px;border:1px dashed #c7d5c9;border-radius:20px}#system,#reports{margin-top:38px;border-top:1px solid #d6e0d8;padding-top:12px}section[id],article[id]{scroll-margin-top:20px}
  @media(max-width:600px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.sales-form{grid-template-columns:1fr}.filters>label:first-child{width:100%}.stats>div{padding:14px}.admin-nav .brand{font-size:22px}}
</style>
</head>
<body class="${login ? 'login-body' : 'dashboard-body'}"><main>${inner}</main>${wide?`<script>
const upload=document.getElementById('document-upload');if(upload)upload.addEventListener('submit',async event=>{event.preventDefault();const button=upload.querySelector('button'),status=document.getElementById('document-feedback'),file=upload.elements.file.files[0];if(!file||file.size>3*1024*1024){status.textContent='กรุณาเลือก PDF ไม่เกิน 3 MB';return;}button.disabled=true;status.textContent='กำลังอัปโหลด…';try{const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file)});const response=await fetch('/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'document_upload',documentId:crypto.randomUUID(),title:upload.elements.title.value,kind:upload.elements.kind.value,file:data})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'อัปโหลดไม่ได้');location.assign('/admin#documents');location.reload();}catch(error){status.textContent=error.message;button.disabled=false;}});
</script>`:''}</body>
</html>`;
}
