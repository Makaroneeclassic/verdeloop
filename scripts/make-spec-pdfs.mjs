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
  for (let i = 0; i < 160; i++) {
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

try {
 for(const slug of (paths.length?paths:['catalog','straw-6mm','straw-8mm','straw-12mm'])) {
  const navigation=await S('Page.navigate',{url:base+'/documents/specs/'+slug+'/'});if(navigation.errorText)throw new Error(navigation.errorText);await sleep(1000);
  const loaded=await S('Runtime.evaluate',{expression:`(async()=>{await Promise.race([Promise.all([document.fonts.ready,...[...document.images].map(i=>i.decode().catch(()=>{}))]),new Promise(r=>setTimeout(r,8000))]);return {products:document.querySelectorAll('.product').length,title:document.title};})()`,awaitPromise:true,returnByValue:true});
  if(!loaded.result?.value?.products)throw new Error('Spec content missing');
  const pdf=await S('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,scale:slug==='catalog'?0.85:1});
  writeFileSync(outDir+'/verdeloop-'+slug+'.pdf',Buffer.from(pdf.data,'base64'));
  console.log('Generated PDF:',slug);
 }
}finally{ws.close();chrome.kill();}
