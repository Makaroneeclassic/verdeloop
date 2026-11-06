import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildArticlePrompt,parseResearch,briefInput} from '../lib/writer-content.js';
import {researchKeyword} from '../lib/writer-ai.js';

const analysis={intent:'ให้ความรู้เรื่องการเลือกเมล็ดกาแฟ',audience:'คนชงกาแฟ',outline:'H2 ประเภทเมล็ดกาแฟ',mustCover:['ระดับคั่ว'],productFit:'ไม่ควรขายหลอด'};
test('character target persists, is bounded and controls the writing instruction',()=>{
 const brief=briefInput({keyword:'เมล็ดกาแฟ',targetChars:'9000'});
 assert.equal(brief.targetChars,'9000');assert.match(buildArticlePrompt(brief),/9000 ตัวอักษร \(ไม่ใช่จำนวนคำ\)/);
 assert.equal(briefInput({}).targetChars,'');
 for(const n of ['abc',499,15001,1000.5])assert.throws(()=>briefInput({targetChars:n}),/จำนวนตัวอักษร/);
});
test('editorial writing omits product fact sheet and uses only matching keyword research',()=>{
 const b=briefInput({keyword:'เมล็ดกาแฟ'}),p=buildArticlePrompt(b);
 assert.match(p,/โหมดให้ความรู้ล้วน/);assert.doesNotMatch(p,/210 มม\.|\/sugarcane-straw\//);
 assert.match(buildArticlePrompt({...b,productMode:'relevant'}),/ไม่เกิน 1 ย่อหน้า/);
 assert.doesNotMatch(buildArticlePrompt(b,{keyword:'other',intent:'STALE-INTENT'}),/STALE-INTENT/);
 assert.match(buildArticlePrompt(b,{keyword:b.keyword,intent:'MATCHING-INTENT'}),/MATCHING-INTENT/);
});
test('research needs provider citations, rejects invented or unsafe source links',()=>{
 const message={content:JSON.stringify({...analysis,sources:[{url:'https://invented.test'}]})};
 assert.throws(()=>parseResearch(message,'เมล็ดกาแฟ'),/แหล่งอ้างอิง/);
 message.annotations=[{type:'url_citation',url_citation:{url:'javascript:alert(1)'}}];
 assert.throws(()=>parseResearch(message,'เมล็ดกาแฟ'),/แหล่งอ้างอิง/);
 message.annotations.push({type:'url_citation',url_citation:{url:'https://source.test/coffee',title:'Coffee',content:'coffee excerpt'}});
 const r=parseResearch(message,'เมล็ดกาแฟ');assert.equal(r.sources.length,1);assert.equal(r.type,'research');assert.equal(r.sources[0].url,'https://source.test/coffee');
});
test('research searches with bounded cost and retains grounded intent',async()=>{
 const original=globalThis.fetch;let payload;
 globalThis.fetch=async(url,options)=>{
  if(String(url).endsWith('/images/models'))return Response.json({data:[]});
  if(String(url).endsWith('/models'))return Response.json({data:[{id:'test/research',architecture:{output_modalities:['text']}}]});
  payload=JSON.parse(options.body);return Response.json({choices:[{message:{content:JSON.stringify(analysis),annotations:[{type:'url_citation',url_citation:{url:'https://source.test/coffee'}}]}}]});
 };
 try{const r=await researchKeyword({textModel:'test/research',apiKey:'test-key'},{keyword:'เมล็ดกาแฟ'});
  assert.equal(payload.tools[0].type,'openrouter:web_search');assert.equal(payload.tools[0].parameters.max_total_results,5);assert.equal(payload.tools[0].parameters.max_uses,1);assert.equal(r.intent,analysis.intent);
 }finally{globalThis.fetch=original;}
});
