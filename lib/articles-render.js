import {readFileSync} from 'node:fs';
import {esc,cleanContent} from './writer-content.js';
import {articlePath} from './publications.js';
const SITE='https://verdeloopthailand.com';
export const mediaPath=id=>'/articles/media/'+id+'/';
const day=value=>new Date(value).toLocaleDateString('th-TH',{year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Bangkok'});
let shell;
export function publicPage({title,description='',path='/articles/',image='/img/og/og-default.jpg',body='',schema,noindex=false},template){
 const tokens={VERDELOOP_ARTICLE_TITLE_TOKEN:esc(title),VERDELOOP_ARTICLE_DESCRIPTION_TOKEN:esc(description),VERDELOOP_ARTICLE_CANONICAL_TOKEN:esc(SITE+path),VERDELOOP_ARTICLE_IMAGE_TOKEN:esc(SITE+image),VERDELOOP_ARTICLE_BODY_TOKEN:body};
 const base=template||(shell??=readFileSync(new URL('./generated/article-shell.html',import.meta.url),'utf8'));
 return base.replace(/VERDELOOP_ARTICLE_[A-Z_]+_TOKEN/g,k=>tokens[k]??k).replace('</head>',`${noindex?'<meta name="robots" content="noindex,follow">':''}${schema?'<script type="application/ld+json">'+JSON.stringify(schema).replaceAll('<','\\u003c')+'</script>':''}</head>`);
}
export function renderArticle(row){
 const s=row.snapshot,path=articlePath(row.slug),image=s.cover?mediaPath(s.cover.id):'/img/og/og-default.jpg';
 const body=`<nav class="article-breadcrumb"><a href="/">หน้าแรก</a> / <a href="/articles/">บทความ</a></nav><article><header><h1>${esc(s.title)}</h1><p class="article-intro">${esc(s.description)}</p><p class="article-date">โดย Verdeloop Thailand · เผยแพร่ ${esc(day(row.published_at))} · อัปเดต ${esc(day(row.updated_at))}</p></header>${s.cover?`<img class="article-cover" src="${esc(image)}" alt="${esc(s.cover.alt)}" width="1600" height="900" fetchpriority="high">`:''}<div class="article-body">${cleanContent(s.content,true)}</div><p class="article-line"><a href="/line/?placement=article_end" target="_blank" rel="noopener noreferrer" data-track="line" data-placement="article_end" class="line-button"><img src="/img/line-brand.png" width="40" height="40" alt="" aria-hidden="true" class="line-button-icon" /><span>สอบถามทีมงานทาง LINE @verdeloop</span></a></p></article>`;
 return publicPage({title:s.title,description:s.description,path,image,body,schema:{'@context':'https://schema.org','@type':'BlogPosting',headline:s.title,description:s.description,url:SITE+path,mainEntityOfPage:SITE+path,datePublished:new Date(row.published_at).toISOString(),dateModified:new Date(row.updated_at).toISOString(),author:{'@type':'Organization',name:'Verdeloop Thailand',url:SITE},publisher:{'@type':'Organization',name:'Verdeloop Thailand',url:SITE},image:SITE+image}});
}
export function renderArticles(rows,page,more){
 const cards=rows.map(r=>{const s=r.snapshot,path=articlePath(r.slug);return `<article class="article-card">${s.cover?`<a href="${path}" tabindex="-1" aria-hidden="true"><img src="${mediaPath(s.cover.id)}" alt="" width="1600" height="900" loading="lazy"></a>`:''}<div class="article-card-body"><h2><a href="${path}">${esc(s.title)}</a></h2><p>${esc(s.description)}</p><div class="article-date">${esc(day(r.published_at))}</div><a href="${path}">อ่านบทความ →</a></div></article>`;}).join('');
 return publicPage({title:'บทความ',description:'ความรู้และแนวทางเลือกใช้สำหรับร้านเครื่องดื่ม จาก Verdeloop Thailand',path:'/articles/'+(page>1?'?page='+page:''),body:`<nav class="article-breadcrumb"><a href="/">หน้าแรก</a> / บทความ</nav><h1>บทความและความรู้</h1><p class="article-intro">อ่านและเลือกแนวทางที่เหมาะกับการใช้งานของคุณ</p><div class="article-grid">${cards||'<p>กำลังเตรียมบทความใหม่</p>'}</div><nav class="article-pages">${page>1?`<a href="/articles/${page===2?'':'?page='+(page-1)}">← หน้าก่อน</a>`:''}${more?`<a href="/articles/?page=${page+1}">หน้าถัดไป →</a>`:''}</nav>`});
}
