import {FormError} from './form-error.js';
import {encryptBackup,decryptBackup} from './backup.js';
const envLine=()=>({token:process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim()||'',to:process.env.LINE_TO?.trim()||''});
export async function readIntegration(sql,key){
 const [row]=await sql`SELECT encrypted FROM integration_settings WHERE key=${key}`;
 return row?decryptBackup(Buffer.from(row.encrypted,'base64')):{};
}
export async function saveIntegration(sql,key,value){
 const encrypted=encryptBackup(value).toString('base64');
 await sql`INSERT INTO integration_settings(key,encrypted) VALUES(${key},${encrypted}) ON CONFLICT(key) DO UPDATE SET encrypted=excluded.encrypted,updated_at=now()`;
}
export async function lineSettings(sql){const c=await readIntegration(sql,'line');return {...envLine(),...c};}
export async function saveLine(sql,body){
 const old=await lineSettings(sql);const config={...old,token:body.lineToken?.trim()||old.token,to:body.lineTo?.trim()||old.to};
 if(!config.token||config.token.length>4000||!/^[UCR][a-f0-9]{32}$/i.test(config.to))throw new FormError('กรุณาตรวจ Channel Access Token และ ID ผู้รับ LINE');
 if(config.groupOnly&&!/^C[a-f0-9]{32}$/i.test(config.to))throw new FormError('ตั้งให้รับเฉพาะกลุ่ม กรุณาใช้ Group ID ขึ้นต้น C');
 await saveIntegration(sql,'line',config);
}
export async function saveAds(sql,body){
 const old=await readIntegration(sql,'ads'),config={...old};
 for(const field of ['customerId','managerId','qualifiedAction','wonAction']){const value=String(body[field]||'').replace(/-/g,'').trim();if(value&&!/^\d{1,20}$/.test(value))throw new FormError('รหัส Google Ads ต้องเป็นตัวเลข');config[field]=value;}
 for(const field of ['clientId','clientSecret','refreshToken','developerToken'])if(body[field]?.trim()){if(body[field].length>4000)throw new FormError('ข้อมูลเชื่อมต่อยาวเกินกำหนด');config[field]=body[field].trim();}
 for(const field of ['qualifiedName','wonName'])config[field]=String(body[field]||'').trim().slice(0,160);
 config.enabled=body.adsEnabled==='on';
 if(config.enabled&&!adsReady(config))throw new FormError('กรอกข้อมูล Google Ads API และรหัส Conversion แบบนำเข้าให้ครบก่อนเปิดส่งอัตโนมัติ');
 await saveIntegration(sql,'ads',config);
}
export const adsReady=c=>Boolean(c.customerId&&c.clientId&&c.clientSecret&&c.refreshToken&&c.developerToken&&(c.qualifiedAction||c.wonAction));
