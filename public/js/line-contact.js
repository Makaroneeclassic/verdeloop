(() => {
 const status=document.getElementById('line-status');if(!status)return;
 const direct='https://line.me/R/ti/p/@verdeloop',query=new URLSearchParams(location.search);
 const debug=query.get('debug')==='1'&&!query.has('result');
 const destination=v=>/^AW-\d{5,20}\/[A-Za-z0-9_-]{5,100}$/.test(v||'');
 const stored={get:k=>{try{return sessionStorage.getItem(k)}catch{return null}},set:(k,v)=>{try{sessionStorage.setItem(k,v)}catch{}}};
 const prefs=()=>{try{const p=JSON.parse(localStorage.getItem('verdeloop-consent-v2'));return p?.version===2?p:{}}catch{return {}}};
 async function conversion(to,id){
  if(!prefs().ads)return 'consent';
  if(!destination(to))return 'destination';
  if(typeof window.gtag!=='function')return 'tag';
  return new Promise(resolve=>{const t=setTimeout(()=>resolve('timeout'),1500);try{window.gtag('event','conversion',{send_to:to,transaction_id:id,event_callback:()=>{clearTimeout(t);resolve('callback')},event_timeout:1400});}catch{clearTimeout(t);resolve('error');}});
 }
 const request=async(url,options)=>{const r=await fetch(url,{...options,signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('unavailable');return r.json();};
 async function run(){
  if(query.has('result')){
   // Never infer success from URL parameters. Only the server's verified cookie-bound result counts.
   history.replaceState(null,'',location.pathname+'?result=1');
   if(query.get('result')!=='1'){status.textContent='ยังยืนยันการเพิ่มเพื่อนไม่สำเร็จ กดปุ่มด้านล่างเพื่อคุยกับทีมงานได้เลย';return;}
   for(let attempt=0;attempt<8;attempt++){
    const data=await request('/api/line-login?result=1');
    if(data.conversionId){
     status.textContent='เพิ่มเพื่อนสำเร็จแล้ว กดเปิด LINE เพื่อส่งข้อความหาทีมงานได้เลย';
     const key='line-friend-'+data.conversionId;
     if(!stored.get(key)){
      const p=prefs();
      if(data.analytics&&p.analytics&&typeof window.gtag==='function'){
       const ga=document.getElementById('measurement-settings')?.dataset.ga;
       if(ga)window.gtag('event','line_add_friend',{send_to:ga,button_position:data.placement,source_page:data.path,page_location:location.origin+location.pathname,page_referrer:''});
      }
      if(data.ads&&p.ads)await conversion(data.friendDestination,data.conversionId);
      stored.set(key,'1');
     }
     return;
    }
    if(data.friend===false){status.textContent='กดเปิด LINE เพื่อเพิ่มเพื่อนและคุยกับทีมงานได้เลย';return;}
    status.textContent='เชื่อมต่อ LINE แล้ว กดเปิดแชตเพื่อคุยกับทีมงานได้เลย';
    if(attempt<7)await new Promise(resolve=>setTimeout(resolve,2000));
   }
   return;
  }
  let context={};try{context=JSON.parse(decodeURIComponent(location.hash.slice(1))||'{}')}catch{}
  history.replaceState(null,'',location.pathname+location.search);
  const p=prefs();
  if(debug&&!p.ads){status.textContent='เปิดการวัดผลโฆษณาที่ “ตั้งค่าการวัดผล” ก่อน แล้วกดทดสอบอีกครั้ง';return;}
  if(!p.analytics&&!p.ads){location.replace(direct);return;}
  const config=await request('/api/line-login');
  let clickId=stored.get('line-click-id');if(!clickId){clickId=crypto.randomUUID();stored.set('line-click-id',clickId);}
  if(!stored.get('line-click-sent')&&p.ads&&destination(config.clickDestination)){await conversion(config.clickDestination,clickId);stored.set('line-click-sent','1');}
  if(debug){status.textContent=destination(config.clickDestination)?'เรียกส่ง Conversion แล้ว กลับไปตรวจ Hits Sent ใน Tag Assistant เพื่อยืนยันผล':'ยังไม่ได้ตั้งรหัส Conversion คลิก LINE';return;}
  if(!config.enabled){location.replace(direct);return;}
  status.textContent='กำลังเชื่อมต่อ LINE เพื่อเพิ่มเพื่อน…';
  const data=await request('/api/line-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({analytics:p.analytics===true,ads:p.ads===true,attribution:context.attribution||{},path:query.get('from')||'/',placement:query.get('placement')||'unknown'})});
  const next=new URL(data.url);if(next.origin!=='https://access.line.me'&&data.url!==direct)throw Error('destination');
  location.replace(data.url);
 }
 // Measurement runs later in the document; let its deferred consent initialization finish first.
 const execute=()=>run().catch(()=>{status.textContent='ตรวจการเชื่อมต่อไม่สำเร็จ เปิด LINE ผ่านปุ่มด้านล่างเพื่อคุยกับทีมงานได้เลย';});
 const initialize=()=>{
  if(debug){
   status.textContent='โหมดทดสอบ: รอ Tag Assistant เชื่อมต่อ แล้วกดทดสอบหนึ่งครั้ง หน้านี้จะไม่เปลี่ยนไป LINE อัตโนมัติ';
   const button=document.getElementById('line-debug-test');
   // A prior normal visit must not silently suppress an explicit diagnostic test.
   let tested=false;const testId=crypto.randomUUID();
   const chat=document.getElementById('line-chat');if(chat)chat.hidden=true;
   if(button){button.hidden=false;button.disabled=false;button.addEventListener('click',async()=>{
    if(button.disabled)return;
    if(tested){status.textContent='ทดสอบไปแล้วในหน้านี้ ดูเหตุการณ์ conversion ใน Tag Assistant; หากต้องการทดสอบใหม่ให้รีเฟรชหน้านี้';return;}
    button.disabled=true;button.textContent='กำลังตรวจและส่ง…';status.textContent='กำลังตรวจการอนุญาตและรหัส Conversion…';
    try{
     if(!prefs().ads){status.textContent='ยังไม่ได้อนุญาตการวัดผลโฆษณา เปิด “ตั้งค่าการวัดผล” ด้านล่างเว็บ แล้วเลือกการวัดผลโฆษณาและบันทึก ก่อนกดทดสอบอีกครั้ง';return;}
     const config=await request('/api/line-login');
     const result=await conversion(config.clickDestination,testId);
     tested=result==='callback'||result==='timeout';
     status.textContent=result==='callback'?'เรียกส่ง Conversion และได้รับ callback แล้ว ตรวจ Hits Sent ใน Tag Assistant เพื่อยืนยันปลายทาง':result==='timeout'?'เรียกส่ง Conversion แล้ว แต่ยังไม่ได้รับ callback ภายในเวลาที่กำหนด ตรวจ Tag Assistant และส่วนขยายที่อาจบล็อก Google':result==='destination'?'ยังไม่ได้ตั้งรหัส Conversion คลิก LINE':result==='tag'?'Google tag ยังไม่พร้อม กรุณารีเฟรชและตรวจการอนุญาตการวัดผลโฆษณา':result==='consent'?'การวัดผลโฆษณาถูกปิด ยังไม่ได้ส่ง Conversion':'เรียกส่ง Conversion ไม่สำเร็จ กรุณาลองใหม่';
    }catch{status.textContent='โหลดการตั้งค่าไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วกดทดสอบอีกครั้ง';}
    finally{button.disabled=false;button.textContent=tested?'ทดสอบแล้ว — ดูผลใน Tag Assistant':'ทดสอบส่ง Conversion คลิก LINE';}
   });}
   return;
  }
  execute();
 };
 if(document.readyState==='complete')initialize();else window.addEventListener('DOMContentLoaded',initialize,{once:true});
})();
