import {database} from '../lib/core.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex');
 if(req.method!=='GET')return res.status(405).json({ok:false});
 try{
  const sql=database();if(!sql)throw new Error();
  const [result]=await sql`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name IN ('sales_status','attribution','notify_key','phone_key','assigned_to','shipment','deal')`;
  if(result.count!==7)throw new Error();
  const [tables]=await sql`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('staff_users','integration_settings','followup_reminders','ads_conversions')`;
  if(tables.count!==4)throw new Error();
  return res.status(200).json({ok:true});
 }catch{return res.status(503).json({ok:false});}
}
