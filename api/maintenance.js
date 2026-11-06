import {equal} from '../lib/core.js';
import {maintenance} from '../lib/maintenance.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false});
 if(!process.env.CRON_SECRET || !equal(req.headers.authorization||'',`Bearer ${process.env.CRON_SECRET}`))return res.status(401).json({ok:false});
 try{const result=await maintenance();return res.status(result.ok?200:503).json(result);}catch{return res.status(503).json({ok:false});}
}
