import {saveLineTracking} from './line-tracking.js';
import {groupSummary} from './line-webhook.js';
import {FormError} from './form-error.js';
import {passwordHash,canManage,canEdit} from './staff.js';
import {crmInput} from './crm.js';
import {saveLine,saveAds,lineSettings,saveIntegration} from './integrations.js';
import {push} from './notifications.js';
import {remindFollowups} from './followups.js';
import {queueAds,sendAds,testAds} from './ads-offline.js';
import {randomUUID} from 'node:crypto';
import {validUUID} from './core.js';
export const crmActions=['staff_create','staff_update','line_save','line_test','followups','ads_save','ads_test','ads_send','ads_imported','reminder_review','line_group_select','line_status','line_tracking_save'];
export async function settingsAction(sql,body,user){
 if(!canManage(user))throw new FormError('รายการนี้ต้องใช้สิทธิ์ผู้ดูแล');
 switch(body.action){
 case 'staff_create':case 'staff_update':{
  const name=String(body.displayName||'').trim();if(!name||name.length>100||!['admin','sales','viewer'].includes(body.role))throw new FormError('กรุณาตรวจชื่อและสิทธิ์');
  if(body.action==='staff_create'){
   const username=String(body.username||'').trim().toLowerCase();if(!/^[a-z0-9][a-z0-9._-]{2,59}$/.test(username)||username===process.env.ADMIN_USER?.toLowerCase())throw new FormError('ชื่อผู้ใช้ไม่ถูกต้องหรือสงวนไว้');
   const hash=await passwordHash(body.password);
   const rows=await sql`INSERT INTO staff_users(username,display_name,password_hash,role) VALUES(${username},${name},${hash},${body.role}) ON CONFLICT(username) DO NOTHING RETURNING id`;
   if(!rows.length)throw new FormError('ชื่อผู้ใช้นี้ถูกใช้แล้ว');
  }else{
   if(!validUUID(body.staffId))throw new FormError('บัญชีไม่ถูกต้อง');
   if(body.staffId===user.id&&(body.active!=='on'||body.role!=='admin'))throw new FormError('ไม่สามารถปิดบัญชีหรือลดสิทธิ์ตัวเองได้');
   const hash=body.password?await passwordHash(body.password):null;
   const rows=await sql`UPDATE staff_users SET display_name=${name},role=${body.role},active=${body.active==='on'},password_hash=COALESCE(${hash},password_hash),session_version=session_version+1 WHERE id=${body.staffId} RETURNING id`;
   if(!rows.length)throw new FormError('ไม่พบบัญชี');
  }return 'บันทึกทีมงานแล้ว';
 }
 case 'reminder_review':if(!validUUID(body.reminderId)||body.confirmed!=='on')throw new FormError('กรุณาตรวจข้อความใน LINE ก่อน');await sql`UPDATE followup_reminders SET id=${randomUUID()},status='pending',attempts=0,started_at=NULL,locked_until=NULL,error=NULL WHERE id=${body.reminderId} AND (status='review_required' OR (status='failed' AND attempts>=5))`;return 'เตรียมแจ้งนัดใหม่แล้ว กดตรวจและแจ้งนัดตอนนี้เพื่อส่ง';
 case 'line_status':{const config=await lineSettings(sql);if(!config.token)throw new FormError('ยังไม่มี Token');const r=await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint',{headers:{Authorization:'Bearer '+config.token},signal:AbortSignal.timeout(8000)});if(!r.ok)throw new FormError('ตรวจสถานะ LINE ไม่สำเร็จ');const data=await r.json();if(data.endpoint!=='https://verdeloopthailand.com/api/line-webhook')return 'Webhook URL ไม่ตรง กรุณาตั้ง https://verdeloopthailand.com/api/line-webhook';return data.active?'Use webhook เปิดแล้ว: พิมพ์ข้อความในกลุ่มที่มีบอท แล้วรีเฟรชรายชื่อกลุ่ม':'Use webhook ยังปิดอยู่: ไป LINE Developers → Messaging API → เปิด Use webhook แล้วพิมพ์ข้อความในกลุ่ม';}
 case 'line_group_select':{if(body.confirmed!=='on'||!/^C[a-f0-9]{32}$/i.test(body.groupId||''))throw new FormError('กรุณายืนยันกลุ่มรับแจ้งเตือน');const [found]=await sql`SELECT value FROM system_state WHERE key=${'line_group:'+body.groupId}`;if(!found?.value?.active)throw new FormError('ยังไม่พบกลุ่มนี้หรือบอทออกจากกลุ่มแล้ว');const config=await lineSettings(sql);try{await groupSummary(config.token,body.groupId);}catch{throw new FormError('บอทเข้าถึงกลุ่มนี้ไม่ได้ กรุณาเชิญบอทเข้ากลุ่ม');}await saveIntegration(sql,'line',{...config,to:body.groupId,groupOnly:true});return 'ตั้งกลุ่มรับแจ้งเตือนแล้ว กดส่งข้อความทดสอบ LINE เพื่อยืนยัน';}
 case 'line_tracking_save':await saveLineTracking(sql,body);return 'บันทึก LINE Login และ Conversion แล้ว';
 case 'line_save':await saveLine(sql,body);return 'บันทึก LINE แล้ว กรุณาทดสอบการส่ง';
 case 'line_test':{const result=await push('🌱 ข้อความทดสอบจากหลังบ้าน Verdeloop เชื่อมต่อสำเร็จ',randomUUID(),await lineSettings(sql));if(!result.ok)throw new FormError('ส่ง LINE ไม่สำเร็จ: '+result.error);return 'ส่งข้อความทดสอบ LINE สำเร็จ';}
 case 'followups':{const r=await remindFollowups(sql);if(!r.configured)throw new FormError('กรุณาตั้งค่า LINE ก่อน');return `แจ้งนัดสำเร็จ ${r.sent} รายการ ไม่สำเร็จ ${r.failed} รายการ`;}
 case 'ads_save':await saveAds(sql,body);return 'บันทึกการตั้งค่า Google Ads แล้ว';
 case 'ads_test':{const r=await testAds(sql);if(!r.ok)throw new FormError('ตรวจ Google Ads ไม่ผ่าน: '+r.error);return 'ตรวจสิทธิ์ Google Ads และประเภท Conversion ผ่าน';}
 case 'ads_send':{const r=await sendAds(sql);if(!r.configured)return 'เตรียมคิวแล้ว ยังไม่ได้เปิดส่ง Google Ads API';return `Google Ads รับแล้ว ${r.sent} รายการ ไม่สำเร็จ ${r.failed} รายการ`;}
 case 'ads_imported':if(!validUUID(body.conversionId)||body.confirmed!=='on')throw new FormError('กรุณายืนยันผลนำเข้า');await sql`UPDATE ads_conversions SET status='imported',sent_at=now(),error=NULL WHERE id=${body.conversionId} AND status IN ('pending','failed') AND (locked_until IS NULL OR locked_until<now())`;return 'บันทึกผลนำเข้าแล้ว';
 }
}
export async function updateLead(sql,body,user){
 const input=crmInput(body);
 const [lead]=await sql`SELECT * FROM leads WHERE id=${body.id}`;
 if(!lead||!canEdit(user,lead))return {status:403,message:'ไม่มีสิทธิ์แก้ไขรายการนี้'};
 if(!canManage(user)&&input.assigned&&input.assigned!==user.id&&input.assigned!==lead.assigned_to)throw new FormError('ไม่สามารถมอบหมายให้ทีมงานคนอื่นได้');
 if(input.assigned&&input.assigned!==lead.assigned_to){const [staff]=await sql`SELECT id FROM staff_users WHERE id=${input.assigned} AND active=true`;if(!staff)throw new FormError('ผู้รับผิดชอบไม่ได้เปิดใช้งาน');}
 if(typeof body.version!=='string'||!Number.isFinite(Date.parse(body.version)))throw new FormError('กรุณาโหลดข้อมูลใหม่');
 const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
 if(input.deal.closedDate&&input.deal.closedDate>today)throw new FormError('วันที่ปิดการขายต้องไม่เป็นอนาคต');
 const qualified=body.qualified==='on'?(lead.qualified_at||new Date().toISOString()):null;
 const closed=input.status==='won'?(lead.closed_at||new Date().toISOString()):null;
 const changed=await sql`WITH updated AS (UPDATE leads SET sales_status=${input.status},sales_note=${input.note},follow_up_at=${input.follow},assigned_to=${input.assigned}::uuid,shipment=${JSON.stringify(input.shipment)}::jsonb,deal=${JSON.stringify(input.deal)}::jsonb,qualified_at=${qualified},closed_at=${closed},updated_at=now() WHERE id=${body.id} AND updated_at=${body.version}::timestamptz AND (${canManage(user)} OR assigned_to=${user.id}::uuid OR assigned_to IS NULL) RETURNING *) INSERT INTO lead_history(lead_id,actor,status,note,follow_up_at,details) SELECT id,${user.username},sales_status,sales_note,follow_up_at,jsonb_build_object('assignedTo',assigned_to,'shipment',shipment,'deal',deal,'qualifiedAt',qualified_at) FROM updated RETURNING lead_id`;
 if(!changed.length)return {status:409,message:'รายการนี้มีการแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึกอีกครั้ง'};
 // The lead update is committed even if queue preparation has a transient failure.
 try{await queueAds(sql);}catch{console.error('ADS_QUEUE_PENDING');}
 return {status:303};
}
