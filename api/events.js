import {database,sameOrigin,limit,validUUID,attribution} from '../lib/core.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({ok:false});
 if(!sameOrigin(req))return res.status(403).json({ok:false});
 let b;try{b=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{return res.status(400).json({ok:false});}
 if(!b || b.consent!==true || !validUUID(b.id) || !['page_view','phone_click','line_click','document_download'].includes(b.event) || typeof b.path!=='string' || !/^\/[\p{L}\p{M}\p{N}/_%.-]*$/u.test(b.path) || b.path.length>240)return res.status(400).json({ok:false});
 try{
  const sql=database(); if(!sql)return res.status(503).json({ok:false});
  const rate=await limit(sql,req,'events',120,600);
  if(!rate.allowed){res.setHeader('Retry-After',String(rate.retryAfter));return res.status(429).json({ok:false});}
  const a=attribution(b.attribution).last||{};
  await sql`INSERT INTO contact_events(id,event,path,source,medium,campaign,placement) VALUES(${b.id},${b.event},${b.path},${a.utm_source||a.referrer||'direct'},${a.utm_medium||''},${a.utm_campaign||''},${/^[a-z_]{0,30}$/.test(b.placement||'')?b.placement||'':''}) ON CONFLICT(id) DO NOTHING`;
  return res.status(200).json({ok:true});
 }catch{return res.status(503).json({ok:false});}
}
