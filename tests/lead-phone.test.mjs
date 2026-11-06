// Run with: node --experimental-test-module-mocks --test tests/lead-phone.test.mjs
// Exercises the actual HTTP handler without connecting to a live database/LINE.
import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
const inserted=[],notified=[];
mock.module('@neondatabase/serverless',{namedExports:{neon:()=>async(strings,...values)=>{
 const query=strings.join('?');
 assert.match(query,/INSERT INTO leads/);
 inserted.push({phone:values[2],consent:values[9],attribution:JSON.parse(values[11])});return [{id:inserted.length}];
}}});
mock.module('../lib/core.js',{namedExports:{limit:async()=>({allowed:true}),attribution:value=>typeof value==='string'?JSON.parse(value):(value||{}),validUUID:()=>false}});
mock.module('../lib/notifications.js',{namedExports:{notifyLead:async(sql,id)=>notified.push(id),push:async()=>{throw Error('Unexpected LINE fallback')},leadMessage:()=>''}});
process.env.DATABASE_URL='https://example.invalid/test';
const {default:handler}=await import('../api/lead.js');
async function submit(phone,html=false,extra={}){
 const result={};const res={setHeader(){},status(code){result.code=code;return this},json(body){result.body=body;return this},redirect(code,to){result.code=code;result.to=to;return this}};
 await handler({method:'POST',headers:{accept:html?'text/html':'application/json'},body:{name:'Test',phone,consent:true,...extra}},res);return result;
}
test('JSON form stores normalized +66 and still notifies accepted lead',async()=>{
 const r=await submit('+66 (0)98-353-9369');assert.equal(r.code,200);assert.equal(r.body.ok,true);assert.equal(inserted.at(-1).phone,'0983539369');assert.equal(notified.at(-1),r.body.id);
});
test('native form stores normalized 0066 and redirects successfully',async()=>{
 const r=await submit('0066 98 353 9369',true);assert.equal(r.code,303);assert.equal(r.to,'/thank-you/');assert.equal(inserted.at(-1).phone,'0983539369');
});
test('invalid phone does not store a lead',async()=>{
 const count=inserted.length;const r=await submit('+66 invalid');assert.equal(r.code,400);assert.deepEqual(r.body.fields,['phone']);assert.equal(inserted.length,count);
});

test('combined form consent stores both purposes and click attribution',async()=>{
 const r=await submit('0810000000',false,{consent:undefined,contactRequest:'sample-v2',allConsent:'on',attribution:JSON.stringify({last:{gclid:'test-click'}})});assert.equal(r.code,200);const row=inserted.at(-1);assert.equal(row.consent,true);assert.equal(row.attribution._consent.analytics,true);assert.equal(row.attribution._consent.ads,true);assert.equal(row.attribution._consent.source,'form');assert.equal(row.attribution.last.gclid,'test-click');
});
test('unchecked sample request stores contact request without granting tracking',async()=>{
 const r=await submit('0810000000',false,{consent:undefined,contactRequest:'sample-v2',attribution:JSON.stringify({last:{gclid:'must-not-store'}})});assert.equal(r.code,200);const row=inserted.at(-1);assert.equal(row.consent,true);assert.equal(row.attribution._consent.analytics,false);assert.equal(row.attribution._consent.ads,false);assert.equal(row.attribution.last,undefined);
});
