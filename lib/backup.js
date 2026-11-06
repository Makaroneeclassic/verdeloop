import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {put,list,del,get} from '@vercel/blob';
import {state} from './core.js';
function key(){const value=Buffer.from(process.env.BACKUP_ENCRYPTION_KEY||'','base64');if(value.length!==32)throw new Error('backup_key_missing');return value;}
export function encryptBackup(data){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);
 const body=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);
 return Buffer.from(JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:body.toString('base64')}));
}
export function decryptBackup(buffer){
 const box=JSON.parse(buffer.toString());if(box.version!==1)throw new Error('backup_version');
 const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(box.iv,'base64'));decipher.setAuthTag(Buffer.from(box.tag,'base64'));
 return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data,'base64')),decipher.final()]).toString());
}
export async function makeBackup(sql){
 const [leadRows,historyRows,eventRows,documentRows,staffRows,integrationRows,reminderRows,adsRows,draftRows,imageRows,revisionRows,jobRows,publicationRows,lineSessionRows,lineFollowRows,lineConversionRows]=await sql.transaction([sql`SELECT COALESCE(jsonb_agg(to_jsonb(t)),'[]'::jsonb) AS data FROM (SELECT * FROM leads ORDER BY id LIMIT 20001) t`,sql`SELECT COALESCE(jsonb_agg(to_jsonb(t)),'[]'::jsonb) AS data FROM (SELECT * FROM lead_history ORDER BY id LIMIT 200001) t`,sql`SELECT COALESCE(jsonb_agg(to_jsonb(t)),'[]'::jsonb) AS data FROM (SELECT * FROM contact_events ORDER BY created_at LIMIT 200001) t`,sql`SELECT COALESCE(jsonb_agg(to_jsonb(t)),'[]'::jsonb) AS data FROM (SELECT * FROM document_files ORDER BY created_at LIMIT 101) t`,...['staff_users','integration_settings','followup_reminders','ads_conversions','article_drafts','article_images','article_revisions','writer_jobs','article_publications','line_login_sessions','line_follow_events','line_friend_conversions'].map(table=>sql.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t)),'[]'::jsonb) AS data FROM (SELECT * FROM ${table} LIMIT 200001) t`))],{isolationLevel:'RepeatableRead',readOnly:true});
 const leads=leadRows[0].data,history=historyRows[0].data,events=eventRows[0].data;
 if(leads.length>20000||history.length>200000||events.length>200000)throw new Error('backup_capacity_review_required');
 const documents=documentRows[0].data,documentContents=[];
 if(documents.length>100||documents.reduce((sum,d)=>sum+d.size,0)>20*1024*1024)throw new Error('document_backup_capacity_review_required');
 for(const doc of documents){const file=await get(doc.pathname,{access:'private',useCache:false});if(!file||file.statusCode!==200)throw new Error('document_backup_failed');documentContents.push({id:doc.id,data:Buffer.from(await new Response(file.stream).arrayBuffer()).toString('base64')});}
 if([staffRows,integrationRows,reminderRows,adsRows].some(r=>r[0].data.length>200000))throw Error('backup_capacity_review_required');
 const articleImages=imageRows[0].data,articleImageContents=[];
 if(articleImages.reduce((sum,d)=>sum+d.size,0)>50*1024*1024)throw new Error('article_backup_capacity_review_required');
 for(const im of articleImages){const file=await get(im.pathname,{access:'private',useCache:false});if(!file||file.statusCode!==200)throw new Error('article_image_backup_failed');articleImageContents.push({id:im.id,data:Buffer.from(await new Response(file.stream).arrayBuffer()).toString('base64')});}
 if([draftRows,imageRows,revisionRows,jobRows,publicationRows,lineSessionRows,lineFollowRows,lineConversionRows].some(r=>r[0].data.length>200000))throw Error('backup_capacity_review_required');
 return {schemaVersion:6,lineSessions:lineSessionRows[0].data,lineFollows:lineFollowRows[0].data,lineConversions:lineConversionRows[0].data,articlePublications:publicationRows[0].data,articleDrafts:draftRows[0].data,articleImages,articleRevisions:revisionRows[0].data,writerJobs:jobRows[0].data,articleImageContents,staff:staffRows[0].data,integrations:integrationRows[0].data,reminders:reminderRows[0].data,ads:adsRows[0].data,createdAt:new Date().toISOString(),leads,history,events,documents,documentContents};
}
export async function backupToBlob(sql){
 if(!process.env.BLOB_READ_WRITE_TOKEN||!process.env.BACKUP_ENCRYPTION_KEY)throw new Error('backup_unconfigured');
 const data=await makeBackup(sql),buffer=encryptBackup(data);
 const name='backups/'+new Date().toISOString().replace(/[:.]/g,'-')+'.json.enc';
 const blob=await put(name,buffer,{access:'private',addRandomSuffix:true,contentType:'application/octet-stream'});
 // Read-back verifies storage and authentication of the encrypted snapshot.
 const fetched=await get(blob.url,{access:'private',useCache:false});
 if(!fetched || fetched.statusCode!==200)throw new Error('backup_readback_failed');
 const restored=decryptBackup(Buffer.from(await new Response(fetched.stream).arrayBuffer()));
 if(JSON.stringify(restored)!==JSON.stringify(data))throw new Error('backup_verification_failed');
 const result={ok:true,createdAt:data.createdAt,pathname:blob.pathname,leads:leadsCount(data),bytes:buffer.length};
 await state(sql,'backup',result);
 const old=await list({prefix:'backups/',limit:1000});
 const cutoff=Date.now()-30*86400000;
 const obsolete=old.blobs.filter(b=>new Date(b.uploadedAt).getTime()<cutoff).map(b=>b.url);
 if(obsolete.length)await del(obsolete);
 return result;
}
const leadsCount=data=>data.leads.length;
