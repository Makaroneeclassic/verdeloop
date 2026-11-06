import {database,validUUID} from '../lib/core.js';
import {get} from '@vercel/blob';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({ok:false});
 try{
  const sql=database();if(!sql)throw new Error();
  const id=new URL(req.url,'https://verdeloopthailand.com').searchParams.get('id');
  if(!id){const rows=await sql`SELECT id,title,kind,size,created_at FROM document_files ORDER BY created_at DESC LIMIT 100`;return res.status(200).json({documents:rows});}
  if(!validUUID(id))return res.status(404).json({ok:false});
  const [row]=await sql`SELECT pathname FROM document_files WHERE id=${id}`;if(!row)return res.status(404).json({ok:false});
  const file=await get(row.pathname,{access:'private',useCache:false});if(!file||file.statusCode!==200)throw new Error();
  res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="verdeloop-document-${id}.pdf"`);
  return res.status(200).send(Buffer.from(await new Response(file.stream).arrayBuffer()));
 }catch{return res.status(503).json({ok:false});}
}
