import {put,del} from '@vercel/blob';
import {validUUID} from './core.js';
export async function uploadDocument(sql,body){
 if(!validUUID(body.documentId)||typeof body.title!=='string'||!body.title.trim()||body.title.length>160||!['certificate','specification','other'].includes(body.kind)||typeof body.file!=='string'||body.file.length>4200000||!(/^[A-Za-z0-9+/]*={0,2}$/.test(body.file)))throw new Error('invalid_document');
 const bytes=Buffer.from(body.file,'base64');if(bytes.length>3*1024*1024||bytes.length<5||bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('invalid_pdf');
 const [existing]=await sql`SELECT id FROM document_files WHERE id=${body.documentId}`;if(existing)return existing;
 const blob=await put('documents/'+body.documentId+'.pdf',bytes,{access:'private',addRandomSuffix:false,contentType:'application/pdf'});
 try{const [row]=await sql`INSERT INTO document_files(id,title,kind,pathname,size) VALUES(${body.documentId},${body.title.trim()},${body.kind},${blob.pathname},${bytes.length}) RETURNING id`;return row;}
 catch(e){await del(blob.pathname).catch(()=>{});throw e;}
}
export async function removeDocument(sql,id){
 if(!validUUID(id))throw new Error('invalid_id');
 const [row]=await sql`DELETE FROM document_files WHERE id=${id} RETURNING pathname`;
 if(row)await del(row.pathname).catch(()=>console.error('DOCUMENT_BLOB_CLEANUP_PENDING'));
}
