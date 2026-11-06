import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {writerPost,writerGet} from '../lib/writer.js';
import {readIntegration} from '../lib/integrations.js';
const schema=process.env.WRITER_TEST_SCHEMA;
test('draft storage, encrypted settings, optimistic locking, revisions and permissions', {skip:!schema},async()=>{
 assert.match(schema,/^writer_test_\d+$/);const raw=neon(process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL);
 const sql=(strings,...values)=>raw.transaction([raw.query('SET LOCAL search_path TO '+schema),raw(strings,...values)]).then(r=>r[1]);
 const owner={username:'test-owner',role:'owner'};
 const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(v){this.body=v;return this},send(v){this.body=v;return this}});
 const post=async(body,actor=owner)=>{const res=response();await writerPost({body,actor,headers:{}},res,sql);return res;};
 let r=await post({action:'writer_settings',apiKey:'sk-or-v1-'+'test'.repeat(16),textModel:'test/text',imageModel:'test/image',dailyLimit:20,template:'เขียนสำหรับคาเฟ่'});assert.equal(r.code,200);assert.ok(!JSON.stringify(r.body).includes('sk-or-'));
 const [encrypted]=await sql`SELECT encrypted FROM integration_settings WHERE key='writer'`;assert.ok(!encrypted.encrypted.includes('sk-or-'));assert.ok((await readIntegration(sql,'writer')).apiKey.startsWith('sk-or-'));
 r=await post({action:'writer_new',id:randomUUID()},{username:'sales',role:'sales'});assert.equal(r.code,403);
 const id=randomUUID();assert.equal((await post({action:'writer_new',id})).code,200);
 const payload={action:'writer_save',id,version:1,title:'ชื่อบทความ',description:'สรุป',content:'<p>เนื้อหา</p><script>bad()</script>',brief:{keyword:'หลอดชานอ้อย'}};
 r=await post(payload);assert.equal(r.code,200);assert.equal(r.body.draft.version,2);assert.doesNotMatch(r.body.draft.content,/script/);
 assert.equal((await post({...payload,title:'ไม่ควรทับ'})).code,409);
 const [stored]=await sql`SELECT title FROM article_drafts WHERE id=${id}`;assert.equal(stored.title,'ชื่อบทความ');
 const [rev]=await sql`SELECT snapshot FROM article_revisions WHERE draft_id=${id}`;assert.equal(rev.snapshot.version,1);
 const res=response();await writerGet({actor:owner,url:'/admin?view=writer&data=draft&id='+id},res,sql,x=>x);assert.equal(res.body.draft.version,2);assert.equal(res.body.revisions.length,1);
 const safe=response();await writerGet({actor:owner,url:'/admin?view=writer&data=list'},safe,sql,x=>x);assert.doesNotMatch(JSON.stringify(safe.body),/sk-or-/);
 const job=randomUUID();await sql`INSERT INTO writer_jobs(id,draft_id,actor,kind,status,result) VALUES(${job},${id},'test-owner','article','done','{"title":"already generated"}'::jsonb)`;
 r=await post({action:'writer_generate',id,jobId:job,kind:'article'});assert.equal(r.code,200);assert.equal(r.body.job.result.title,'already generated');
 await raw.transaction([raw.query('SET LOCAL search_path TO '+schema),raw.query('CREATE TABLE IF NOT EXISTS rate_limits(key text PRIMARY KEY,hits integer NOT NULL,expires_at timestamptz NOT NULL)')]);
 const nativeFetch=globalThis.fetch;let paidCalls=0;
 process.env.RATE_LIMIT_SECRET='test-writer-rate';
 globalThis.fetch=async(url,options)=>{
  if(!String(url).startsWith('https://openrouter.ai/'))return nativeFetch(url,options);
  if(String(url).endsWith('/images/models'))return Response.json({data:[{id:'test/image',architecture:{output_modalities:['image']}}]});
  if(String(url).endsWith('/models'))return Response.json({data:[{id:'test/text',architecture:{output_modalities:['text']}}]});
  paidCalls++;return Response.json({choices:[{message:{content:JSON.stringify({title:'ข้อเสนอจาก AI',metaDescription:'สรุป',content:'<p>'+'ข้อมูลตัวอย่าง '.repeat(30)+'</p>'})}}]});
 };
 try{
  const generation={action:'writer_generate',id,jobId:randomUUID(),kind:'article'};
  r=await post(generation);assert.equal(r.code,200,JSON.stringify(r.body));assert.equal(r.body.job.status,'done');assert.equal(paidCalls,1);
  r=await post(generation);assert.equal(r.code,200);assert.equal(paidCalls,1,'retrying request does not bill again');
  const [kept]=await sql`SELECT title FROM article_drafts WHERE id=${id}`;assert.equal(kept.title,'ชื่อบทความ','AI candidate never overwrites existing draft');
 }finally{globalThis.fetch=nativeFetch;}
});
