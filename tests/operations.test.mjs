import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFileSync,readFileSync} from 'node:fs';
import {database,limit,attribution} from '../lib/core.js';
import {notifyLead} from '../lib/notifications.js';
import {uploadDocument,removeDocument} from '../lib/documents.js';
import {makeBackup,encryptBackup,decryptBackup} from '../lib/backup.js';
import leadHandler from '../api/lead.js';
import eventHandler from '../api/events.js';
import adminHandler from '../api/admin.js';
if(!new URL(process.env.DATABASE_URL).pathname.includes('_test_'))throw new Error('Tests require isolated test database');
process.env.ADMIN_USER='test-admin';process.env.ADMIN_PASSWORD='test-password';process.env.RATE_LIMIT_SECRET='test-rate-key';
process.env.BACKUP_ENCRYPTION_KEY=randomBytes(32).toString('base64');
process.env.LINE_CHANNEL_ACCESS_TOKEN='test-token';process.env.LINE_TO='test-recipient';
const sql=database(),originalFetch=globalThis.fetch;let pushes=0;let testDocument;
before(async()=>{await sql`TRUNCATE leads,lead_history,rate_limits,contact_events,system_state,document_files,staff_users,integration_settings,followup_reminders,ads_conversions RESTART IDENTITY CASCADE`;globalThis.fetch=(url,opts)=>String(url).startsWith('https://api.line.me/')?(pushes++,Promise.resolve(new Response('{}',{status:200}))):originalFetch(url,opts);});
after(async()=>{globalThis.fetch=originalFetch;if(testDocument)await removeDocument(sql,testDocument);});
const req=(body={},headers={})=>({method:'POST',url:'/admin',body,headers:{host:'verdeloopthailand.com',origin:'https://verdeloopthailand.com',accept:'application/json','x-vercel-forwarded-for':'192.0.2.10',...headers}});
async function call(handler,r){const res={code:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},status(c){this.code=c;return this},json(d){this.data=d;return this},send(d){this.html=d;return this},redirect(c,url){this.code=c;this.location=url;return this}};await handler(r,res);return res;}
let leadId;
test('parallel rate limits use a shared atomic counter and retain no raw IP',async()=>{
 const scope='test-'+randomUUID();const results=await Promise.all(Array.from({length:8},()=>limit(sql,req(),scope,3,600)));
 assert.equal(results.filter(r=>r.allowed).length,3);
 const rows=await sql`SELECT key FROM rate_limits WHERE key LIKE ${scope+'%'}`;assert.equal(rows.length,1);assert.ok(!rows[0].key.includes('192.0.2.10'));
});
test('submission records attribution and retries do not duplicate the lead or LINE push',async()=>{
 const body={name:'[TEST] <img src=x onerror=alert(1)>',phone:'0810000000',company:'Ops test',email:'qa@example.invalid',businessType:'อื่น ๆ',size:'8 มม.',volume:'ยังไม่แน่ใจ',message:'test message',consent:true,submissionId:randomUUID(),measurementConsent:'accepted',attribution:JSON.stringify({first:{utm_source:'google',utm_campaign:'launch'},last:{utm_source:'google',utm_campaign:'launch',path:'/sample/',referrer:'https://example.org/a?secret=123'}})};
 const first=await call(leadHandler,req(body));assert.equal(first.code,200);leadId=first.data.id;
 const second=await call(leadHandler,req(body));assert.equal(second.code,200);assert.equal(second.data.duplicate,true);assert.equal(second.data.id,leadId);assert.equal(pushes,1);
 const [row]=await sql`SELECT * FROM leads WHERE id=${leadId}`;assert.equal(row.attribution.last.utm_campaign,'launch');assert.equal(row.attribution.last.referrer,'example.org');assert.ok(row.notified_at);
});
test('honeypot requires valid consent and never sends LINE',async()=>{
 const initial=pushes;const denied=await call(leadHandler,req({website:'bot',name:'test',phone:'0810000000'}));assert.equal(denied.code,400);
 const saved=await call(leadHandler,req({website:'bot',name:'test',phone:'0810000000',consent:true}));assert.equal(saved.code,200);assert.equal(pushes,initial);
});
test('tracking requires consent, omits arbitrary fields, deduplicates events',async()=>{
 const b={id:randomUUID(),event:'line_click',path:'/products/',consent:true,attribution:{last:{utm_source:'campaign',email:'private@example.org'}}};
 assert.equal((await call(eventHandler,req({...b,consent:false}))).code,400);
 for(let i=0;i<2;i++)assert.equal((await call(eventHandler,req(b))).code,200);
 const rows=await sql`SELECT * FROM contact_events WHERE id=${b.id}`;assert.equal(rows.length,1);assert.equal(rows[0].source,'campaign');assert.ok(!JSON.stringify(rows).includes('private@'));
});
test('CRM saves status, Thai follow-up, audit history; stale edits rejected; output escaped',async()=>{
 const login=await call(adminHandler,req({action:'login',username:'test-admin',password:'test-password'}));assert.equal(login.code,303);const cookie=login.headers['set-cookie'].split(';')[0];
 const [row]=await sql`SELECT updated_at::text AS version FROM leads WHERE id=${leadId}`;
 const change={action:'update',id:leadId,salesStatus:'sample_sent',note:'ส่งตัวอย่างแล้ว <script>alert(1)</script>',followUp:'2026-09-15T10:30',version:row.version};
 assert.equal((await call(adminHandler,req(change,{cookie}))).code,303);
 assert.equal((await call(adminHandler,req(change,{cookie}))).code,409);
 const [saved]=await sql`SELECT * FROM leads WHERE id=${leadId}`;assert.equal(saved.sales_status,'sample_sent');assert.equal(new Date(saved.follow_up_at).toISOString(),'2026-09-15T03:30:00.000Z');
 const history=await sql`SELECT * FROM lead_history WHERE lead_id=${leadId}`;assert.equal(history.length,1);
 const dashboard=await call(adminHandler,{...req({}, {cookie}),method:'GET'});assert.equal(dashboard.code,200);assert.ok(dashboard.html.includes('&lt;script&gt;'));assert.ok(!dashboard.html.includes('<img src=x'));
});
test('notification retry window prevents possible duplicate pushes after expiration',async()=>{
 const [row]=await sql`INSERT INTO leads(name,phone,consent,notify_started_at) VALUES('expired-test','0810000000',true,now()-interval '25 hours') RETURNING id`;
 const initial=pushes,result=await notifyLead(sql,row.id);assert.equal(result.error,'review_required');assert.equal(pushes,initial);
});
test('document upload rejects fake PDFs and stores a real specification in private storage',async()=>{
 await assert.rejects(()=>uploadDocument(sql,{documentId:randomUUID(),title:'invalid',kind:'certificate',file:Buffer.from('<html>').toString('base64')}));
 testDocument=randomUUID();const pdf=readFileSync('public/downloads/verdeloop-straw-6mm.pdf');
 const result=await uploadDocument(sql,{documentId:testDocument,title:'[TEST] Specification',kind:'specification',file:pdf.toString('base64')});assert.equal(result.id,testDocument);
 const [row]=await sql`SELECT * FROM document_files WHERE id=${testDocument}`;assert.equal(row.size,pdf.length);
});
test('backup encrypts all application data and tampering is detected',async()=>{
 const data=await makeBackup(sql),encrypted=encryptBackup(data);assert.deepEqual(decryptBackup(encrypted),data);assert.ok(!encrypted.toString().includes('qa@example.invalid'));
 const box=JSON.parse(encrypted);box.data='AAAA'+box.data.slice(4);assert.throws(()=>decryptBackup(Buffer.from(JSON.stringify(box))));
 writeFileSync('/private/tmp/verdeloop-admin-fis49_w_/test-backup.enc',encrypted,{mode:0o600});
 writeFileSync('/private/tmp/verdeloop-admin-fis49_w_/test-backup-key',process.env.BACKUP_ENCRYPTION_KEY,{mode:0o600});
});
test('attribution strips URLs, unknown fields and markup',()=>{const value=attribution({first:{utm_source:'<script>x</script>',referrer:'https://example.org/secret?q=private',phone:'123'}});assert.equal(value.first.referrer,'example.org');assert.equal(value.first.phone,undefined);assert.ok(!value.first.utm_source.includes('<'));});
test('form contact permission is separate; analytics-only strips ad click IDs server-side',async()=>{
 for(const [index,prefs] of [{analyticsConsent:'false',adsConsent:'false'},{analyticsConsent:'true',adsConsent:'false'}].entries()){
  const response=await call(leadHandler,req({name:'Consent QA',phone:'0810000000',consent:true,consentVersion:'2',consentSource:'form',...prefs,submissionId:randomUUID(),attribution:JSON.stringify({last:{utm_source:'google',gclid:'must-not-store',gbraid:'must-not-store'}})},{'x-vercel-forwarded-for':'192.0.2.'+(80+index)}));
  assert.equal(response.code,200);const [saved]=await sql`SELECT attribution FROM leads WHERE id=${response.data.id}`;
  assert.equal(saved.attribution._consent.ads,false);assert.ok(!JSON.stringify(saved.attribution).includes('must-not-store'));assert.equal(Boolean(saved.attribution.last),index===1);
 }
});
test('single disclosed opt-in grants both purposes; sample request without it remains usable',async()=>{
 for(const [index,choice] of [{allConsent:'on'},{}].entries()){
  const response=await call(leadHandler,req({name:'Single consent QA',phone:'0810000000',contactRequest:'sample-v2',...choice,submissionId:randomUUID(),attribution:JSON.stringify({last:{gclid:'consented-test-click'}})},{'x-vercel-forwarded-for':'192.0.2.'+(90+index)}));assert.equal(response.code,200);
  const [saved]=await sql`SELECT consent,attribution FROM leads WHERE id=${response.data.id}`;assert.equal(saved.consent,true);assert.equal(saved.attribution._consent.analytics,index===0);assert.equal(saved.attribution._consent.ads,index===0);assert.equal(Boolean(saved.attribution.last?.gclid),index===0);
 }
});
