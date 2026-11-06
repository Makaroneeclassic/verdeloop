import {randomUUID} from 'node:crypto';
import {put,get,del} from '@vercel/blob';
import {validUUID,limit} from './core.js';
import {canManage} from './staff.js';
import {FormError} from './form-error.js';
import {readIntegration,saveIntegration} from './integrations.js';
import {articleInput,briefInput} from './writer-content.js';
import {models,modelId,routerRequest,cleanLogo,generateArticle,generateImage,researchKeyword} from './writer-ai.js';
import {publishArticle,articlePath} from './publications.js';
import {writerUI} from './writer-ui.js';

export const writerActions=['writer_settings','writer_check','writer_new','writer_save','writer_generate','writer_publish','writer_unpublish'];
const configFor=async sql=>{const c={...await readIntegration(sql,'writer')};return {...c,textModel:c.textModel||'openai/gpt-4.1-mini',imageModel:c.imageModel||'openai/gpt-image-2'};};
const uuid=id=>{if(!validUUID(id))throw new FormError('รหัสบทความไม่ถูกต้อง');return id;};
const safeConfig=c=>({configured:!!c.apiKey,textModel:c.textModel||'',imageModel:c.imageModel||'',dailyLimit:c.dailyLimit||20,template:c.template||'',customLogo:!!c.logo});
export async function writerGet(req,res,sql,page){
 if(new URL(req.url,'https://verdeloopthailand.com').searchParams.has('data'))res.setHeader('Content-Type','application/json; charset=utf-8');
 if(!canManage(req.actor))return res.status(403).send(page('เฉพาะผู้ดูแลที่ใช้เครื่องมือเขียนบทความได้'));
 const params=new URL(req.url,'https://verdeloopthailand.com').searchParams;
 try{
  if(params.has('image')){
   const [row]=await sql`SELECT pathname FROM article_images WHERE id=${uuid(params.get('image'))}`;
   if(!row)return res.status(404).send('ไม่พบภาพ');
   const file=await get(row.pathname,{access:'private',useCache:false});if(!file||file.statusCode!==200)throw Error('image_unavailable');
   res.setHeader('Content-Type','image/webp');if(params.has('download'))res.setHeader('Content-Disposition',`attachment; filename="verdeloop-${params.get('image')}.webp"`);
   return res.status(200).send(Buffer.from(await new Response(file.stream).arrayBuffer()));
  }
  if(params.has('logo')){const c=await configFor(sql);if(!c.logo)return res.redirect(303,'/img/verdeloop-wordmark.svg');res.setHeader('Content-Type','image/png');return res.status(200).send(Buffer.from(c.logo,'base64'));}
  const data=params.get('data');
  if(data==='models')return res.status(200).json({ok:true,...await models()});
  if(data==='job'){
   const [job]=await sql`SELECT id,kind,status,result,error,created_at FROM writer_jobs WHERE id=${uuid(params.get('id'))}`;
   if(!job)return res.status(404).json({ok:false,error:'ไม่พบงาน'});
   return res.status(200).json({ok:true,job});
  }
  if(data==='draft'){
   const id=uuid(params.get('id'));
   const [draft]=await sql`SELECT * FROM article_drafts WHERE id=${id}`;if(!draft)throw new FormError('ไม่พบฉบับร่าง');
   const images=await sql`SELECT id,kind,alt,prompt,created_at FROM article_images WHERE draft_id=${id} ORDER BY created_at DESC`;
   const revisions=await sql`SELECT id,version,created_at FROM article_revisions WHERE draft_id=${id} ORDER BY version DESC LIMIT 30`;
   const jobs=await sql`SELECT id,kind,status,created_at,result->>'type' AS operation FROM writer_jobs WHERE draft_id=${id} ORDER BY created_at DESC LIMIT 10`;
   const [research]=await sql`SELECT result FROM writer_jobs WHERE draft_id=${id} AND status='done' AND result->>'type'='research' AND result->>'keyword'=${draft.brief?.keyword||''} ORDER BY created_at DESC LIMIT 1`;
   const [publication]=await sql`SELECT slug,published,draft_version,published_at,updated_at,snapshot->'cover'->>'id' AS cover_id FROM article_publications WHERE draft_id=${id}`;
   return res.status(200).json({ok:true,draft,images,revisions,jobs,research:research?.result||null,publication:publication?{...publication,url:articlePath(publication.slug)}:null});
  }
  if(data==='revision'){
   const [row]=await sql`SELECT snapshot FROM article_revisions WHERE id=${uuid(params.get('id'))}`;if(!row)throw new FormError('ไม่พบประวัติ');
   return res.status(200).json({ok:true,draft:row.snapshot});
  }
  const drafts=await sql`SELECT id,title,updated_at FROM article_drafts ORDER BY updated_at DESC LIMIT 300`;
  const config=safeConfig(await configFor(sql));
  if(data==='list')return res.status(200).json({ok:true,drafts,config});
  return res.status(200).send(page(writerUI(drafts,config),true));
 }catch(error){if(params.has('data'))return res.status(400).json({ok:false,error:error.name==='FormError'?error.message:'ยังโหลดข้อมูลไม่ได้ กรุณาลองใหม่'});throw error;}
}
export async function writerPost(req,res,sql){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 if(!canManage(req.actor))return res.status(403).json({ok:false,error:'เฉพาะผู้ดูแลที่ใช้เครื่องมือเขียนบทความได้'});
 const b=req.body||{};
 try{
  if(b.action==='writer_settings'){
   const c=await configFor(sql);
   if(b.apiKey){if(typeof b.apiKey!=='string'||!/^sk-or-[\w-]{15,250}$/.test(b.apiKey.trim()))throw new FormError('รูปแบบ OpenRouter API Key ไม่ถูกต้อง');c.apiKey=b.apiKey.trim();}
   if(b.keyOnly===true||b.keyOnly==='true'){
    if(!b.apiKey)throw new FormError('กรุณาใส่ OpenRouter API Key ก่อนบันทึก');
    await saveIntegration(sql,'writer',c);
    if(req.headers?.accept?.includes('text/html'))return res.redirect(303,'/admin?view=writer&keySaved=1');
    return res.status(200).json({ok:true,config:safeConfig(c)});
   }
   c.textModel=modelId(b.textModel||c.textModel);c.imageModel=b.imageModel?modelId(b.imageModel):'';
   c.dailyLimit=Number(b.dailyLimit);if(!Number.isInteger(c.dailyLimit)||c.dailyLimit<1||c.dailyLimit>100)throw new FormError('กำหนดจำนวนสร้างต่อวัน 1–100 ครั้ง');
   c.template=briefInput({template:b.template}).template;
   if(b.resetLogo)c.logo=null;else if(b.logo)c.logo=await cleanLogo(b.logo);
   await saveIntegration(sql,'writer',c);return res.status(200).json({ok:true,config:safeConfig(c)});
  }
  if(b.action==='writer_check'){
   const c=await configFor(sql);if(!c.apiKey)throw new FormError('บันทึก API Key ก่อน');
   await routerRequest('/key',c.apiKey);return res.status(200).json({ok:true,message:'เชื่อมต่อ OpenRouter ได้แล้ว'});
  }
  if(b.action==='writer_new'){
   const id=uuid(b.id);const c=await configFor(sql);
   await sql`INSERT INTO article_drafts(id,brief) VALUES(${id},${JSON.stringify({template:c.template||''})}::jsonb) ON CONFLICT(id) DO NOTHING`;
   return res.status(200).json({ok:true,id});
  }
  if(b.action==='writer_save'){
   const id=uuid(b.id),version=Number(b.version),a=articleInput(b);
   if(!Number.isSafeInteger(version)||version<1)throw new FormError('เวอร์ชันไม่ถูกต้อง');
   const rows=await sql`WITH old AS (SELECT * FROM article_drafts WHERE id=${id} AND version=${version} FOR UPDATE), changed AS (UPDATE article_drafts d SET title=${a.title},description=${a.description},content=${a.content},brief=${JSON.stringify(a.brief)}::jsonb,version=d.version+1,updated_at=now() FROM old WHERE d.id=old.id RETURNING d.*), revision AS (INSERT INTO article_revisions(id,draft_id,version,snapshot) SELECT ${randomUUID()},old.id,old.version,to_jsonb(old) FROM old WHERE EXISTS(SELECT 1 FROM changed)) SELECT * FROM changed`;
   if(!rows.length)return res.status(409).json({ok:false,error:'ฉบับร่างถูกแก้ไขจากอีกหน้าต่างแล้ว กรุณาคัดลอกข้อความของคุณก่อนโหลดใหม่'});
   return res.status(200).json({ok:true,draft:rows[0]});
  }
  if(b.action==='writer_publish')return res.status(200).json({ok:true,publication:await publishArticle(sql,b)});
  if(b.action==='writer_unpublish'){
   const id=uuid(b.id);await sql`UPDATE article_publications SET published=false,updated_at=now() WHERE draft_id=${id}`;return res.status(200).json({ok:true});
  }
  if(b.action==='writer_generate')return await generate(req,res,sql,b);
  throw new FormError('ไม่รองรับรายการนี้');
 }catch(error){return res.status(400).json({ok:false,error:error.name==='FormError'?error.message:'ดำเนินการไม่สำเร็จ ข้อมูลเดิมยังอยู่ กรุณาลองใหม่'});}
}
async function generate(req,res,sql,b){
 const id=uuid(b.id),jobId=uuid(b.jobId),kind=b.kind,researching=b.mode==='research';
 if(researching&&kind!=='article')throw new FormError('ประเภทวิเคราะห์ไม่ถูกต้อง');
 if(!['article','cover','inline'].includes(kind))throw new FormError('ประเภทงานไม่ถูกต้อง');
 const [previous]=await sql`SELECT id,status,result,error FROM writer_jobs WHERE id=${jobId}`;
 if(previous)return res.status(200).json({ok:true,job:previous});
 const [draft]=await sql`SELECT * FROM article_drafts WHERE id=${id}`;if(!draft)throw new FormError('บันทึกฉบับร่างก่อน');
 const c=await configFor(sql);if(!c.apiKey)throw new FormError('ตั้งค่า OpenRouter API Key ก่อนสร้าง');
 if(kind!=='article'&&!process.env.BLOB_READ_WRITE_TOKEN)throw new FormError('ยังไม่ได้ตั้งค่าคลังภาพ');
 const prompt=String(b.prompt||'').trim();if(kind!=='article'&&(!prompt||prompt.length>2000))throw new FormError('กรอกคำบรรยายภาพไม่เกิน 2,000 ตัวอักษร');
 if(kind==='article'&&!draft.brief?.keyword)throw new FormError('กรอกคำค้นหลักก่อน');
 const rate=await limit(sql,req,'writer-ai',6,300);if(!rate.allowed)return res.status(429).json({ok:false,error:'สร้างถี่เกินไป กรุณารอสักครู่'});
 await sql`UPDATE writer_jobs SET status='failed',error='งานหมดเวลารอ กรุณาตรวจประวัติก่อนสร้างใหม่',updated_at=now() WHERE status='running' AND created_at<now()-interval '5 minutes'`;
 const created=await sql`INSERT INTO writer_jobs(id,draft_id,actor,kind,status) SELECT ${jobId},${id},${req.actor.username},${kind},'running' WHERE (SELECT count(*) FROM writer_jobs WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')<${c.dailyLimit||20} ON CONFLICT DO NOTHING RETURNING id`;
 if(!created.length)throw new FormError('มีงานกำลังสร้าง หรือถึงจำนวนสร้างต่อวันแล้ว กรุณาตรวจสถานะงาน');
 try{
  let result;
  if(researching)result=await researchKeyword(c,draft.brief);
  else if(kind==='article'){
   const [analysis]=await sql`SELECT result FROM writer_jobs WHERE draft_id=${id} AND status='done' AND result->>'type'='research' AND result->>'keyword'=${draft.brief.keyword} ORDER BY created_at DESC LIMIT 1`;
   result=await generateArticle(c,draft.brief,analysis?.result||null);
  }
  else{
   const {image,usage}=await generateImage(c,prompt,kind,draft),imageId=randomUUID();
   const blob=await put('articles/'+imageId+'.webp',image,{access:'private',addRandomSuffix:false,contentType:'image/webp'});
   try{await sql`INSERT INTO article_images(id,draft_id,kind,pathname,size,prompt,alt) VALUES(${imageId},${id},${kind},${blob.pathname},${image.length},${prompt},${prompt.slice(0,300)})`;}catch(error){await del(blob.pathname).catch(()=>{});throw error;}
   result={imageId,kind,usage};
  }
  await sql`UPDATE writer_jobs SET status='done',result=${JSON.stringify(result)}::jsonb,updated_at=now() WHERE id=${jobId}`;
  return res.status(200).json({ok:true,job:{id:jobId,status:'done',kind,result}});
 }catch(error){
  const message=error.name==='FormError'?error.message:'สร้างไม่สำเร็จหรือหมดเวลา กรุณาตรวจเครดิตและประวัติก่อนลองใหม่';
  await sql`UPDATE writer_jobs SET status='failed',error=${message},updated_at=now() WHERE id=${jobId}`;
  return res.status(400).json({ok:false,error:message,jobId});
 }
}
