import {database} from '../lib/core.js';
import {readIntegration,lineSettings} from '../lib/integrations.js';
import {receiveFollows} from '../lib/line-tracking.js';
import {validSignature,receiveGroups} from '../lib/line-webhook.js';
export const config={api:{bodyParser:false}};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex');
 if(req.method!=='POST')return res.status(405).json({ok:false});
 const signature=req.headers['x-line-signature'];if(typeof signature!=='string'||signature.length!==44)return res.status(401).json({ok:false});
 try{
  const chunks=[];let length=0;
  for await(const chunk of req){const b=Buffer.from(chunk);length+=b.length;if(length>256*1024)return res.status(413).json({ok:false});chunks.push(b);}
  const raw=Buffer.concat(chunks),sql=database();if(!sql)return res.status(503).json({ok:false});
  const settings=await lineSettings(sql);if(!settings.secret)return res.status(503).json({ok:false});
  if(!validSignature(raw,signature,settings.secret))return res.status(401).json({ok:false});
  let body;try{body=JSON.parse(raw.toString('utf8'));}catch{return res.status(400).json({ok:false});}
  if(!Array.isArray(body.events)||body.events.length>100)return res.status(400).json({ok:false});
  // Retain group metadata and hashed follow identities only; never store chat text or reply tokens.
  await receiveGroups(sql,body.events,settings.token);
  if(body.events.some(e=>['follow','unfollow'].includes(e.type)))await receiveFollows(sql,body.events,await readIntegration(sql,'line_tracking'));
  return res.status(200).json({ok:true});
 }catch{console.error('LINE_WEBHOOK_FAILED');return res.status(503).json({ok:false});}
}
