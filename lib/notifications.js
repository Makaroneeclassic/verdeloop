import {lineSettings} from './integrations.js';
import { state } from './core.js';
const envConfig=()=>({token:process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim(),to:process.env.LINE_TO?.trim()});
export const lineConfigured = (config=envConfig()) => Boolean(config.token && config.to && config.token!=='[SENSITIVE]' && config.to!=='[SENSITIVE]');
export function leadMessage(r) {
 return ['🌱 ลีดใหม่จากเว็บ',`ลีด #${r.id}`,`ชื่อ: ${r.name}`,r.company&&`ร้าน/บริษัท: ${r.company}`,`เบอร์: ${r.phone}`,r.email&&`อีเมล: ${r.email}`,r.business_type&&`ประเภทธุรกิจ: ${r.business_type}`,r.size&&`ขนาดที่สนใจ: ${r.size}`,r.volume&&`ปริมาณต่อเดือน: ${r.volume}`,r.message&&`ข้อความ: ${r.message}`,`เวลา: ${new Date(r.created_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})}`].filter(Boolean).join('\n');
}
export async function push(text, key, config=envConfig()) {
 if(!lineConfigured(config))return {ok:false,error:'not_configured'};
 try {
  const res=await fetch('https://api.line.me/v2/bot/message/push',{
   method:'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json',...(key?{'X-Line-Retry-Key':key}:{})},
   body:JSON.stringify({to:config.to,messages:[{type:'text',text:text.slice(0,4900)}]}),signal:AbortSignal.timeout(8000),
  });
  if(res.ok || (res.status===409 && res.headers.get('x-line-accepted-request-id')))return {ok:true};
  return {ok:false,error:`http_${res.status}`};
 } catch {return {ok:false,error:'network_uncertain'};}
}
export async function notifyLead(sql,id) {
 const config=await lineSettings(sql);
 if(!lineConfigured(config))return {ok:false,error:'not_configured'};
 const [r]=await sql`UPDATE leads SET notify_locked_until=now()+interval '2 minutes',notify_attempts=notify_attempts+1 WHERE id=${id} AND spam=false AND notified_at IS NULL AND notify_attempts<5 AND notify_after<=now() AND (notify_locked_until IS NULL OR notify_locked_until<now()) RETURNING *`;
 if(!r)return {ok:false,error:'not_due'};
 // Never resend an uncertain request outside LINE's 24-hour idempotency window.
 if(r.notify_started_at && Date.now()-new Date(r.notify_started_at).getTime()>23*3600000) {
  await sql`UPDATE leads SET notify_error='review_required',notify_attempts=5,notify_locked_until=NULL WHERE id=${id}`;
  return {ok:false,error:'review_required'};
 }
 await sql`UPDATE leads SET notify_started_at=COALESCE(notify_started_at,now()) WHERE id=${id}`;
 const result=await push(leadMessage(r),r.notify_key,config);
 if(result.ok)await sql`UPDATE leads SET notified_at=now(),notify_error=NULL,notify_locked_until=NULL WHERE id=${id}`;
 else await sql`UPDATE leads SET notify_error=${result.error},notify_locked_until=NULL,notify_after=now()+interval '5 minutes'*power(2,LEAST(notify_attempts,4)) WHERE id=${id}`;
 return result;
}
export async function retryPending(sql) {
 if(!lineConfigured(await lineSettings(sql)))return {configured:false,sent:0,failed:0};
 const rows=await sql`SELECT id FROM leads WHERE notified_at IS NULL AND spam=false AND notify_attempts<5 AND notify_after<=now() ORDER BY id LIMIT 5`;
 let sent=0,failed=0;
 for(const r of rows){const result=await notifyLead(sql,r.id);result.ok?sent++:failed++;}
 return {configured:true,sent,failed};
}
export async function alert(sql, message) {
 const [claim]=await sql`INSERT INTO system_state(key,value) VALUES('last_alert','{}') ON CONFLICT(key) DO UPDATE SET updated_at=now() WHERE system_state.updated_at<now()-interval '6 hours' RETURNING key`;
 if(!claim)return;
 const result=await push('⚠️ Verdeloop: '+message+'\nตรวจสอบ https://verdeloopthailand.com/admin',undefined,await lineSettings(sql));
 await state(sql,'alert_delivery',{...result,checkedAt:new Date().toISOString()});
}
