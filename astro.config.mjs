// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// หน้าขอบคุณหลังส่งฟอร์มตั้ง noindex จึงไม่รวมใน sitemap
const NOINDEX_PAGES = ['/thank-you/', '/article-shell-build/', '/line/'];

// เว็บเป็น static ล้วน — เร็วที่สุดและ Google เก็บ index ได้ครบ
// site ต้องตั้งไว้ ไม่งั้น sitemap.xml กับ canonical URL จะสร้างไม่ได้
export default defineConfig({
  site: 'https://verdeloopthailand.com',
  integrations: [
    sitemap({
      customSitemaps: ['https://verdeloopthailand.com/articles/sitemap.xml'],
      filter: (page) => !NOINDEX_PAGES.some((s) => page.endsWith(s)) && !page.includes("/documents/specs/"),
    }),
  ],
  vite: { plugins: [tailwindcss()] },
});
