import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
const core=await import('../lib/core.js'),integrations=await import('../lib/integrations.js'),tracking=await import('../lib/line-tracking.js');
let consumed=false,verifiedCalls=0;
const config={enabled:true,channelId:'1234567890',channelSecret:'a'.repeat(32),identityKey:'test',clickDestination:'',friendDestination:''};
const sql=async(strings)=>{const q=strings.join('?');if(q.includes('SET consumed_at')){if(consumed)return [];consumed=true;return [{id:'test',encrypted:'test'}];}return [];};
mock.module('../lib/core.js',{namedExports:{...core,database:()=>sql}});
mock.module('../lib/integrations.js',{namedExports:{...integrations,readIntegration:async()=>config}});
mock.module('../lib/line-tracking.js',{namedExports:{...tracking,matchFriends:async()=>{},verifyLogin:async()=>{verifiedCalls++;return {friend:true,userHash:'test-hash'}}}});
const {default:handler}=await import('../api/line-login.js');
const state='a'.repeat(64);
async function call(url,headers={},method='GET',body){const res={headers:{},setHeader(k,v){this.headers[k]=v},status(v){this.code=v;return this},json(v){this.data=v;return this},redirect(code,url){this.code=code;this.url=url;return this}};await handler({url,method,headers,body},res);return res;}
test('callback rejects missing/mismatched browser state and consumes code once',async()=>{
 const callback='/api/line-login?callback=1&code=test&state='+state+'&friendship_status_changed=true';
 assert.equal((await call(callback)).url,'/line/?result=error');
 assert.equal((await call(callback,{cookie:tracking.LINE_COOKIE+'='+'b'.repeat(64)})).url,'/line/?result=error');assert.equal(verifiedCalls,0);
 const headers={cookie:tracking.LINE_COOKIE+'='+state};assert.equal((await call(callback,headers)).url,'/line/?result=1');assert.equal(verifiedCalls,1);
 assert.equal((await call(callback,headers)).url,'/line/?result=error');assert.equal(verifiedCalls,1);
});
test('results require a valid browser session; start is same-origin only',async()=>{
 assert.equal((await call('/api/line-login?result=1')).code,401);
 assert.equal((await call('/api/line-login',{host:'verdeloopthailand.com',origin:'https://other.example'},'POST',{ads:true})).code,403);
 const r=await call('/api/line-login',{host:'verdeloopthailand.com',origin:'https://verdeloopthailand.com'},'POST',{});assert.equal(r.data.url,tracking.LINE_URL);
});
