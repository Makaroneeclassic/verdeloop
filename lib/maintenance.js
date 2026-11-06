import {cleanupLineTracking} from './line-tracking.js';
import {lineSettings} from './integrations.js';
import {remindFollowups} from './followups.js';
import {sendAds} from './ads-offline.js';
import {database,state} from './core.js';
import {retryPending,push,alert,lineConfigured} from './notifications.js';
import {backupToBlob} from './backup.js';
export async function maintenance(){
 const sql=database();
 try{if(!sql)throw new Error('db_missing');await sql`SELECT 1`;}
 catch{await push('⚠️ Verdeloop: ระบบตรวจพบว่าเชื่อมต่อฐานข้อมูลไม่ได้ กรุณาตรวจหลังบ้าน');return {ok:false,database:false};}
 const [lock]=await sql`INSERT INTO system_state(key,value) VALUES('maintenance_lock','{}') ON CONFLICT(key) DO UPDATE SET updated_at=now() WHERE system_state.updated_at<now()-interval '10 minutes' RETURNING key`;
 if(!lock)return {ok:true,skipped:true};
 const result={checkedAt:new Date().toISOString(),database:true,lineConfigured:lineConfigured(await lineSettings(sql))};
 try{
  result.notifications=await retryPending(sql);
  result.followups=await remindFollowups(sql);
  try{result.ads=await sendAds(sql);}catch{result.ads={ok:false,error:"connection_failed"};}
  await cleanupLineTracking(sql);
  try{result.backup=await backupToBlob(sql);}catch{result.backup={ok:false};}
  await sql`DELETE FROM rate_limits WHERE expires_at<now()-interval '1 day'`;
  await sql`DELETE FROM contact_events WHERE created_at<now()-interval '90 days'`;
  const [pending]=await sql`SELECT count(*)::int AS count FROM leads WHERE notified_at IS NULL AND spam=false`;
  result.pending=pending.count;
  result.ok=result.backup.ok && result.lineConfigured && result.pending===0;
  await state(sql,'maintenance',result);
  if(!result.ok)await alert(sql,`ตรวจระบบ: LINE ${result.lineConfigured?'เชื่อมแล้ว':'ยังไม่ได้ตั้งค่า'}, ค้างแจ้ง ${result.pending} รายการ, สำรองข้อมูล ${result.backup.ok?'สำเร็จ':'ไม่สำเร็จ'}`);
  return result;
 }catch{await state(sql,'maintenance',{ok:false,checkedAt:result.checkedAt});return {ok:false};}
 finally{await sql`DELETE FROM system_state WHERE key='maintenance_lock'`;}
}
