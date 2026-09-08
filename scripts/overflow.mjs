/// หาสาเหตุการล้นแนวนอนที่แท้จริง
///
/// บทเรียน: การไล่หา element ที่ขอบขวาเกินจอ แล้วเดาว่าตัวที่แม่ไม่ล้นคือต้นเหตุ — ผิด
/// ตารางที่อยู่ใน overflow-x-auto มีขอบขวาเกินจอเสมอ แต่ไม่ได้ทำให้เอกสารล้น (มันสกรอลในกล่องตัวเอง)
/// วิธีที่เชื่อถือได้คือ "ปิดทีละตัวแล้ววัดใหม่" — ถ้าซ่อนแล้ว scrollWidth ลดลง ตัวนั้นคือต้นเหตุจริง
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [base, path = '/', widthArg = '390'] = process.argv.slice(2);
const width = Number(widthArg);

const port = 9800 + (process.pid % 150);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, '--disable-gpu',
  '--no-first-run', '--user-data-dir=/tmp/cdp-of-' + port,
]);

async function wait() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return (await r.json()).webSocketDebuggerUrl; } catch {}
    await sleep(250);
  }
  throw new Error('no chrome');
}
let id = 0;
function send(ws, method, params = {}, sessionId) {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  return new Promise((res, rej) => {
    const h = (ev) => { const m = JSON.parse(ev.data); if (m.id !== i) return; ws.removeEventListener('message', h); m.error ? rej(new Error(m.error.message)) : res(m.result); };
    ws.addEventListener('message', h);
    setTimeout(() => rej(new Error('timeout ' + method)), 30000);
  });
}

const ws = new WebSocket(await wait());
await new Promise((r) => ws.addEventListener('open', r));
const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => send(ws, m, p, sessionId);

await S('Page.enable'); await S('Runtime.enable');
await S('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 2, mobile: true });
await S('Page.navigate', { url: base + path });
await sleep(2000);

const { result } = await S('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const de = document.documentElement;
    const before = de.scrollWidth;
    if (before <= de.clientWidth) return JSON.stringify({ ok: true, before });

    const hits = [];
    /// ปิดทีละตัวแล้ววัดซ้ำ — ตัวที่ทำให้ scrollWidth ลดลงคือต้นเหตุจริง
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= de.clientWidth + 1) continue;
      const prev = el.style.display;
      el.style.display = 'none';
      const after = de.scrollWidth;
      el.style.display = prev;
      if (after < before) {
        hits.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.getAttribute('class') || '').slice(0, 110),
          w: Math.round(r.width),
          right: Math.round(r.right),
          drop: before - after,
          text: (el.textContent || '').trim().slice(0, 50),
          /// ไล่ดูว่ามีบรรพบุรุษที่สกรอลแนวนอนได้ไหม ถ้าไม่มี = ล้นออกนอกเอกสารจริง
          scrollParent: (() => {
            let p = el.parentElement;
            while (p && p !== document.body) {
              const ox = getComputedStyle(p).overflowX;
              if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return p.tagName.toLowerCase() + '.' + (p.getAttribute('class')||'').split(' ')[0];
              p = p.parentElement;
            }
            return null;
          })(),
        });
      }
    }
    /// เรียงจากตัวที่ลดมากสุด และตัดตัวที่เป็นลูกของตัวอื่นในลิสต์ออก
    hits.sort((a,b) => b.drop - a.drop);
    return JSON.stringify({ ok: false, before, client: de.clientWidth, hits: hits.slice(0, 8) });
  })()`,
});
console.log(JSON.stringify(JSON.parse(result.value), null, 1));
ws.close(); chrome.kill();
