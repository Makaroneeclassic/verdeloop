import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const code=readFileSync(new URL('../public/js/measurement.js',import.meta.url),'utf8');
function setup({consent='accepted',analytics,ads,result={ok:true},ok=true,throwGoogle=false,noForm=false}={}){
 const controls=new Map();
 const control=id=>{if(!controls.has(id))controls.set(id,{checked:false,hidden:false,open:false,addEventListener(name,fn){this[name]=fn},focus(){},showModal(){this.open=true},close(){this.open=false}});return controls.get(id)};
 const values=new Map(),handlers={},timers=new Map(),navigations=[],errors=[],events=[];
 let timerId=0,resolveRequest;
 const button={textContent:'ส่ง',disabled:false};
 const form={addEventListener:(name,fn)=>handlers[name]=fn,querySelector:s=>s==='button[type="submit"]'?button:null,prepend:m=>errors.push(m)};
 const settings={dataset:{ga:'G-TCH65KX10K',ads:'AW-18443678211',label:'LPgvCM6l0PMcEIPk0NpE'}};
 const context={crypto:{randomUUID},URL,URLSearchParams,Blob,Date,FormData:class{*[Symbol.iterator](){yield ['name','test'];yield ['phone','0000000000']}},
  setTimeout:fn=>{timers.set(++timerId,fn);return timerId},clearTimeout:id=>timers.delete(id),
  localStorage:{getItem:k=>k==='verdeloop-consent-v2'?(consent===null?null:JSON.stringify({version:2,analytics:analytics??consent==='accepted',ads:ads??consent==='accepted'})):null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},sessionStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},
  location:{pathname:noForm?'/thank-you/':'/sugarcane-straw/',origin:'https://verdeloopthailand.com',search:'',assign:v=>navigations.push(v)},
  navigator:{sendBeacon:()=>true},document:{cookie:'',referrer:'',getElementById:id=>id==='measurement-settings'?settings:control(id),querySelectorAll:s=>s==='[data-consent-accept]'?[control('accept')]:s==='[data-consent-settings]'?[control('settings')]:[],querySelector:()=>noForm?null:form,addEventListener(name,fn){handlers['document_'+name]=fn},head:{append(){}},createElement:()=>({setAttribute(){},focus(){}})},
  fetch:()=>new Promise(resolve=>{resolveRequest=()=>resolve({ok,json:async()=>result})}),window:{innerWidth:390}};
 vm.runInNewContext(code,context);
 context.window.gtag=(...args)=>{if(throwGoogle)throw Error('blocked');events.push(args)};
 return {handlers,controls,context,events,errors,navigations,values,timers,button,submit:()=>handlers.submit({preventDefault(){}}),ack:()=>resolveRequest(),conversion:()=>events.find(e=>e[1]==='conversion')?.[2],flush:async()=>{for(let i=0;i<6;i++)await Promise.resolve()}};
}
test('only acknowledged success emits exact Ads destination and waits for callback',async()=>{
 const h=setup();const id=h.values.get('verdeloop-submission-id');const pending=h.submit();
 assert.equal(h.events.length,0);assert.equal(h.button.disabled,true);
 h.ack();await h.flush();const conversion=h.conversion();
 assert.equal(conversion.send_to,'AW-18443678211/LPgvCM6l0PMcEIPk0NpE');assert.equal(conversion.value,1);assert.equal(conversion.currency,'THB');assert.equal(conversion.transaction_id,id);
 assert.deepEqual(h.navigations,[]);assert.equal(h.values.has('verdeloop-submission-id'),false);
 conversion.event_callback();await pending;assert.deepEqual(h.navigations,['/thank-you/']);assert.equal(h.timers.size,0);
});
test('missing tag callback cannot trap successful form',async()=>{
 const h=setup();const pending=h.submit();h.ack();await h.flush();for(const fn of h.timers.values())fn();await pending;assert.deepEqual(h.navigations,['/thank-you/']);
});
for(const error of ['validation','rate_limit','delivery_failed'])test(error+' emits no conversion and retains retry ID',async()=>{
 const h=setup({ok:false,result:{ok:false,error}});const id=h.values.get('verdeloop-submission-id');const pending=h.submit();h.ack();await pending;
 assert.equal(h.events.length,0);assert.equal(h.navigations.length,0);assert.equal(h.errors.length,1);assert.equal(h.button.disabled,false);assert.equal(h.values.get('verdeloop-submission-id'),id);
});
test('duplicate response skips measurement',async()=>{const h=setup({result:{ok:true,duplicate:true}});const p=h.submit();h.ack();await p;assert.equal(h.events.length,0);assert.deepEqual(h.navigations,['/thank-you/'])});
test('refusing measurement still allows successful form',async()=>{const h=setup({consent:'denied'});const p=h.submit();h.ack();await p;assert.equal(h.events.length,0);assert.deepEqual(h.navigations,['/thank-you/'])});
test('measurement errors cannot report successful submission as failed',async()=>{const h=setup({throwGoogle:true});const p=h.submit();h.ack();await p;assert.equal(h.errors.length,0);assert.deepEqual(h.navigations,['/thank-you/'])});
test('opening thank-you page emits no lead conversion',()=>{const h=setup({noForm:true});assert.equal(h.conversion(),undefined)});

