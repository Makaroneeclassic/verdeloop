// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

/// หน้าที่ยังเป็น stub (ตั้ง noindex ไว้) ต้องไม่อยู่ใน sitemap
/// ไม่งั้นจะส่งสัญญาณขัดกันไปที่ Google — เอาออกทีละอันเมื่อเขียนเนื้อหาจริงเสร็จ
/// /thank-you/ ไม่ใช่ stub แต่ตั้ง noindex ถาวร (เป็นตัวนับ conversion ของ Google Ads)
const STUB_PAGES = ['/compare/', '/paper-straw-problem/', '/esg/', '/faq/', '/thank-you/'];

// เว็บเป็น static ล้วน — เร็วที่สุดและ Google เก็บ index ได้ครบ
// site ต้องตั้งไว้ ไม่งั้น sitemap.xml กับ canonical URL จะสร้างไม่ได้
export default defineConfig({
  site: 'https://verdeloopthailand.com',
  integrations: [
    sitemap({
      filter: (page) => !STUB_PAGES.some((s) => page.endsWith(s)),
    }),
  ],
  vite: { plugins: [tailwindcss()] },
});
