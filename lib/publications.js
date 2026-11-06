import {FormError} from './form-error.js';
import {cleanContent,relatedInput} from './writer-content.js';
import {validUUID} from './core.js';

export function articleSlug(value){
 if(typeof value!=='string')throw new FormError('กรอก URL บทความ');
 const slug=value.trim().normalize('NFC').toLowerCase();
 if(slug.length>120||! /^[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}-]*[\p{L}\p{M}\p{N}])?$/u.test(slug)||['media','sitemap'].includes(slug))throw new FormError('URL ใช้ตัวอักษร ตัวเลข และขีดกลาง ไม่เกิน 120 ตัวอักษร');
 return slug;
}
export const articlePath=slug=>'/articles/'+encodeURIComponent(slug)+'/';
export function publicationSnapshot(draft,images,coverId,related=[]){
 if(!draft.title?.trim()||!draft.description?.trim())throw new FormError('กรอกชื่อบทความและคำอธิบาย SEO ก่อนเผยแพร่');
 let content=cleanContent(draft.content);
 if(content.replace(/<[^>]*>/g,'').trim().length<100)throw new FormError('ใส่เนื้อหาบทความอย่างน้อย 100 ตัวอักษรก่อนเผยแพร่');
 const ids=new Set();
 content=content.replace(/src="\/admin\?view=writer(?:&amp;|&)image=([0-9a-f-]{36})"/g,(_,id)=>{ids.add(id);return `src="/articles/media/${id}/"`;});
 const cover=coverId?images.find(i=>i.id===coverId):null;
 if(coverId&&!cover)throw new FormError('ภาพปกไม่อยู่ในบทความนี้');
 if(cover)ids.add(cover.id);
 for(const id of ids)if(!images.some(i=>i.id===id))throw new FormError('ภาพประกอบต้องเป็นภาพของบทความนี้');
 const faq=Array.isArray(draft.faq)?draft.faq.filter(f=>f&&String(f.q||'').trim()&&String(f.a||'').trim()).slice(0,8).map(f=>({q:String(f.q).trim().slice(0,300),a:String(f.a).trim().slice(0,1000)})):[];
 return {snapshot:{title:draft.title.trim(),description:draft.description.trim(),seoTitle:String(draft.seo_title||'').trim().slice(0,120),content,cover:cover?{id:cover.id,alt:cover.alt||draft.title}:null,faq,related},mediaIds:[...ids]};
}
export async function publishArticle(sql,body){
 if(!validUUID(body.id)||!Number.isSafeInteger(Number(body.version)))throw new FormError('ข้อมูลฉบับร่างไม่ถูกต้อง');
 const slug=articleSlug(body.slug);
 const [draft]=await sql`SELECT * FROM article_drafts WHERE id=${body.id}`;
 if(!draft||draft.version!==Number(body.version))throw new FormError('ฉบับร่างเปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนเผยแพร่');
 const [existing]=await sql`SELECT slug FROM article_publications WHERE draft_id=${body.id}`;
 if(existing&&existing.slug!==slug)throw new FormError('บทความนี้มี URL แล้ว กรุณาใช้ URL เดิมเพื่อรักษาลิงก์');
 const images=await sql`SELECT id,alt FROM article_images WHERE draft_id=${body.id}`;
 // related ต้องเป็นบทความที่เผยแพร่จริงเท่านั้น และไม่ชี้ตัวเอง
 const wanted=relatedInput(body.relatedSlugs).filter(s=>s!==slug);
 let related=[];
 if(wanted.length){
  const rows=await sql`SELECT slug FROM article_publications WHERE published=true AND slug IN (SELECT jsonb_array_elements_text(${JSON.stringify(wanted)}::jsonb))`;
  related=rows.map(r=>r.slug);
 }
 const {snapshot,mediaIds}=publicationSnapshot(draft,images,body.coverId||null,related);
 try{
  const rows=await sql`WITH source AS (SELECT id,version FROM article_drafts WHERE id=${body.id} AND version=${Number(body.version)} FOR UPDATE)
   INSERT INTO article_publications(draft_id,slug,snapshot,media_ids,draft_version)
   SELECT id,${slug},${JSON.stringify(snapshot)}::jsonb,${JSON.stringify(mediaIds)}::jsonb,version FROM source
   ON CONFLICT(draft_id) DO UPDATE SET snapshot=excluded.snapshot,media_ids=excluded.media_ids,draft_version=excluded.draft_version,published=true,updated_at=now()
   WHERE article_publications.slug=excluded.slug RETURNING slug,published,draft_version,published_at,updated_at`;
  if(!rows.length)throw new FormError('ฉบับร่างหรือ URL เปลี่ยนแล้ว กรุณาโหลดใหม่');
  return {...rows[0],url:articlePath(rows[0].slug)};
 }catch(e){if(e.code==='23505')throw new FormError('URL นี้มีบทความใช้แล้ว กรุณาเลือก URL อื่น');throw e;}
}
