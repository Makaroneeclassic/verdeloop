import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {cleanContent,parseArticle,briefInput,buildArticlePrompt} from '../lib/writer-content.js';
import {brandImage,generateArticle,generateImage,cleanLogo,routerRequest,buildImagePrompt} from '../lib/writer-ai.js';
import {writerUI} from '../lib/writer-ui.js';
const originalFetch=globalThis.fetch;after(()=>{globalThis.fetch=originalFetch;});
test('article HTML strips scripts, handlers, trackers and unsafe links while retaining internal images',()=>{
 const html=cleanContent('<h2>หัวข้อ</h2><script>alert(1)</script><img src="https://evil.test/t" onerror="alert(1)"><a href="javascript:alert(1)">link</a><iframe src="x"></iframe><img src="/admin?view=writer&image=11111111-1111-1111-1111-111111111111" alt="ภาพ">');
 assert.doesNotMatch(html,/script|evil|onerror|iframe|javascript/);assert.match(html,/view=writer&amp;image=/);
 assert.match(html,/noopener noreferrer/);
});
test('prompt uses supplied outline and facts without pretending SERP research; malformed results rejected',()=>{
 const brief=briefInput({keyword:'หลอดชานอ้อย',outline:'H2 ขนาดที่เหมาะสม',template:'ภาษากระชับ'});
 const prompt=buildArticlePrompt(brief);assert.match(prompt,/H2 ขนาดที่เหมาะสม/);assert.match(prompt,/ห้ามอ้างว่าได้ค้น Google/);
 assert.throws(()=>parseArticle('not JSON'));assert.throws(()=>briefInput({template:'x'.repeat(12001)}));
 const a=parseArticle(JSON.stringify({title:'ทดสอบ',metaDescription:'สรุป',content:'<p>'+ 'เนื้อหา '.repeat(30)+'</p>',coverPrompt:'แก้วกาแฟ'}));assert.equal(a.title,'ทดสอบ');assert.equal(a.coverPrompt,'แก้วกาแฟ');
});
test('brand overlay is burned into both cover and inline raster pixels',async()=>{
 const base=await sharp({create:{width:1600,height:1200,channels:3,background:'#ff0000'}}).png().toBuffer();
 for(const [kind,height] of [['cover',900],['inline',1200]]){
  const result=await brandImage(base,kind);const meta=await sharp(result).metadata();assert.equal(meta.width,1600);assert.equal(meta.height,height);assert.equal(meta.format,'webp');
  const {data}=await sharp(result).extract({left:kind==='cover'?64:1220,top:kind==='cover'?70:height-100,width:280,height:70}).raw().toBuffer({resolveWithObject:true});
  assert.ok(data.some((v,i)=>i%3===1&&v>150),'cream logo panel is embedded');
  assert.ok(data.some((v,i)=>i%3===0&&v<80),'dark wordmark pixels are embedded');
 }
 await assert.rejects(()=>brandImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"></svg>'),'cover'));
 await assert.rejects(()=>cleanLogo('data:image/svg+xml;base64,PHN2Zz4='));
});
test('OpenRouter adapters validate live models, parse article JSON and brand generated images',async()=>{
 const source=await sharp({create:{width:500,height:500,channels:3,background:'blue'}}).png().toBuffer();let posts=0;
 globalThis.fetch=async(url,options)=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/images/models'))return Response.json({data:[{id:'test/image',architecture:{output_modalities:['image']}}]});
  if(path.endsWith('/models'))return Response.json({data:[{id:'test/text',architecture:{output_modalities:['text']}}]});
  assert.equal(options.headers.Authorization,'Bearer test-key');posts++;
  if(path.endsWith('/images'))return Response.json({data:[{b64_json:source.toString('base64')}]});
  const request=JSON.parse(options.body);assert.match(request.messages[0].content,/9000 ตัวอักษร/);assert.equal(request.max_tokens,13700);
  return Response.json({choices:[{message:{content:JSON.stringify({title:'บทความ',metaDescription:'สรุป',content:'<p>'+'เนื้อหา '.repeat(30)+'</p>'})}}]});
 };
 const cfg={apiKey:'test-key',textModel:'test/text',imageModel:'test/image'};
 assert.equal((await generateArticle(cfg,{keyword:'test',targetChars:'9000'})).title,'บทความ');
 const image=await generateImage(cfg,'หลอดชานอ้อย','cover',{brief:{keyword:'หลอดชานอ้อย'}});assert.equal((await sharp(image.image).metadata()).width,1600);
 assert.equal(posts,2);
 globalThis.fetch=async()=>new Response('{"error":{"message":"private-token"}}',{status:401});
 await assert.rejects(()=>routerRequest('/key','test-key'),e=>!e.message.includes('private-token')&&e.message.includes('API Key'));
});
test('cover uses Thai headline and graphic composition while inline stays photographic',()=>{
 const draft={brief:{keyword:'เมล็ดกาแฟ',coverTitle:'เลือกเมล็ดกาแฟ',coverSubtitle:'ให้ตรงรสชาติที่ชอบ',coverHighlights:'สายพันธุ์\nระดับคั่ว\nวิธีชง'}};
 const cover=buildImagePrompt('coffee','cover',draft);assert.match(cover,/finished Thai editorial cover graphic/);assert.match(cover,/เลือกเมล็ดกาแฟ/);assert.match(cover,/ระดับคั่ว/);assert.match(cover,/upper-left rectangle/);
 const inline=buildImagePrompt('coffee','inline',draft);assert.match(inline,/No text/);assert.doesNotMatch(inline,/เลือกเมล็ดกาแฟ/);
 const saved=briefInput(draft.brief);assert.equal(saved.coverTitle,draft.brief.coverTitle);assert.equal(saved.coverHighlights,draft.brief.coverHighlights);
});
test('writer page escapes titles and config; no secret is rendered',()=>{
 const page=writerUI([{id:'test',title:'<img onerror=alert(1)>',updated_at:new Date()}],{configured:true,apiKey:'private-token',template:'</script><script>alert(1)</script>',textModel:'test/text',imageModel:'test/image',dailyLimit:20});
 assert.doesNotMatch(page,/private-token/);
 assert.doesNotMatch(page,/<img onerror=/);assert.doesNotMatch(page,/<script>alert\(1\)/);
});
