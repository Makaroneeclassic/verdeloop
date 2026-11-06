import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const code=readFileSync(new URL('../public/js/line-contact.js',import.meta.url),'utf8');
async function run({analytics=false,ads=false,search='',response={ok:true,enabled:false},httpOK=true,priorClick=false,tagAvailable=true,loaded=false}={}){
 const events=[],requests=[],redirects=[],store=new Map(),status={textContent:''};if(priorClick)store.set('line-click-sent','1');let ready,click;const button={hidden:true,addEventListener:(event,fn)=>{click=fn}};
 const context={URL,URLSearchParams,JSON,crypto:{randomUUID},AbortSignal,decodeURIComponent,setTimeout:fn=>{queueMicrotask(fn);return 1},clearTimeout(){},history:{replaceState(){}},location:{search,hash:'',pathname:'/line/',origin:'https://verdeloopthailand.com',replace:v=>redirects.push(v)},sessionStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},localStorage:{getItem:()=>JSON.stringify({version:2,analytics,ads})},document:{readyState:loaded?'complete':'loading',getElementById:id=>id==='line-status'?status:id==='line-debug-test'?button:{dataset:{ga:'G-TCH65KX10K'}}},fetch:async(url,opts)=>{requests.push({url,opts});return {ok:httpOK,json:async()=>response}},window:{addEventListener:(event,fn)=>{ready=fn},gtag:(...args)=>{events.push(args);args[2]?.event_callback?.()}}};
 if(!tagAvailable)delete context.window.gtag;vm.runInNewContext(code,context);ready?.();for(let i=0;i<100;i++)await Promise.resolve();
 return {events,requests,redirects,status,button,click:async()=>{await click();for(let i=0;i<100;i++)await Promise.resolve();}};
}
test('no consent opens ordinary LINE without Login or Google requests',async()=>{
 const h=await run();assert.equal(h.requests.length,0);assert.equal(h.events.length,0);assert.deepEqual(h.redirects,['https://line.me/R/ti/p/@verdeloop']);
});
test('click destination is independent and never emits an add-friend event',async()=>{
 const h=await run({ads:true,response:{enabled:false,clickDestination:'AW-18443678211/clickOnly'}});
 assert.equal(h.events.filter(e=>e[1]==='conversion').length,1);assert.equal(h.events[0][2].send_to,'AW-18443678211/clickOnly');assert.equal(h.redirects.length,1);
});
test('existing friendship and forged success URLs never emit new-friend conversion',async()=>{
 for(const httpOK of [true,false]){
  const h=await run({analytics:true,ads:true,search:'?result=1',httpOK,response:{friend:true,conversionId:null,ads:true,analytics:true}});
  assert.equal(h.events.length,0);
 }
});
test('verified friend emits only under independently permitted categories',async()=>{
 const response={friend:true,conversionId:'test-confirmed-id',analytics:true,ads:true,placement:'hero',path:'/sugarcane-straw/',friendDestination:'AW-18443678211/friendOnly'};
 for(const [analytics,ads] of [[false,false],[true,false],[false,true],[true,true]]){
  const h=await run({analytics,ads,search:'?result=1',response});
  assert.equal(h.events.some(e=>e[1]==='line_add_friend'),analytics);
  const conversion=h.events.find(e=>e[1]==='conversion');assert.equal(Boolean(conversion),ads);
  if(conversion){assert.equal(conversion[2].send_to,response.friendDestination);assert.equal(conversion[2].transaction_id,response.conversionId);}
 }
});

test('debug waits for explicit click, honors consent, stays on page and deduplicates',async()=>{
 for(const ads of [false,true]){
  const h=await run({ads,search:'?debug=1',response:{enabled:true,clickDestination:'AW-18443678211/clickOnly'}});
  assert.equal(h.button.hidden,false);assert.equal(h.events.length,0);assert.equal(h.requests.length,0);assert.equal(h.redirects.length,0);
  await h.click();await h.click();
  assert.equal(h.events.length,ads?1:0);assert.equal(h.redirects.length,0);
  assert.equal(h.requests.some(r=>r.opts?.method==='POST'),false);
 }
});

test('explicit debug test is not suppressed by a previous normal click and supports late script loading',async()=>{
 const h=await run({ads:true,priorClick:true,loaded:true,search:'?debug=1',response:{clickDestination:'AW-18443678211/clickOnly'}});
 await h.click();assert.equal(h.events.length,1);assert.equal(h.button.disabled,false);assert.match(h.status.textContent,/callback/);
 await h.click();assert.equal(h.events.length,1);
});
test('debug failures explain the cause and restore a usable button',async()=>{
 for(const settings of [{httpOK:false},{tagAvailable:false},{response:{}}]){
  const h=await run({ads:true,search:'?debug=1',response:{clickDestination:'AW-18443678211/clickOnly'},...settings});
  await h.click();assert.equal(h.events.length,0);assert.equal(h.button.disabled,false);assert.match(h.status.textContent,/ไม่สำเร็จ|ยังไม่พร้อม|ยังไม่ได้ตั้ง/);
 }
});
