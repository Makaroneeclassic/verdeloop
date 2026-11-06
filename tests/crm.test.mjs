import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {database} from '../lib/core.js';
import handler from '../api/admin.js';
import {leadRows,filters,crmInput,leadCSV} from '../lib/crm.js';
import {saveIntegration,readIntegration} from '../lib/integrations.js';
import {remindFollowups} from '../lib/followups.js';
import {sendAds} from '../lib/ads-offline.js';
import {makeBackup,encryptBackup,decryptBackup} from '../lib/backup.js';
if(!new URL(process.env.DATABASE_URL).pathname.includes('crm_test_'))throw Error('Isolated CRM test database required');
process.env.ADMIN_USER='test-owner';process.env.ADMIN_PASSWORD='test-owner-password';process.env.RATE_LIMIT_SECRET='test-rate-secret';process.env.BACKUP_ENCRYPTION_KEY=randomBytes(32).toString('base64');
delete process.env.LINE_TO;delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
const sql=database(),nativeFetch=globalThis.fetch;let owner,sales,viewer,staffId,viewerId,lead,other;let pushes=0,uploads=0,failAds=true;
async function call(body=null,cookie='',url='/admin') {const res={code:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},status(c){this.code=c;return this},send(d){this.html=d;return this},json(d){this.data=d;return this},redirect(c,u){this.code=c;this.location=u;return this}};await handler({method:body?'POST':'GET',url,body,headers:{host:'verdeloopthailand.com',origin:'https://verdeloopthailand.com','x-vercel-forwarded-for':'192.0.2.55',cookie}},res);return res;}
const login=async(username,password)=>{const r=await call({action:'login',username,password});assert.equal(r.code,303);return r.headers['set-cookie'].split(';')[0]};
const input=r=>({action:'update',id:String(r.id),version:r.version,salesStatus:'contacted',note:'ติดตามจากการทดสอบ',assignedTo:staffId,recipient:'ลูกค้าทดสอบ',address:'ที่อยู่ทดสอบ',sampleSize:'8 มม.',sampleQuantity:'20',sentDate:'2026-09-01',carrier:'Test',tracking:'TRACK-TEST',qualified:'on'});
before(async()=>{await sql`TRUNCATE leads,lead_history,staff_users,rate_limits,contact_events,system_state,document_files,integration_settings,followup_reminders,ads_conversions RESTART IDENTITY CASCADE`;globalThis.fetch=(url,opts)=>{const u=String(url);if(u.startsWith('https://api.line.me/')){pushes++;return Promise.resolve(new Response('{}',{status:200}))}if(u.startsWith('https://oauth2.googleapis.com/'))return Promise.resolve(new Response('{"access_token":"test-access"}'));if(u.startsWith('https://googleads.googleapis.com/')){uploads++;const b=JSON.parse(opts.body);assert.equal(b.partialFailure,true);assert.equal(b.conversions[0].gclid,'test-click');assert.ok(!opts.body.includes('ที่อยู่ทดสอบ'));return Promise.resolve(new Response(failAds?'{"partialFailureError":{"code":3}}':'{"results":[{"conversionAction":"customers/123/conversionActions/456"}]}'));}return nativeFetch(url,opts)};});
after(()=>globalThis.fetch=nativeFetch);
test('owner adds staff, password is hashed, secrets encrypted and never rendered',async()=>{
 owner=await login('test-owner','test-owner-password');
 for(const [username,role] of [['sales-test','sales'],['viewer-test','viewer']]){const r=await call({action:'staff_create',username,displayName:'ทีม '+role,password:'test-staff-password',role},owner);assert.equal(r.code,303);}
 const staff=await sql`SELECT * FROM staff_users ORDER BY username`;staffId=staff[0].id;viewerId=staff[1].id;assert.match(staff[0].password_hash,/^scrypt:/);assert.ok(!staff[0].password_hash.includes('test-staff-password'));
 sales=await login('sales-test','test-staff-password');viewer=await login('viewer-test','test-staff-password');
 await saveIntegration(sql,'line',{token:'test-private-line-token',to:'U'+'1'.repeat(32)});const [encrypted]=await sql`SELECT encrypted FROM integration_settings WHERE key='line'`;assert.ok(!encrypted.encrypted.includes('test-private-line-token'));assert.equal((await readIntegration(sql,'line')).token,'test-private-line-token');
 const page=await call(null,owner);assert.equal(page.code,200);assert.match(page.html,/เพิ่มทีมงาน/);assert.ok(!page.html.includes('test-private-line-token'));assert.ok(!page.html.includes('scrypt:'));
});
test('scoped list, duplicate-phone history and CSV cannot reveal another sales owner',async()=>{
 [lead]=await sql`INSERT INTO leads(name,phone,phone_key,consent,attribution) VALUES('=FORMULA','+66 98 353 9369','0983539369',true,'{"last":{"gclid":"test-click"}}') RETURNING *,updated_at::text AS version`;
 [other]=await sql`INSERT INTO leads(name,phone,phone_key,consent,assigned_to) VALUES('PRIVATE-OTHER','0983539369','0983539369',true,${viewerId}) RETURNING *,updated_at::text AS version`;
 const ownRows=await leadRows(sql,{id:staffId,role:'sales'},filters(new URLSearchParams('phone=0983539369')));assert.equal(ownRows.length,1);assert.equal(ownRows[0].related_count,1);
 const csv=await call(null,sales,'/admin?export=leads');assert.equal(csv.code,200);assert.ok(!csv.html.includes('PRIVATE-OTHER'));assert.ok(csv.html.includes("'=FORMULA"));
 assert.equal((await call({...input(other)},sales)).code,403);
 assert.equal((await call({...input(lead)},viewer)).code,403);
 assert.equal((await call({action:'delete',id:lead.id},sales)).code,403);
 assert.equal((await call({action:'line_save'},sales)).code,403);
 const page=await call(null,sales);assert.equal(page.code,200);assert.ok(!page.html.includes('PRIVATE-OTHER'));assert.ok(!page.html.includes('เพิ่มทีมงาน'));
});
test('shipment, qualification, assignment and audit commit together; stale edits rejected',async()=>{
 const r=await call({...input(lead),followUp:'2026-09-01T10:30'},sales);assert.equal(r.code,303);
 assert.equal((await call(input(lead),sales)).code,409);
 [lead]=await sql`SELECT *,updated_at::text AS version FROM leads WHERE id=${lead.id}`;assert.equal(lead.shipment.quantity,20);assert.equal(lead.assigned_to,staffId);assert.ok(lead.qualified_at);
 const [history]=await sql`SELECT * FROM lead_history WHERE lead_id=${lead.id}`;assert.equal(history.actor,'sales-test');assert.equal(history.details.shipment.tracking,'TRACK-TEST');
 const [queue]=await sql`SELECT * FROM ads_conversions WHERE lead_id=${lead.id}`;assert.equal(queue.kind,'qualified');
 assert.throws(()=>crmInput({...input(lead),receivedDate:'2026-08-01'}));assert.throws(()=>crmInput({...input(lead),salesStatus:'won'}));assert.throws(()=>crmInput({...input(lead),salesStatus:'lost'}));
});
test('follow-up delivered once; concurrent runs do not duplicate',async()=>{
 await Promise.all([remindFollowups(sql),remindFollowups(sql)]);assert.equal(pushes,1);await remindFollowups(sql);assert.equal(pushes,1);
 const [r]=await sql`SELECT * FROM followup_reminders WHERE lead_id=${lead.id}`;assert.equal(r.status,'sent');
});
test('Ads partial failures remain retryable and successful upload never repeats',async()=>{
 await saveIntegration(sql,'ads',{enabled:true,customerId:'123',qualifiedAction:'456',clientId:'test',clientSecret:'test',refreshToken:'test',developerToken:'test'});
 const first=await sendAds(sql);assert.equal(first.failed,1);const [r]=await sql`SELECT * FROM ads_conversions WHERE lead_id=${lead.id}`;assert.equal(r.status,'failed');
 failAds=false;const second=await sendAds(sql);assert.equal(second.sent,1);await sendAds(sql);assert.equal(uploads,2);
});
test('sale needs actual amount/date, clears appointment and queues a distinct order ID',async()=>{
 const r=await call({...input(lead),salesStatus:'won',saleAmount:'1234.50',closedDate:new Date(Date.now()+7*3600000).toISOString().slice(0,10)},sales);assert.equal(r.code,303);
 const [saved]=await sql`SELECT * FROM leads WHERE id=${lead.id}`;assert.equal(saved.deal.saleAmount,1234.5);assert.equal(saved.follow_up_at,null);
 const rows=await sql`SELECT * FROM ads_conversions WHERE lead_id=${lead.id} ORDER BY kind`;assert.equal(rows.length,2);assert.equal(new Set(rows.map(r=>r.payload.orderId)).size,2);
});
test('disabling staff immediately invalidates an existing cookie',async()=>{
 const r=await call({action:'staff_update',staffId,displayName:'ทีมฝ่ายขาย',role:'sales'},owner);assert.equal(r.code,303);
 assert.equal((await call(null,sales)).code,401);assert.equal((await call({action:'login',username:'sales-test',password:'test-staff-password'})).code,401);
});
test('encrypted backup includes staff, settings, reminders and Ads with exact data',async()=>{
 const data=await makeBackup(sql);assert.equal(data.schemaVersion,6);assert.equal(data.staff.length,2);assert.equal(data.integrations.length,2);assert.equal(data.reminders.length,1);assert.equal(data.ads.length,2);
 const buffer=encryptBackup(data);assert.deepEqual(decryptBackup(buffer),data);
 writeFileSync('/private/tmp/verdeloop-admin-fis49_w_/crm-test-backup.enc',buffer,{mode:0o600});writeFileSync('/private/tmp/verdeloop-admin-fis49_w_/crm-test-backup-key',process.env.BACKUP_ENCRYPTION_KEY,{mode:0o600});
});
test('group selection requires admin confirmation and preserves channel secret on later edits',async()=>{
 const {saveLine}=await import('../lib/integrations.js');const group='C'+'a'.repeat(32);
 await saveIntegration(sql,'line',{token:'test-private-line-token',secret:'test-webhook-secret',groupOnly:true});
 await sql`INSERT INTO system_state(key,value) VALUES(${'line_group:'+group},${JSON.stringify({groupId:group,name:'QA group',active:true})}::jsonb)`;
 assert.equal((await call({action:'line_group_select',groupId:group,confirmed:'on'},viewer)).code,403);
 assert.equal((await call({action:'line_group_select',groupId:group},owner)).code,400);
 assert.equal((await call({action:'line_group_select',groupId:group,confirmed:'on'},owner)).code,303);
 assert.equal((await readIntegration(sql,'line')).to,group);
 await saveLine(sql,{lineTo:group});assert.equal((await readIntegration(sql,'line')).secret,'test-webhook-secret');
 await assert.rejects(()=>saveLine(sql,{lineTo:'U'+'1'.repeat(32)}));
});
