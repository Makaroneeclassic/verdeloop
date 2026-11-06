import {readFileSync} from 'node:fs';
import {neon} from '@neondatabase/serverless';
const url=process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if(!url)throw new Error('Database connection required');
const sql=neon(url);
const schema=process.env.MIGRATION_SCHEMA || 'public';
if(!/^[a-z][a-z0-9_]*$/.test(schema))throw new Error('Invalid schema');
const statements=['002-sales-operations.sql','003-crm.sql','004-writer.sql','005-publications.sql','006-line-tracking.sql','007-article-seo.sql'].flatMap(file=>readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8').split(';').map(x=>x.trim()).filter(Boolean));
try {
 await sql.transaction([sql.query(`SET LOCAL search_path TO "${schema}"`),...statements.map(s=>sql.query(s))]);
 console.log('Migration applied:',schema);
} catch {console.error('Migration failed; details suppressed to protect credentials');process.exitCode=1;}
