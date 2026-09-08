/// ถ่ายภาพหน้าเว็บที่ความกว้างมือถือจริง ผ่าน Chrome DevTools Protocol
///
/// ทำไมไม่ใช้ --window-size: Chrome บนเครื่องนี้ไม่สนใจ flag นั้นในโหมด headless
/// (สั่ง 390 แล้วได้ innerWidth 500 บ้าง 756 บ้าง) ภาพที่ได้จึงเป็นการ "ครอป" หน้าจอกว้าง
/// ไม่ใช่การจัดหน้าใหม่ที่ความกว้างมือถือ ซึ่งทำให้อ่านผลผิดว่าเว็บพัง ทั้งที่จริงแค่ภาพถูกครอป
/// Emulation.setDeviceMetricsOverride เป็นตัวเดียวที่บังคับความกว้าง layout ได้จริง
///
/// ใช้: node scripts/shot.mjs <baseUrl> <outDir> <width> <path...>
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [base, outDir, widthArg, ...paths] = process.argv.slice(2);
const width = Number(widthArg) || 390;
mkdirSync(outDir, { recursive: true });

const port = 9222 + (process.pid % 500);
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  '--disable-gpu',
  '--no-first-run',
  '--user-data-dir=/tmp/cdp-profile-' + port,
]);

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
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener('message', onMsg);
      m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result);
    };
    ws.addEventListener('message', onMsg);
    setTimeout(() => reject(new Error('timeout: ' + method)), 30000);
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
  /// mobile:true + deviceScaleFactor 2 = จำลองจอมือถือจริง ไม่ใช่หน้าต่างเดสก์ท็อปแคบ ๆ
  await S('Emulation.setDeviceMetricsOverride', {
    width,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });

  await S('Page.navigate', { url: base + path });
  await sleep(1800); // รอฟอนต์ไทยจาก Google Fonts โหลดเสร็จ ไม่งั้นวัดความสูงผิด

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
      return JSON.stringify({ over, W, sw: de.scrollWidth, h: de.scrollHeight, bad });
    })()`,
    returnByValue: true,
  });
  const info = JSON.parse(result.value);
  report.push({ path, ...info });

  const name = (path.replace(/\//g, '_') || 'home').replace(/^_|_$/g, '') || 'home';
  const { data } = await S('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height: Math.min(info.h, 6000), scale: 1 },
  });
  writeFileSync(`${outDir}/${name}.png`, Buffer.from(data, 'base64'));
}

console.log(JSON.stringify(report, null, 1));
ws.close();
chrome.kill();