test('no choice loads no Google tags and contact consent never grants measurement',async()=>{const h=setup({consent:null});assert.equal(h.context.window.dataLayer,undefined);const p=h.submit();h.ack();await p;assert.equal(h.events.length,0);assert.equal(h.controls.get('measurement-banner').hidden,false);});
test('analytics-only emits GA lead without Ads conversion',async()=>{const h=setup({analytics:true,ads:false});const p=h.submit();h.ack();await p;assert.ok(h.events.some(e=>e[1]==='generate_lead'&&e[2].send_to==='G-TCH65KX10K'));assert.equal(h.conversion(),undefined);});
test('ads-only emits conversion without GA lead',async()=>{const h=setup({analytics:false,ads:true});const p=h.submit();h.ack();await h.flush();assert.ok(h.conversion());assert.ok(!h.events.some(e=>e[1]==='generate_lead'));h.conversion().event_callback();await p;});
test('settings allow denying both and later changing categories independently',()=>{const h=setup({consent:null});h.controls.get('settings').click({currentTarget:h.controls.get('settings')});assert.equal(h.controls.get('measurement-dialog').open,true);h.controls.get('consent-reject').click();let saved=JSON.parse(h.values.get('verdeloop-consent-v2'));assert.equal(saved.analytics,false);assert.equal(saved.ads,false);h.controls.get('settings').click({});h.controls.get('consent-analytics').checked=true;h.controls.get('consent-save').click();saved=JSON.parse(h.values.get('verdeloop-consent-v2'));assert.equal(saved.analytics,true);assert.equal(saved.ads,false);});
test('one explicit form selection grants both categories when submitted, after a previous refusal',async()=>{
 const h=setup({consent:'denied'});const checkbox=h.controls.get('consent-all');checkbox.checked=true;checkbox.change();assert.equal(h.values.has('verdeloop-consent-v2'),false);
 const p=h.submit();const saved=JSON.parse(h.values.get('verdeloop-consent-v2'));assert.equal(saved.analytics,true);assert.equal(saved.ads,true);assert.equal(saved.source,'form');
 h.context.window.gtag=(...args)=>h.events.push(args);h.ack();await h.flush();assert.ok(h.conversion());assert.ok(h.events.some(e=>e[1]==='generate_lead'));h.conversion().event_callback();await p;
});
test('unchecking combined form choice revokes both on submit without blocking request',async()=>{
 const h=setup();h.controls.get('consent-all').checked=false;h.controls.get('consent-all').change();const p=h.submit();h.ack();await p;
 const saved=JSON.parse(h.values.get('verdeloop-consent-v2'));assert.equal(saved.analytics,false);assert.equal(saved.ads,false);assert.equal(h.conversion(),undefined);assert.deepEqual(h.navigations,['/thank-you/']);
});

test('LINE button keeps new-tab navigation, includes attribution handoff and records placement without lead conversion',()=>{
 const h=setup();const a={dataset:{track:'line',placement:'contact_bar'},href:'/line/?placement=contact_bar',hasAttribute:()=>false};
 h.handlers.document_click({target:{closest:()=>a}});
 assert.equal(new URL(a.href).searchParams.get('from'),'/sugarcane-straw/');
 assert.ok(h.events.some(e=>e[1]==='line_click'&&e[2].button_position==='mobile_bar'));
 assert.equal(h.conversion(),undefined);
 const no=setup({consent:'denied'});const b={...a,href:'/line/?placement=hero'};
 no.handlers.document_click({target:{closest:()=>b}});assert.equal(new URL(b.href).hash,'');assert.equal(no.events.length,0);
});
