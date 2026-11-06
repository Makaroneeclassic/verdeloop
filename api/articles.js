import {get} from '@vercel/blob';
import {database,validUUID} from '../lib/core.js';
import {articleSlug,articlePath} from '../lib/publications.js';
import {esc} from '../lib/writer-content.js';
import {renderArticle,renderArticles,publicPage} from '../lib/articles-render.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Type','text/html; charset=utf-8');
 if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return res.status(405).send('Method not allowed');}
 const url=new URL(req.url,'https://verdeloopthailand.com'),q=url.searchParams;
 const image=q.get('image')||url.pathname.match(/^\/articles\/media\/([^/]+)\/?$/)?.[1];
 const sitemap=q.has('sitemap')||url.pathname==='/articles/sitemap.xml';
 const rawSlug=q.get('slug')||url.pathname.match(/^\/articles\/([^/]+)\/?$/)?.[1];
 const notFound=()=>{res.setHeader('X-Robots-Tag','noindex');return res.status(404).send(publicPage({title:'ไม่พบบทความ',body:'<h1>ไม่พบบทความ</h1><a href="/articles/">กลับไปหน้าบทความ</a>',noindex:true}));};
 try{
  const sql=database();if(!sql)throw Error('database_unavailable');
  if(image){
   if(!validUUID(image))return notFound();
   const [im]=await sql`SELECT i.pathname FROM article_images i WHERE i.id=${image} AND EXISTS(SELECT 1 FROM article_publications p WHERE p.published=true AND p.media_ids @> ${JSON.stringify([image])}::jsonb)`;
   if(!im)return notFound();const file=await get(im.pathname,{access:'private',useCache:false});if(!file||file.statusCode!==200)throw Error('image_unavailable');
   res.setHeader('Content-Type','image/webp');return res.status(200).send(req.method==='HEAD'?'':Buffer.from(await new Response(file.stream).arrayBuffer()));
  }
  if(sitemap){const rows=await sql`SELECT slug,updated_at FROM article_publications WHERE published=true ORDER BY published_at DESC LIMIT 45000`;
   res.setHeader('Content-Type','application/xml; charset=utf-8');return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://verdeloopthailand.com/articles/</loc></url>'+rows.map(r=>`<url><loc>https://verdeloopthailand.com${esc(articlePath(r.slug))}</loc><lastmod>${new Date(r.updated_at).toISOString()}</lastmod></url>`).join('')+'</urlset>');
  }
  if(rawSlug){let slug;try{slug=articleSlug(decodeURIComponent(rawSlug));}catch{return notFound();}
   const [row]=await sql`SELECT slug,snapshot,published_at,updated_at FROM article_publications WHERE slug=${slug} AND published=true`;
   if(!row)return notFound();return res.status(200).send(renderArticle(row));
  }
  const page=Math.min(10000,Math.max(1,Number.parseInt(q.get('page')||'1',10)||1));
  const rows=await sql`SELECT slug,snapshot,published_at FROM article_publications WHERE published=true ORDER BY published_at DESC,draft_id LIMIT 13 OFFSET ${(page-1)*12}`;
  return res.status(200).send(renderArticles(rows.slice(0,12),page,rows.length>12));
 }catch{res.setHeader('X-Robots-Tag','noindex');return res.status(503).send('กำลังโหลดบทความ กรุณาลองใหม่อีกครั้ง');}
}
