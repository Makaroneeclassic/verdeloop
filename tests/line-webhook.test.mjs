import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {Readable} from 'node:stream';
import {validSignature,receiveGroups} from '../lib/line-webhook.js';
const secret='test-channel-secret',group='C'+'a'.repeat(32),store=new Map();
const sql=async(strings,...values)=>{const query=strings.join('?');if(query.startsWith('SELECT'))return store.has(values[0])?[{value:store.get(values[0])}]:[];const value=JSON.parse(values[1]),old=store.get(values[0]);if(!old||old.lastEventAt<value.lastEventAt)store.set(values[0],value);return [];};
const core=await import('../lib/core.js');
const integrations=await import('../lib/integrations.js');
mock.module('../lib/core.js',{namedExports:{...core,database:()=>sql}});
mock.module('../lib/integrations.js',{namedExports:{...integrations,readIntegration:async()=>({}),lineSettings:async()=>({secret,token:'test'})}});
const {default:handler}=await import('../api/line-webhook.js');
const sign=body=>createHmac('sha256',secret).update(body).digest('base64');
async function call(body,signature=sign(body),method='POST'){const req=Readable.from([Buffer.from(body)]);req.method=method;req.headers={'x-line-signature':signature};const res={setHeader(){},status(c){this.code=c;return this},json(d){this.data=d;return this}};await handler(req,res);return res;}
test('signature binds exact raw bytes including whitespace and Thai text',()=>{const raw='{ "ข้อความ": "สวัสดี" }';assert.equal(validSignature(Buffer.from(raw),sign(raw),secret),true);assert.equal(validSignature(Buffer.from(raw+' '),sign(raw),secret),false);assert.equal(validSignature(Buffer.from(raw),'x',secret),false);});
test('LINE verification event succeeds, unsigned and malformed events rejected',async()=>{assert.equal((await call('{ "events": [] }')).code,200);assert.equal((await call('{"events":[]}','')).code,401);assert.equal((await call('{}')).code,400);assert.equal((await call('{')).code,400);assert.equal((await call('{}',sign('{}'),'GET')).code,405);});
test('group discovery retains metadata only and ignores private chats',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({groupName:'ทีม <test>'}));
 try{const body=JSON.stringify({events:[{type:'message',timestamp:100,source:{type:'group',groupId:group,userId:'private-user'},message:{text:'private message'},replyToken:'private-token'},{type:'message',timestamp:100,source:{type:'user',userId:'private-user'}}]});assert.equal((await call(body)).code,200);const saved=store.get('line_group:'+group);assert.equal(saved.name,'ทีม <test>');assert.ok(!JSON.stringify(saved).includes('private'));assert.equal(store.size,1);}finally{globalThis.fetch=original;}
});
test('redelivery and stale join cannot reactivate a group after leave',async()=>{await receiveGroups(sql,[{type:'leave',timestamp:200,source:{type:'group',groupId:group}}],'test');await receiveGroups(sql,[{type:'join',timestamp:100,source:{type:'group',groupId:group}}],'test');assert.equal(store.get('line_group:'+group).active,false);assert.equal(store.get('line_group:'+group).lastEventAt,200);});
test('invalid signatures cannot mutate discovered groups',async()=>{const before=JSON.stringify([...store]);const raw=JSON.stringify({events:[{type:'join',timestamp:300,source:{type:'group',groupId:group}}]});assert.equal((await call(raw,sign('{}'))).code,401);assert.equal(JSON.stringify([...store]),before);});
