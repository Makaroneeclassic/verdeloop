import { neon } from '@neondatabase/serverless';
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
export const SALES_STATUSES = {new:'ลูกค้าใหม่',contacted:'ติดต่อแล้ว',sample_sent:'ส่งตัวอย่างแล้ว',quoted:'เสนอราคาแล้ว',won:'ปิดการขาย',lost:'ยุติการติดตาม'};
export const database = () => process.env.DATABASE_URL ? neon(process.env.DATABASE_URL,{fetchOptions:{get signal(){return AbortSignal.timeout(10000)}}}) : null;
export const equal = (a,b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(),createHash('sha256').update(String(b)).digest());
export const sameOrigin = req => req.headers.origin === `${String(req.headers['x-forwarded-proto'] || 'https').split(',')[0]}://${req.headers.host}`;
export const validUUID = v => typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const safe = v => typeof v==='string' ? v.replace(/[^a-zA-Z0-9_ .:/+-]/g,'').slice(0,120) : '';
export function attribution(value) {
 let raw=value;
 if(typeof raw==='string') { try {raw=JSON.parse(raw);} catch {return {};} }
 if(!raw || typeof raw!=='object')return {};
 const result={};
 for(const touch of ['first','last']) {
  const t=raw[touch]; if(!t || typeof t!=='object')continue;
  result[touch]={};
  for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','gbraid','wbraid']) if(t[key])result[touch][key]=safe(t[key]);
  if(typeof t.path==='string' && /^\/[a-z0-9/_-]*$/i.test(t.path))result[touch].path=t.path.slice(0,160);
  if(typeof t.referrer==='string') {try{result[touch].referrer=new URL(t.referrer).hostname.slice(0,120);}catch{}}
 }
 return result;
}
export async function limit(sql, req, scope, max, seconds) {
 // Vercel overwrites x-vercel-forwarded-for; raw IPs are never persisted.
 const ip=String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
 const secret=process.env.RATE_LIMIT_SECRET || process.env.ADMIN_PASSWORD;
 if(!secret) throw new Error('rate_limit_unconfigured');
 const key=scope+':'+createHmac('sha256',secret).update(ip).digest('hex');
 const [row]=await sql`INSERT INTO rate_limits(key,hits,expires_at) VALUES (${key},1,now()+${seconds}*interval '1 second') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.expires_at<=now() THEN 1 ELSE rate_limits.hits+1 END, expires_at=CASE WHEN rate_limits.expires_at<=now() THEN now()+${seconds}*interval '1 second' ELSE rate_limits.expires_at END RETURNING hits,expires_at`;
 return {allowed:row.hits<=max,retryAfter:Math.max(1,Math.ceil((new Date(row.expires_at).getTime()-Date.now())/1000))};
}
export async function state(sql,key,value) {
 await sql`INSERT INTO system_state(key,value) VALUES(${key},${JSON.stringify(value)}::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()`;
}
