/// ถ่ายภาพหน้าเว็บที่ความกว้างมือถือจริง ผ่าน Chrome DevTools Protocol
///
/// ทำไมไม่ใช้ --window-size: Chrome บนเครื่องนี้ไม่สนใจ flag นั้นในโหมด headless
/// (สั่ง 390 แล้วได้ innerWidth 500 บ้าง 756 บ้าง) ภาพที่ได้จึงเป็นการ "ครอป" หน้าจอกว้าง
/// ไม่ใช่การจัดหน้าใหม่ที่ความกว้างมือถือ ซึ่งทำให้อ่านผลผิดว่าเว็บพัง ทั้งที่จริงแค่ภาพถูกครอป
/// Emulation.setDeviceMetricsOverride เป็นตัวเดียวที่บังคับความกว้าง layout ได้จริง
///
/// ใช้: node scripts/shot.mjs <baseUrl> <outDir> <width> <path...> [--check]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [base, outDir, widthArg, ...args] = process.argv.slice(2);
const check = args.includes('--check');
const paths = args.filter((arg) => arg !== '--check');
const width = Number(widthArg) || 390;
mkdirSync(outDir, { recursive: true });

const port = 9222 + (process.pid % 500);
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  '--disable-gpu',
  '--no-first-run',
  '--user-data-dir=' + mkdtempSync('/private/tmp/verdeloop-chrome-'),
], { stdio: 'ignore' });

/// รอให้ Chrome เปิดพอร์ต debug ก่อน ไม่งั้น fetch จะโดน ECONNREFUSED
async function waitForChrome() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome ไม่ยอมเปิดพอร์ต debug');
}

let msgId = 0;
function send(ws, method, params = {}, sessionId) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener('message', onMsg);
      reject(new Error('timeout: ' + method));
    }, 30000);
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      clearTimeout(timeout);
      ws.removeEventListener('message', onMsg);
      m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result);
    };
    ws.addEventListener('message', onMsg);
  });
}

const wsUrl = await waitForChrome();
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));

const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => send(ws, m, p, sessionId);

await S('Page.enable');
await S('Runtime.enable');

const report = [];
for (const path of paths) {
  /// จอเล็กจำลองมือถือ จอกว้างใช้ desktop viewport จริง
  await S('Emulation.setDeviceMetricsOverride', {
    width,
    height: 844,
    deviceScaleFactor: 1,
    mobile: width < 768,
  });

  await S('Page.navigate', { url: base + path });
  await sleep(700);
  // โหลด lazy images ก่อนถ่ายภาพเต็มหน้า มิฉะนั้นภาพนอก viewport จะเป็นช่องว่าง
  await S('Runtime.evaluate', {
    expression: `(async () => {
      const style = document.createElement('style');
      style.textContent = 'astro-dev-toolbar { display: none !important; }';
      document.head.append(style);
      [...document.images].forEach(img => img.loading = 'eager');
      await Promise.race([
        Promise.all([document.fonts.ready, ...[...document.images].map(img => img.decode().catch(() => {}))]),
        new Promise(r => setTimeout(r, 10000)),
      ]);
      window.scrollTo({ top: 0, behavior: 'instant' });
    })()`,
    awaitPromise: true,
  });

  /// วัดการล้นแนวนอน และหา element ต้นเหตุ (ตัวที่ล้นแต่แม่ไม่ล้น)
  const { result } = await S('Runtime.evaluate', {
    expression: `(() => {
      const de = document.documentElement;
      const W = de.clientWidth;
      const over = de.scrollWidth - W;
      const bad = [];
      if (over > 0) {
        const all = [...document.querySelectorAll('*')].filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > W + 1;
        });
        const set = new Set(all);
        all.filter(el => !set.has(el.parentElement)).slice(0, 10).forEach(el => {
          const r = el.getBoundingClientRect();
          bad.push(el.tagName.toLowerCase() + ' w=' + Math.round(r.width) +
            ' right=' + Math.round(r.right) + ' class="' + (el.getAttribute('class')||'').slice(0,80) + '"');
        });
      }
      return JSON.stringify({ over, W, sw: de.scrollWidth, h: de.scrollHeight, bad,
        title: document.title,
        brokenImages: [...document.images].filter(im => !im.naturalWidth).map(im => im.getAttribute('src')) });
    })()`,
    returnByValue: true,
  });
  const info = JSON.parse(result.value);
  if (check) {
    const checked = await S('Runtime.evaluate', {
      expression: `(() => {
        const checks = {};
        const menu = document.querySelector('[data-mobile-menu]');
        const summary = menu?.querySelector('summary');
        if (summary?.getBoundingClientRect().width) {
          summary.click();
          const nav = menu.querySelector('nav');
          const rect = nav.getBoundingClientRect();
          checks.menuFits = menu.open && rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
          document.querySelector('main').click();
          checks.outsideCloses = !menu.open;
          summary.click();
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          checks.escapeCloses = !menu.open && document.activeElement === summary;
          summary.blur();
        }
        const faq = document.querySelector('main details');
        if (faq) {
          faq.querySelector('summary').click();
          checks.faqOpens = faq.open && faq.querySelector('p').getBoundingClientRect().height > 0;
          faq.querySelector('summary').click();
          checks.faqCloses = !faq.open;
        }
        const form = document.querySelector('#form');
        if (form) {
          checks.formValidation = !form.checkValidity();
          form.elements.name.value = 'ทดสอบการจัดวาง';
          form.elements.phone.value = '0983539369';
          form.elements.consent.checked = true;
          checks.formReady = form.checkValidity() && form.getAttribute('action') === '/api/lead';
          form.reset();
        }
        const calc = document.querySelector('[data-calc]');
        if (calc) {
          const cups = calc.querySelector('#cups');
          const size = calc.querySelector('#size');
          const original = cups.value;
          const originalSize = size.value;
          size.value = '12';
          cups.value = '1000000';
          cups.dispatchEvent(new Event('input', { bubbles: true }));
          checks.calculatorLargeValue = document.documentElement.scrollWidth <= innerWidth;
          const number = calc.querySelector('[data-out="kg"]');
          checks.calculatorUpdates = Number(number.textContent.replaceAll(',', '')) === 3527160;
          cups.value = '-1';
          cups.dispatchEvent(new Event('input', { bubbles: true }));
          checks.calculatorNegative = number.textContent === '0';
          cups.value = original;
          size.value = originalSize;
          cups.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const tables = [...document.querySelectorAll('.table-scroll')];
        checks.tablesContained = tables.every(el => {
          if (el.scrollWidth <= el.clientWidth) return true;
          el.scrollLeft = el.scrollWidth;
          const ok = el.scrollLeft > 0 && document.documentElement.scrollWidth <= innerWidth;
          el.scrollLeft = 0;
          return ok;
        });
        return JSON.stringify(checks);
      })()`,
      returnByValue: true,
    });
    info.checks = JSON.parse(checked.result.value);
  }
  report.push({ path, ...info });

  const name = (path.replace(/\//g, '_') || 'home').replace(/^_|_$/g, '') || 'home';
  const { data } = await S('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height: info.h, scale: 1 },
  });
  writeFileSync(`${outDir}/${name}.png`, Buffer.from(data, 'base64'));
  const top = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`${outDir}/${name}-viewport.png`, Buffer.from(top.data, 'base64'));
}

console.log(JSON.stringify(report, null, 1));
writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
ws.close();
chrome.kill();
if (report.some(r => r.over > 0 || r.brokenImages.length || Object.values(r.checks ?? {}).some(v => !v))) {
  process.exitCode = 1;
}
