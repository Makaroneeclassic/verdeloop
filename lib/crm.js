import {FormError} from './form-error.js';
import {normalizePhone} from './phone.js';
import {SALES_STATUSES,validUUID} from './core.js';
export const text=(v,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';
export function localDate(v){if(!v)return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw new FormError('วันที่ไม่ถูกต้อง');return v;}
export function followDate(v){if(!v)return null;if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v))throw new FormError('วันนัดไม่ถูกต้อง');const d=new Date(v+':00+07:00');if(!Number.isFinite(d.getTime())||new Date(d.getTime()+7*3600000).toISOString().slice(0,16)!==v)throw new FormError('วันนัดไม่ถูกต้อง');return d.toISOString();}
const money=v=>{if(v===''||v==null)return null;if(!/^\d{1,9}(\.\d{1,2})?$/.test(String(v)))throw new FormError('จำนวนเงินไม่ถูกต้อง');return Number(v)};
export function crmInput(body){
 if(!Object.hasOwn(SALES_STATUSES,body.salesStatus))throw new FormError('สถานะไม่ถูกต้อง');
 if(typeof body.note!=='string'||body.note.length>3000)throw new FormError('บันทึกยาวเกิน 3,000 ตัวอักษร');
 const assigned=body.assignedTo||null;if(assigned&&!validUUID(assigned))throw new FormError('ผู้รับผิดชอบไม่ถูกต้อง');
 const qty=body.sampleQuantity?Number(body.sampleQuantity):null;if(qty!==null&&(!Number.isInteger(qty)||qty<1||qty>100000))throw new FormError('จำนวนตัวอย่างไม่ถูกต้อง');
 const shipment={recipient:text(body.recipient),address:text(body.address,1500),size:text(body.sampleSize,40),quantity:qty,sentDate:localDate(body.sentDate),receivedDate:localDate(body.receivedDate),carrier:text(body.carrier,80),tracking:text(body.tracking,100)};
 if(shipment.receivedDate&&(!shipment.sentDate||shipment.receivedDate<shipment.sentDate))throw new FormError('วันที่รับต้องไม่ก่อนวันที่ส่ง');
 const deal={quoteNumber:text(body.quoteNumber,100),quoteAmount:money(body.quoteAmount),quoteDate:localDate(body.quoteDate),saleAmount:money(body.saleAmount),closedDate:localDate(body.closedDate),lostReason:text(body.lostReason,1000)};
 if(body.salesStatus==='won'&&(deal.saleAmount===null||!deal.closedDate))throw new FormError('กรุณาระบุยอดขายและวันที่ปิดการขาย');
 if(body.salesStatus==='lost'&&!deal.lostReason)throw new FormError('กรุณาระบุเหตุผลที่ไม่ซื้อ');
 return {status:body.salesStatus,note:body.note.trim(),follow:['won','lost'].includes(body.salesStatus)?null:followDate(body.followUp),assigned,shipment,deal};
}
export function filters(params){
 const id=params.get('owner')||'';
 return {q:text(params.get('q'),100),status:Object.hasOwn(SALES_STATUSES,params.get('status'))?params.get('status'):'',view:['new','today','overdue','due'].includes(params.get('view'))?params.get('view'):'',owner:validUUID(id)?id:'',phone:normalizePhone(params.get('phone'))||'',before:/^\d{1,18}$/.test(params.get('before')||'')?params.get('before'):null};
}
export async function leadRows(sql,user,f,max=100){
 const scope=['owner','admin','viewer'].includes(user.role),phoneQuery=normalizePhone(f.q)||'';
 return sql`SELECT l.*,l.updated_at::text AS version,u.display_name AS owner_name,(SELECT count(*)::int FROM leads r WHERE r.phone_key=l.phone_key AND ( ${scope} OR r.assigned_to=${user.id}::uuid OR r.assigned_to IS NULL)) AS related_count FROM leads l LEFT JOIN staff_users u ON u.id=l.assigned_to WHERE (${scope} OR l.assigned_to=${user.id}::uuid OR l.assigned_to IS NULL) AND (${f.before}::bigint IS NULL OR l.id<${f.before}::bigint) AND (${f.status}='' OR l.sales_status=${f.status}) AND (${f.q}='' OR l.name ILIKE ${'%'+f.q+'%'} OR l.company ILIKE ${'%'+f.q+'%'} OR l.phone ILIKE ${'%'+f.q+'%'} OR (${phoneQuery}<>'' AND l.phone_key=${phoneQuery})) AND (${f.owner}='' OR l.assigned_to=${f.owner||null}::uuid) AND (${f.phone}='' OR l.phone_key=${f.phone}) AND (${f.view}<>'new' OR (l.sales_status='new' AND l.spam=false)) AND (${f.view} NOT IN ('today','overdue','due') OR (l.spam=false AND l.sales_status NOT IN ('won','lost') AND CASE WHEN ${f.view}='today' THEN (l.follow_up_at AT TIME ZONE 'Asia/Bangkok')::date=(now() AT TIME ZONE 'Asia/Bangkok')::date WHEN ${f.view}='overdue' THEN (l.follow_up_at AT TIME ZONE 'Asia/Bangkok')::date<(now() AT TIME ZONE 'Asia/Bangkok')::date ELSE l.follow_up_at<=now() END)) ORDER BY l.id DESC LIMIT ${max}`;
}
export function csvCell(value){let s=String(value??'');if(/^[\s\uFEFF]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export function csv(rows){return '\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';}
export function leadCSV(rows){return csv([['รหัส','ชื่อ','ร้าน/บริษัท','เบอร์','อีเมล','สถานะ','ผู้รับผิดชอบ','นัดติดตาม','ขนาด','จำนวนตัวอย่าง','วันที่ส่ง','ขนส่ง','เลขพัสดุ','ที่อยู่','เลขใบเสนอราคา','ราคาเสนอ','ยอดขาย','วันที่ปิด','เหตุผลที่ไม่ซื้อ','บันทึก'],...rows.map(r=>[r.id,r.name,r.company,r.phone,r.email,SALES_STATUSES[r.sales_status],r.owner_name,r.follow_up_at,r.shipment?.size,r.shipment?.quantity,r.shipment?.sentDate,r.shipment?.carrier,r.shipment?.tracking,r.shipment?.address,r.deal?.quoteNumber,r.deal?.quoteAmount,r.deal?.saleAmount,r.deal?.closedDate,r.deal?.lostReason,r.sales_note])]);}
