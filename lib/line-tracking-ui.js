import {esc,field,post} from './crm-ui.js';
import {ready,LINE_CALLBACK} from './line-tracking.js';
export function lineTrackingUI(c,stats=[],clicks=[]){return `<section id="line-tracking"><h2>LINE — คลิกและเพิ่มเพื่อนจริง</h2>
<p>${ready(c)?'เปิดการยืนยันเพื่อนผ่าน LINE Login แล้ว':'ยังไม่เปิด LINE Login — ปุ่มเปิด LINE ปกติ ยังไม่อ้างว่าเพิ่มเพื่อนสำเร็จ'} · Secret ${c.channelSecret?'บันทึกแล้ว':'ยังไม่มี'}</p>
<p>คลิก LINE ส่งไป Google Ads: ${c.clickDestination?'ตั้งค่าแล้ว':'ยังไม่มี Conversion'} · เพิ่มเพื่อนที่ยืนยันแล้ว: ${c.friendDestination?'ตั้งค่าแล้ว':'ยังไม่มี Conversion'}</p>
<details><summary>วิธีตั้งค่า LINE Login และ Google Ads</summary><ol>
<li>LINE Developers → Provider เดียวกับ Messaging API ของ @verdeloop → สร้าง LINE Login Channel แบบ Web app</li>
<li>Basic settings → Linked LINE Official Account เลือก @verdeloop</li>
<li>LINE Login → Callback URL ใส่ <code>${LINE_CALLBACK}</code> และเปลี่ยน Channel เป็น Published เมื่อพร้อม</li>
<li>Messaging API ต้องเปิด Use webhook และ Webhook redelivery ที่ <code>https://verdeloopthailand.com/api/line-webhook</code></li>
<li>นำ Channel ID และ Channel Secret ของ LINE Login มากรอกด้านล่าง (คนละตัวกับ Messaging API)</li>
<li>Google Ads สร้าง Website Conversion แยก 2 ตัว: “คลิก LINE Verdeloop” (Secondary) และ “เพิ่มเพื่อน LINE Verdeloop” (เริ่ม Secondary ระหว่างทดสอบ), Count = One ทั้งคู่ นำค่า send_to จาก Event snippet มากรอก ห้ามใช้ Label ส่งฟอร์มซ้ำ</li>
<li>เปิดยืนยันเพื่อน แล้วทดสอบด้วยบัญชี LINE ที่ยังไม่เป็นเพื่อน ตรวจ Tag Assistant และยอดด้านล่าง ก่อนเลือกเพิ่มเพื่อนเป็นเป้าหมายแคมเปญ</li>
</ol></details>
${post('line_tracking_save',field('LINE Login Channel ID','loginChannelId',c.channelId,'text','inputmode="numeric" maxlength="20"')+field('LINE Login Channel Secret (เว้นว่างใช้เดิม)','loginChannelSecret','','password','autocomplete="new-password" maxlength="32"')+field('Google Ads send_to — คลิก LINE','lineClickDestination',c.clickDestination,'text','placeholder="AW-18443678211/ConversionLabel"')+field('Google Ads send_to — เพิ่มเพื่อนที่ยืนยันแล้ว','lineFriendDestination',c.friendDestination,'text','placeholder="AW-18443678211/ConversionLabel"')+`<label class="full"><input type="checkbox" name="lineTrackingEnabled" ${c.enabled?'checked':''}/> เปิด LINE Login เพื่อยืนยันการเพิ่มเพื่อน (เพิ่มขั้นตอนยืนยันผ่าน LINE)</label><button>บันทึกการติดตาม LINE</button>`)}
<h3>ผล 30 วันล่าสุด</h3><p>คลิกที่อนุญาตการวัดผล ${clicks.reduce((n,r)=>n+Number(r.clicks),0)} ครั้ง · เพิ่มเพื่อนใหม่จากเว็บที่ยืนยันแล้ว ${stats.reduce((n,r)=>n+Number(r.verified),0)} คน</p>
<div class="table-wrap"><table><tr><th>หน้าเว็บ</th><th>ตำแหน่งปุ่ม</th><th>เพิ่มเพื่อนยืนยันแล้ว</th></tr>${stats.map(r=>`<tr><td>${esc(r.path)}</td><td>${esc(r.placement)}</td><td>${r.verified}</td></tr>`).join('')||'<tr><td colspan="3">ยังไม่มีการเพิ่มเพื่อนที่จับคู่กับเว็บได้</td></tr>'}</table></div>
<p class="muted">นับเมื่อ LINE Login ยืนยันตัวตนและสถานะเพื่อน ตรงกับ Webhook เพิ่มเพื่อนในช่วงนั้น ไม่รวมเพื่อนเดิม ปลดบล็อก หรือคลิกอย่างเดียว เก็บรหัสผู้ใช้แบบแฮช ไม่เก็บชื่อหรือข้อความ LINE การแยกเพิ่มเพื่อน/ปลดบล็อกอิงค่าที่ LINE รายงาน ซึ่ง LINE ไม่รับประกันความแม่นยำสมบูรณ์</p>
<p class="muted">Google Ads รับเหตุการณ์เมื่อกลับจาก LINE มาที่เว็บและอนุญาตโฆษณา ยอดหลังบ้านอาจมากกว่า Google Ads หากปิดหน้าก่อนกลับ มีตัวบล็อก หรือไม่มีคลิกโฆษณาที่จับคู่ได้ ไม่มีการส่ง LINE User ID ไป Google</p></section>`;}
