import {readIntegration,adsReady} from './integrations.js';
import {csv} from './crm.js';
export function clickId(attribution){if(attribution?._consent?.ads===false)return null;for(const touch of ['last','first'])for(const key of ['gclid','gbraid','wbraid']){const value=attribution?.[touch]?.[key];if(typeof value==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(value))return {[key]:value};}return null;}
export const adsTime=value=>new Date(new Date(value).getTime()+7*3600000).toISOString().slice(0,19).replace('T',' ')+'+07:00';
export async function queueAds(sql){
 const rows=await sql`SELECT id,attribution,qualified_at,closed_at,sales_status,deal FROM leads WHERE spam=false AND ((qualified_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ads_conversions q WHERE q.lead_id=leads.id AND q.kind='qualified' AND NOT(q.attempts=0 AND q.status IN ('pending','cancelled')))) OR (sales_status='won' AND closed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ads_conversions q WHERE q.lead_id=leads.id AND q.kind='won' AND NOT(q.attempts=0 AND q.status IN ('pending','cancelled'))))) ORDER BY id LIMIT 20000`;
 for(const r of rows){const click=clickId(r.attribution);if(!click)continue;
  for(const kind of ['qualified','won']){const time=kind==='won'?(r.sales_status==='won'?r.closed_at:null):r.qualified_at;if(!time)continue;
   const value=kind==='won'?r.deal?.saleAmount:0;if(kind==='won'&&(value===null||value===undefined))continue;
   const payload={...click,conversionDateTime:adsTime(time),conversionValue:Number(value)||0,currencyCode:'THB',orderId:`verdeloop-${r.id}-${kind}`};
   await sql`INSERT INTO ads_conversions(lead_id,kind,occurred_at,payload) VALUES(${r.id},${kind},${time},${JSON.stringify(payload)}::jsonb) ON CONFLICT(lead_id,kind) DO UPDATE SET payload=excluded.payload,occurred_at=excluded.occurred_at,status='pending' WHERE ads_conversions.attempts=0 AND ads_conversions.status IN ('pending','cancelled')`;
  }
 }
 // Cancel unsent events if a lead is reopened, disqualified, or marked spam.
 await sql`UPDATE ads_conversions q SET status='cancelled' FROM leads l WHERE q.lead_id=l.id AND q.status IN ('pending','failed') AND (l.spam=true OR (q.kind='won' AND l.sales_status<>'won') OR (q.kind='qualified' AND l.qualified_at IS NULL))`;
}
async function accessToken(c){
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:c.clientId,client_secret:c.clientSecret,refresh_token:c.refreshToken}),signal:AbortSignal.timeout(8000)});
 const data=await r.json();if(!r.ok||!data.access_token)throw Error('oauth_failed');return data.access_token;
}
function headers(c,token){return {'Content-Type':'application/json',Authorization:'Bearer '+token,'developer-token':c.developerToken,...(c.managerId?{'login-customer-id':c.managerId}:{})};}
export async function testAds(sql){
 const c=await readIntegration(sql,'ads');if(!adsReady(c))return {ok:false,error:'not_configured'};
 try{const token=await accessToken(c);
  const ids=[c.qualifiedAction,c.wonAction].filter(Boolean);
  const r=await fetch(`https://googleads.googleapis.com/v25/customers/${c.customerId}/googleAds:search`,{method:'POST',headers:headers(c,token),body:JSON.stringify({query:`SELECT conversion_action.id, conversion_action.type, conversion_action.status FROM conversion_action WHERE conversion_action.id IN (${ids.join(',')})`}),signal:AbortSignal.timeout(8000)});
  const data=await r.json();const rows=data.results||[];
  return {ok:r.ok&&ids.every(id=>rows.some(x=>String(x.conversionAction?.id)===id&&x.conversionAction.type==='UPLOAD_CLICKS'&&x.conversionAction.status==='ENABLED')),error:r.ok?'check_import_conversion_type':'http_'+r.status};
 }catch{return {ok:false,error:'connection_failed'}}
}
export async function sendAds(sql){
 await queueAds(sql);const c=await readIntegration(sql,'ads');if(!c.enabled||!adsReady(c))return {configured:false,sent:0,failed:0};
 let token;try{token=await accessToken(c);}catch{return {configured:true,sent:0,failed:1,error:'oauth_failed'}}
 const rows=await sql`UPDATE ads_conversions SET locked_until=now()+interval '3 minutes',attempts=attempts+1 WHERE id IN (SELECT id FROM ads_conversions WHERE status IN ('pending','failed') AND attempts<5 AND (locked_until IS NULL OR locked_until<now()) ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING *`;
 let sent=0,failed=0;
 for(const row of rows){
  const action=row.kind==='won'?c.wonAction:c.qualifiedAction;
  if(!action){await sql`UPDATE ads_conversions SET locked_until=NULL,error='missing_action',attempts=attempts-1 WHERE id=${row.id}`;continue;}
  let good=false,error='network_uncertain';
  try{
   const r=await fetch(`https://googleads.googleapis.com/v25/customers/${c.customerId}:uploadClickConversions`,{method:'POST',headers:headers(c,token),body:JSON.stringify({conversions:[{...row.payload,conversionAction:`customers/${c.customerId}/conversionActions/${action}`,consent:{adUserData:'DENIED',adPersonalization:'DENIED'}}],partialFailure:true}),signal:AbortSignal.timeout(8000)});
   const data=await r.json();good=r.ok&&!data.partialFailureError&&Boolean(data.results?.[0]?.conversionAction);error=good?null:data.partialFailureError?'partial_failure':'http_'+r.status;
  }catch{}
  await sql`UPDATE ads_conversions SET status=${good?'sent':'failed'},sent_at=${good?new Date().toISOString():null},error=${error},locked_until=NULL WHERE id=${row.id}`;
  good?sent++:failed++;
 }
 return {configured:true,sent,failed};
}
export function offlineCSV(rows,c){
 return csv([['Google Click ID','Conversion Name','Conversion Time','Conversion Value','Conversion Currency','Order ID'],...rows.filter(r=>r.payload.gclid).map(r=>[r.payload.gclid,r.kind==='won'?c.wonName:c.qualifiedName,r.payload.conversionDateTime,r.payload.conversionValue,r.payload.currencyCode,r.payload.orderId])]);
}
