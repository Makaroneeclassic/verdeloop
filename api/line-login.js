import {database,sameOrigin,limit,equal} from '../lib/core.js';
import {readIntegration} from '../lib/integrations.js';
import {LINE_COOKIE,LINE_URL,hash,ready,destination,startLogin,verifyLogin,matchFriends} from '../lib/line-tracking.js';
const cookie=req=>{const value=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(LINE_COOKIE+'='))?.slice(LINE_COOKIE.length+1);return /^[a-f0-9]{64}$/.test(value||'')?value:'';};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex');res.setHeader('Referrer-Policy','no-referrer');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({ok:false});
 const url=new URL(req.url,'https://verdeloopthailand.com');
 try{
  const sql=database();if(!sql)throw Error('unavailable');
  const c=await readIntegration(sql,'line_tracking');
  if(req.method==='GET'&&url.searchParams.has('callback')){
   const state=url.searchParams.get('state'),saved=cookie(req),code=url.searchParams.get('code');
   if(!ready(c)||!saved||!state||!equal(state,saved)||!code||code.length>3000)return res.redirect(303,'/line/?result=error');
   const [session]=await sql`UPDATE line_login_sessions SET consumed_at=now() WHERE state_hash=${hash(saved)} AND consumed_at IS NULL AND expires_at>now() RETURNING *`;
   if(!session)return res.redirect(303,'/line/?result=error');
   const identity=await verifyLogin(c,code,session.encrypted);
   await sql`UPDATE line_login_sessions SET encrypted='',user_hash=${identity.userHash},friend=${identity.friend} WHERE id=${session.id}`;
   await matchFriends(sql);
   return res.redirect(303,'/line/?result=1');
  }
  if(req.method==='GET'&&url.searchParams.has('result')){
   const saved=cookie(req);if(!saved)return res.status(401).json({ok:false});
   const [row]=await sql`SELECT s.id,s.friend,s.analytics_consent,s.ads_consent,s.path,s.placement,c.id AS conversion_id FROM line_login_sessions s LEFT JOIN line_friend_conversions c ON c.session_id=s.id WHERE state_hash=${hash(saved)} AND expires_at>now()`;
   if(!row)return res.status(401).json({ok:false});
   return res.status(200).json({ok:true,friend:row.friend,conversionId:row.conversion_id||null,analytics:row.analytics_consent,ads:row.ads_consent,path:row.path,placement:row.placement,friendDestination:destination(c.friendDestination)});
  }
  if(req.method==='GET')return res.status(200).json({ok:true,enabled:ready(c),clickDestination:destination(c.clickDestination)});
  if(!sameOrigin(req))return res.status(403).json({ok:false});
  if(!ready(c))return res.status(200).json({ok:true,url:LINE_URL});
  let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{return res.status(400).json({ok:false});}
  if(!body||typeof body!=='object'||JSON.stringify(body).length>5000)return res.status(400).json({ok:false});
  if(body.analytics!==true&&body.ads!==true)return res.status(200).json({ok:true,url:LINE_URL});
  const rate=await limit(sql,req,'line_login',20,600);if(!rate.allowed)return res.status(429).json({ok:false});
  const flow=await startLogin(sql,c,body);
  res.setHeader('Set-Cookie',`${LINE_COOKIE}=${flow.state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1200`);
  return res.status(200).json({ok:true,url:flow.url});
 }catch{
  console.error('LINE_LOGIN_FAILED');
  if(url.searchParams.has('callback'))return res.redirect(303,'/line/?result=error');
  return res.status(503).json({ok:false});
 }
}
