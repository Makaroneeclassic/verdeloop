import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {articleSlug,publicationSnapshot,publishArticle} from '../lib/publications.js';
import {publicPage} from '../lib/articles-render.js';
test('publication validates URLs, strips unsafe content and exposes only owned images',()=>{
 assert.equal(articleSlug('coffee-beans'),'coffee-beans');assert.equal(articleSlug('เมล็ดกาแฟ'),'เมล็ดกาแฟ');
 for(const s of ['../admin','media','x?y','<script>'])assert.throws(()=>articleSlug(s));
 const id=randomUUID(),draft={title:'หัวข้อ',description:'คำอธิบาย',content:'<p>'+'เนื้อหาบทความ '.repeat(20)+'</p><script>bad()</script><img src="/admin?view=writer&image='+id+'">'};
 assert.throws(()=>publicationSnapshot(draft,[],null),/ภาพประกอบ/);
 const r=publicationSnapshot(draft,[{id,alt:'ภาพ'}],id);assert.doesNotMatch(r.snapshot.content,/script|\/admin/);assert.match(r.snapshot.content,/\/articles\/media\//);assert.deepEqual(r.mediaIds,[id]);
 assert.throws(()=>publicationSnapshot({...draft,title:''},[],null),/ชื่อบทความ/);
});
test('public shell escapes metadata and does not re-expand tokens from user content',()=>{
 const html=publicPage({title:'<script>VERDELOOP_ARTICLE_BODY_TOKEN',body:'<h1>Content</h1>',schema:{headline:'</script><img src=x>'}},'<title>VERDELOOP_ARTICLE_TITLE_TOKEN</title></head>VERDELOOP_ARTICLE_BODY_TOKEN');
 assert.match(html,/&lt;script&gt;VERDELOOP_ARTICLE_BODY_TOKEN/);assert.doesNotMatch(html,/<img src=x>/);
});
const schema=process.env.PUBLICATION_TEST_SCHEMA;
test('publishing keeps a snapshot, protects draft version/slug, and unpublishing hides it',{skip:!schema},async()=>{
 assert.match(schema,/^publication_test_\d+$/);const raw=neon(process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL);
 const sql=(strings,...values)=>raw.transaction([raw.query('SET LOCAL search_path TO '+schema),raw(strings,...values)]).then(r=>r[1]);
 const id=randomUUID(),other=randomUUID(),image=randomUUID();const content='<p>'+'ข้อมูลบทความ '.repeat(25)+'</p>';
 await sql`INSERT INTO article_drafts(id,title,description,content) VALUES(${id},'Original title','Description',${content}),(${other},'Other title','Description',${content})`;
 await sql`INSERT INTO article_images(id,draft_id,kind,pathname,size,prompt) VALUES(${image},${id},'cover',${'articles/'+image+'.webp'},100,'Test image')`;
 let p=await publishArticle(sql,{id,version:1,slug:'coffee-guide',coverId:image});assert.equal(p.published,true);
 await sql`UPDATE article_drafts SET title='Changed draft',version=2 WHERE id=${id}`;
 let [live]=await sql`SELECT snapshot FROM article_publications WHERE published=true AND draft_id=${id}`;assert.equal(live.snapshot.title,'Original title');
 await assert.rejects(()=>publishArticle(sql,{id,version:1,slug:'coffee-guide'}),/เปลี่ยนแล้ว/);
 await assert.rejects(()=>publishArticle(sql,{id,version:2,slug:'different'}),/URL เดิม/);
 await assert.rejects(()=>publishArticle(sql,{id:other,version:1,slug:'coffee-guide'}),/ใช้แล้ว/);
 p=await publishArticle(sql,{id,version:2,slug:'coffee-guide',coverId:image});assert.equal(p.draft_version,2);
 [live]=await sql`SELECT snapshot FROM article_publications WHERE published=true AND draft_id=${id}`;assert.equal(live.snapshot.title,'Changed draft');
 const accessible=await sql`SELECT id FROM article_images WHERE id=${image} AND EXISTS(SELECT 1 FROM article_publications WHERE published=true AND media_ids @> ${JSON.stringify([image])}::jsonb)`;assert.equal(accessible.length,1);
 await sql`UPDATE article_publications SET published=false WHERE draft_id=${id}`;
 assert.equal((await sql`SELECT slug FROM article_publications WHERE published=true`).length,0);
 const hidden=await sql`SELECT id FROM article_images WHERE id=${image} AND EXISTS(SELECT 1 FROM article_publications WHERE published=true AND media_ids @> ${JSON.stringify([image])}::jsonb)`;assert.equal(hidden.length,0);
});
