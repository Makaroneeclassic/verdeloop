import {push,lineConfigured} from './notifications.js';
import {lineSettings} from './integrations.js';
export async function remindFollowups(sql){
 const config=await lineSettings(sql);if(!lineConfigured(config))return {configured:false,sent:0,failed:0};
 await sql`INSERT INTO followup_reminders(lead_id,scheduled_at) SELECT id,follow_up_at FROM leads WHERE spam=false AND follow_up_at<=now() AND sales_status NOT IN ('won','lost') ON CONFLICT(lead_id,scheduled_at) DO NOTHING`;
 await sql`UPDATE followup_reminders r SET status='cancelled' FROM leads l WHERE r.lead_id=l.id AND r.status IN ('pending','failed') AND (l.spam=true OR l.sales_status IN ('won','lost') OR l.follow_up_at IS DISTINCT FROM r.scheduled_at)`;
 const due=await sql`SELECT id FROM followup_reminders WHERE status IN ('pending','failed') AND attempts<5 AND (locked_until IS NULL OR locked_until<now()) ORDER BY scheduled_at LIMIT 5`;
 let sent=0,failed=0;
 for(const item of due){
  const [r]=await sql`UPDATE followup_reminders r SET locked_until=now()+interval '2 minutes',attempts=attempts+1,started_at=COALESCE(started_at,now()) FROM leads l WHERE r.id=${item.id} AND r.lead_id=l.id AND l.follow_up_at=r.scheduled_at AND l.sales_status NOT IN ('won','lost') AND l.spam=false AND r.status IN ('pending','failed') AND r.attempts<5 AND (r.locked_until IS NULL OR r.locked_until<now()) RETURNING r.*,l.name,l.company,l.phone,l.sales_note,l.assigned_to`;
  if(!r)continue;
  if(Date.now()-new Date(r.started_at).getTime()>23*3600000){await sql`UPDATE followup_reminders SET status='review_required',locked_until=NULL,error='retry_window_expired' WHERE id=${r.id}`;failed++;continue;}
  const [owner]=r.assigned_to?await sql`SELECT display_name FROM staff_users WHERE id=${r.assigned_to}`:[];
  const result=await push(`⏰ ถึงนัดติดตาม Verdeloop\nลูกค้า #${r.lead_id}: ${r.name}\n${r.company||''}\nโทร ${r.phone}\nผู้รับผิดชอบ: ${owner?.display_name||'ยังไม่กำหนด'}\nนัด: ${new Date(r.scheduled_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})}\n${r.sales_note||''}\nhttps://verdeloopthailand.com/admin#lead-${r.lead_id}`,r.id,config);
  await sql`UPDATE followup_reminders SET status=${result.ok?'sent':'failed'},sent_at=${result.ok?new Date().toISOString():null},error=${result.error||null},locked_until=NULL WHERE id=${r.id}`;
  result.ok?sent++:failed++;
 }
 return {configured:true,sent,failed};
}
