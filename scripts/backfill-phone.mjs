import {neon} from '@neondatabase/serverless';
import {normalizePhone} from '../lib/phone.js';
const sql=neon(process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL);
let cursor='0',updated=0;
while(true){const rows=await sql`SELECT id,phone FROM leads WHERE id>${cursor}::bigint AND phone_key IS NULL ORDER BY id LIMIT 200`;if(!rows.length)break;
 for(const r of rows){const key=normalizePhone(r.phone);if(key){await sql`UPDATE leads SET phone_key=${key} WHERE id=${r.id} AND phone_key IS NULL`;updated++;}}
 cursor=String(rows.at(-1).id);
}
console.log('Phone grouping keys backfilled:',updated);
