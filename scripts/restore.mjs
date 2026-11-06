// Restores application data only. Apply db-init + migrations to an EMPTY database first.
import {readFileSync} from 'node:fs';
import {neon} from '@neondatabase/serverless';
import {put} from '@vercel/blob';
import {decryptBackup} from '../lib/backup.js';
if(!process.argv.includes('--confirm-empty-target')||!process.argv[2]||!process.env.RESTORE_DATABASE_URL)throw new Error('Provide backup file, RESTORE_DATABASE_URL, and --confirm-empty-target');
const data=decryptBackup(readFileSync(process.argv[2]));
if(![2,3,4,5,6].includes(data.schemaVersion)||!Array.isArray(data.leads)||!Array.isArray(data.history)||!Array.isArray(data.events))throw new Error('Unsupported backup');
const sql=neon(process.env.RESTORE_DATABASE_URL);
try{
 const [existing]=await sql`SELECT (SELECT count(*) FROM leads)+(SELECT count(*) FROM lead_history)+(SELECT count(*) FROM contact_events)+(SELECT count(*) FROM document_files)+(SELECT count(*) FROM staff_users)+(SELECT count(*) FROM integration_settings)+(SELECT count(*) FROM followup_reminders)+(SELECT count(*) FROM ads_conversions)+(SELECT count(*) FROM article_drafts)+(SELECT count(*) FROM article_images)+(SELECT count(*) FROM article_revisions)+(SELECT count(*) FROM writer_jobs)+(SELECT count(*) FROM article_publications)+(SELECT count(*) FROM line_login_sessions)+(SELECT count(*) FROM line_follow_events)+(SELECT count(*) FROM line_friend_conversions) AS count`;
 if(Number(existing.count)!==0)throw new Error('Target must be empty');
 for(const file of data.documentContents||[]){const doc=data.documents.find(d=>d.id===file.id);if(!doc||!/^documents\/[0-9a-f-]+\.pdf$/.test(doc.pathname))throw new Error('Invalid document');await put(doc.pathname,Buffer.from(file.data,'base64'),{access:'private',addRandomSuffix:false,allowOverwrite:true,contentType:'application/pdf'});}
 for(const file of data.articleImageContents||[]){const im=data.articleImages.find(i=>i.id===file.id);if(!im||!/^articles\/[0-9a-f-]+\.webp$/.test(im.pathname))throw new Error('Invalid article image');await put(im.pathname,Buffer.from(file.data,'base64'),{access:'private',addRandomSuffix:false,allowOverwrite:true,contentType:'image/webp'});}
 await sql.transaction([
  sql`LOCK TABLE leads,lead_history,contact_events,document_files,staff_users,integration_settings,followup_reminders,ads_conversions,article_drafts,article_images,article_revisions,writer_jobs,article_publications,line_login_sessions,line_follow_events,line_friend_conversions IN ACCESS EXCLUSIVE MODE`,
  sql.query("DO $$ BEGIN IF EXISTS(SELECT 1 FROM leads) OR EXISTS(SELECT 1 FROM lead_history) OR EXISTS(SELECT 1 FROM contact_events) OR EXISTS(SELECT 1 FROM document_files) OR EXISTS(SELECT 1 FROM staff_users) OR EXISTS(SELECT 1 FROM integration_settings) OR EXISTS(SELECT 1 FROM followup_reminders) OR EXISTS(SELECT 1 FROM ads_conversions) OR EXISTS(SELECT 1 FROM article_drafts) OR EXISTS(SELECT 1 FROM article_images) OR EXISTS(SELECT 1 FROM article_revisions) OR EXISTS(SELECT 1 FROM writer_jobs) OR EXISTS(SELECT 1 FROM article_publications) OR EXISTS(SELECT 1 FROM line_login_sessions) OR EXISTS(SELECT 1 FROM line_follow_events) OR EXISTS(SELECT 1 FROM line_friend_conversions) THEN RAISE EXCEPTION 'Target must be empty'; END IF; END $$"),
  sql`INSERT INTO staff_users SELECT * FROM jsonb_populate_recordset(NULL::staff_users,${JSON.stringify(data.staff||[])}::jsonb)`,
  sql`INSERT INTO integration_settings SELECT * FROM jsonb_populate_recordset(NULL::integration_settings,${JSON.stringify(data.integrations||[])}::jsonb)`,
  sql`INSERT INTO leads SELECT * FROM jsonb_populate_recordset(NULL::leads,${JSON.stringify(data.leads)}::jsonb)`,
  sql`INSERT INTO lead_history SELECT * FROM jsonb_populate_recordset(NULL::lead_history,${JSON.stringify(data.history)}::jsonb)`,
  sql`INSERT INTO document_files SELECT * FROM jsonb_populate_recordset(NULL::document_files,${JSON.stringify(data.documents||[])}::jsonb)`,
  sql`INSERT INTO contact_events SELECT * FROM jsonb_populate_recordset(NULL::contact_events,${JSON.stringify(data.events.map(row=>({placement:'',...row})))}::jsonb)`,
  ...[['article_drafts',data.articleDrafts||[]],['article_images',data.articleImages||[]],['article_revisions',data.articleRevisions||[]],['writer_jobs',data.writerJobs||[]],['article_publications',data.articlePublications||[]],['line_login_sessions',data.lineSessions||[]],['line_follow_events',data.lineFollows||[]],['line_friend_conversions',data.lineConversions||[]],['followup_reminders',data.reminders||[]],['ads_conversions',data.ads||[]]].map(([table,rows])=>sql.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[JSON.stringify(rows)])),
  sql`SELECT setval(pg_get_serial_sequence('leads','id'),COALESCE((SELECT max(id) FROM leads),1),(SELECT count(*)>0 FROM leads))`,
  sql`SELECT setval(pg_get_serial_sequence('lead_history','id'),COALESCE((SELECT max(id) FROM lead_history),1),(SELECT count(*)>0 FROM lead_history))`,
 ]);
 console.log('Restored application data:',data.leads.length,'leads,',data.history.length,'history entries,',data.events.length,'events');
}catch{console.error('Restore failed or target is not empty. No existing records were overwritten.');process.exitCode=1;}
