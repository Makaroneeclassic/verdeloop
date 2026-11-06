import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {readIntegration,saveIntegration,lineSettings} from './integrations.js';
import {encryptBackup,decryptBackup} from './backup.js';
import {attribution} from './core.js';
import {FormError} from './form-error.js';

export const LINE_URL='https://line.me/R/ti/p/@verdeloop';
export const LINE_CALLBACK='https://verdeloopthailand.com/api/line-login?callback=1';
export const LINE_COOKIE='__Host-verdeloop_line';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const ready=c=>Boolean(c.enabled&&/^\d{5,20}$/.test(c.channelId||'')&&c.channelSecret&&c.identityKey);
export const destination=value=>/^AW-\d{5,20}\/[A-Za-z0-9_-]{5,100}$/.test(value||'')?value:'';
export const userHash=(id,key)=>createHmac('sha256',key).update(id).digest('hex');
export function trackingInput(body={}){
 const analytics=body.analytics===true,ads=body.ads===true;
 const attrs=analytics||ads?attribution(body.attribution):{};
 if(!ads)for(const t of Object.values(attrs))for(const k of ['gclid','gbraid','wbraid'])delete t[k];
 return {analytics,ads,attrs,path:typeof body.path==='string'&&/^\/[\p{L}\p{M}\p{N}/_%.-]*$/u.test(body.path)?body.path.slice(0,240):'/',placement:/^[a-z_]{1,30}$/.test(body.placement||'')?body.placement:'unknown'};
}
export async function saveLineTracking(sql,body){
 const old=await readIntegration(sql,'line_tracking');
 const c={...old,channelId:String(body.loginChannelId||'').trim(),channelSecret:String(body.loginChannelSecret||'').trim()||old.channelSecret||'',enabled:body.lineTrackingEnabled==='on',identityKey:old.identityKey||randomBytes(32).toString('hex')};
 if(c.channelId&&!/^\d{5,20}$/.test(c.channelId))throw new FormError('LINE Login Channel ID ต้องเป็นตัวเลข');
 if(c.channelSecret&&(!/^[a-f0-9]{32}$/i.test(c.channelSecret)))throw new FormError('กรุณาตรวจ LINE Login Channel Secret');
 for(const [field,key] of [['lineClickDestination','clickDestination'],['lineFriendDestination','friendDestination']]){
  const value=String(body[field]||'').trim();if(value&&!destination(value))throw new FormError('Google Ads ต้องเป็น AW-ตัวเลข/ConversionLabel');c[key]=value;
 }
 if(c.clickDestination&&c.clickDestination===c.friendDestination)throw new FormError('คลิก LINE และเพิ่มเพื่อน ต้องใช้ Conversion คนละตัว');
 const lead=process.env.PUBLIC_GOOGLE_ADS_ID+'/'+process.env.PUBLIC_GOOGLE_ADS_LEAD_LABEL;
 if([c.clickDestination,c.friendDestination].includes(lead))throw new FormError('ห้ามใช้ Conversion ส่งฟอร์มซ้ำกับ LINE');
 if(c.enabled){
  if(!ready(c))throw new FormError('กรอก LINE Login Channel ID และ Secret ให้ครบก่อนเปิด');
  const line=await lineSettings(sql);if(!line.secret||!line.token)throw new FormError('ตั้งค่า Messaging API และ Webhook ก่อนเปิดยืนยันเพื่อน');
 }
 await saveIntegration(sql,'line_tracking',c);
}
export async function startLogin(sql,config,body){
 const input=trackingInput(body),state=randomBytes(32).toString('hex'),nonce=randomBytes(32).toString('hex'),verifier=randomBytes(32).toString('base64url'),id=randomUUID(),startedAt=new Date().toISOString();
 await sql`INSERT INTO line_login_sessions(id,state_hash,encrypted,created_at,expires_at,analytics_consent,ads_consent,attribution,path,placement) VALUES(${id},${hash(state)},${encryptBackup({nonce,verifier}).toString('base64')},${startedAt},${new Date(Date.parse(startedAt)+1200000).toISOString()},${input.analytics},${input.ads},${JSON.stringify(input.attrs)}::jsonb,${input.path},${input.placement})`;
 const query=new URLSearchParams({response_type:'code',client_id:config.channelId,redirect_uri:LINE_CALLBACK,state,scope:'openid profile',nonce,bot_prompt:'aggressive',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
 return {state,url:'https://access.line.me/oauth2/v2.1/authorize?'+query};
}
async function jsonRequest(url,options){const r=await fetch(url,{...options,signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('line_provider_error');return r.json();}
export async function verifyLogin(config,code,encrypted){
 const {nonce,verifier}=decryptBackup(Buffer.from(encrypted,'base64'));
 const tokens=await jsonRequest('https://api.line.me/oauth2/v2.1/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:LINE_CALLBACK,client_id:config.channelId,client_secret:config.channelSecret,code_verifier:verifier})});
 if(typeof tokens.id_token!=='string'||typeof tokens.access_token!=='string')throw Error('line_token_missing');
 const verified=await jsonRequest('https://api.line.me/oauth2/v2.1/verify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({id_token:tokens.id_token,client_id:config.channelId,nonce})});
 if(verified.iss!=='https://access.line.me'||String(verified.aud)!==config.channelId||verified.nonce!==nonce||!/^U[a-f0-9]{32}$/i.test(verified.sub||'')||verified.exp*1000<=Date.now())throw Error('line_identity_invalid');
 const friendship=await jsonRequest('https://api.line.me/friendship/v1/status',{headers:{Authorization:'Bearer '+tokens.access_token}});
 if(typeof friendship.friendFlag!=='boolean')throw Error('line_friendship_invalid');
 return {userHash:userHash(verified.sub,config.identityKey),friend:friendship.friendFlag};
}
export async function matchFriends(sql){
 // Require verified Login identity AND a signed, timestamp-matched new-friend webhook.
 // A callback query parameter or a click alone is never evidence of a new friend.
 await sql`INSERT INTO line_friend_conversions(session_id,user_hash,event_id,occurred_at)
 SELECT DISTINCT ON (s.user_hash) s.id,s.user_hash,e.event_id,e.occurred_at
 FROM line_login_sessions s JOIN line_follow_events e ON e.user_hash=s.user_hash
 WHERE s.friend=true AND (s.analytics_consent OR s.ads_consent) AND e.kind='new_friend'
 AND e.occurred_at>=s.created_at AND e.occurred_at<=s.expires_at
 ORDER BY s.user_hash,s.created_at,e.occurred_at ON CONFLICT DO NOTHING`;
}
export async function receiveFollows(sql,events,config){
 if(!ready(config))return;
 for(const e of events){
  if(!['follow','unfollow'].includes(e.type)||e.source?.type!=='user'||!/^U[a-f0-9]{32}$/i.test(e.source.userId||'')||!Number.isSafeInteger(e.timestamp)||e.timestamp<Date.now()-86400000||e.timestamp>Date.now()+300000||!/^\w{10,100}$/.test(e.webhookEventId||''))continue;
  const kind=e.type==='unfollow'?'unfollow':e.follow?.isUnblocked===false?'new_friend':e.follow?.isUnblocked===true?'unblocked':'unknown';
  await sql`INSERT INTO line_follow_events(event_id,user_hash,occurred_at,kind) VALUES(${e.webhookEventId},${userHash(e.source.userId,config.identityKey)},${new Date(e.timestamp).toISOString()},${kind}) ON CONFLICT DO NOTHING`;
 }
 await matchFriends(sql);
}
export async function cleanupLineTracking(sql){
 await sql`DELETE FROM line_friend_conversions WHERE created_at<now()-interval '90 days'`;
 await sql`DELETE FROM line_login_sessions WHERE created_at<now()-interval '90 days' OR (expires_at<now()-interval '1 day' AND NOT EXISTS(SELECT 1 FROM line_friend_conversions c WHERE c.session_id=line_login_sessions.id))`;
 await sql`DELETE FROM line_follow_events WHERE occurred_at<now()-interval '90 days' AND NOT EXISTS(SELECT 1 FROM line_friend_conversions c WHERE c.event_id=line_follow_events.event_id)`;
}
