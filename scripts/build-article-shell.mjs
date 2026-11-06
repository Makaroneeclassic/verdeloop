import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
const source=new URL('../dist/article-shell-build/index.html',import.meta.url);
const html=readFileSync(source,'utf8')
 .replaceAll('https://verdeloopthailand.com/article-shell-build/','VERDELOOP_ARTICLE_CANONICAL_TOKEN')
 .replaceAll('https://verdeloopthailand.com/img/og/og-default.jpg','VERDELOOP_ARTICLE_IMAGE_TOKEN');
mkdirSync(new URL('../lib/generated/',import.meta.url),{recursive:true});
writeFileSync(new URL('../lib/generated/article-shell.html',import.meta.url),html);
rmSync(new URL('../dist/article-shell-build/',import.meta.url),{recursive:true});
