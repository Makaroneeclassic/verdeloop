import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writerPost,writerGet} from '../lib/writer.js';
import {encryptBackup,decryptBackup} from '../lib/backup.js';

test('key can be saved before models, preserves settings and rejects invalid or unauthorized changes',async()=>{
 const previousKey=process.env.BACKUP_ENCRYPTION_KEY;
 process.env.BACKUP_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');
 let encrypted;
 const sql=async(strings,...values)=>{
  if(strings.join('').startsWith('SELECT'))return encrypted?[{encrypted}]:[];
  encrypted=values[1];return [];
 };
 const post=async(body,role='owner',headers={})=>{
  const res={code:200,headers:{'Content-Type':'text/html; charset=utf-8'},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(v){this.body=v;return this},redirect(code,url){this.code=code;this.location=url;return this}};
  await writerPost({actor:{role},headers,body:{action:'writer_settings',keyOnly:true,...body}},res,sql);return res;
 };
 try{
  const apiKey='sk-or-v1-'+'a'.repeat(64);
  let r=await post({apiKey});assert.equal(r.code,200);assert.equal(r.body.config.configured,true);
  assert.equal(r.body.config.textModel,'openai/gpt-4.1-mini');
  assert.equal(r.body.config.imageModel,'openai/gpt-image-2');
  assert.match(r.headers['Content-Type'],/^application\/json/);
  assert.doesNotMatch(JSON.stringify(r.body),/sk-or-/);
  assert.equal(decryptBackup(Buffer.from(encrypted,'base64')).apiKey,apiKey);
  r=await post({keyOnly:false,textModel:'openai/gpt-4.1-mini',imageModel:'',dailyLimit:20});
  assert.equal(r.code,200,'writing setup does not require an image model');
  const prior={apiKey,textModel:'test/text',imageModel:'test/image',dailyLimit:8,template:'keep',logo:'keep-logo'};
  encrypted=encryptBackup(prior).toString('base64');
  const replacement='sk-or-v1-'+'b'.repeat(64);
  r=await post({apiKey:replacement});assert.equal(r.code,200);
  assert.deepEqual(decryptBackup(Buffer.from(encrypted,'base64')),{...prior,apiKey:replacement});
  r=await post({apiKey:replacement,keyOnly:'true'},'owner',{accept:'text/html'});
  assert.equal(r.code,303);assert.equal(r.location,'/admin?view=writer&keySaved=1');
  assert.deepEqual(decryptBackup(Buffer.from(encrypted,'base64')),{...prior,apiKey:replacement});
  const snapshot=encrypted;
  for(const apiKey of ['', 'invalid'])assert.equal((await post({apiKey})).code,400);
  assert.equal((await post({apiKey},'sales')).code,403);assert.equal(encrypted,snapshot);
 }finally{
  if(previousKey===undefined)delete process.env.BACKUP_ENCRYPTION_KEY;else process.env.BACKUP_ENCRYPTION_KEY=previousKey;
 }
});

test('writer data errors override the admin HTML content type for fetch clients',async()=>{
 const res={code:200,headers:{'Content-Type':'text/html; charset=utf-8'},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(v){this.body=v;return this}};
 await writerGet({actor:{role:'owner'},url:'/admin?view=writer&data=draft&id=invalid'},res,()=>{throw Error('must not reach storage')},x=>x);
 assert.equal(res.code,400);assert.match(res.headers['Content-Type'],/^application\/json/);assert.equal(res.body.ok,false);
});
