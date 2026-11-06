import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {trackingInput,destination,verifyLogin,startLogin,receiveFollows,matchFriends,hash} from '../lib/line-tracking.js';
import {encryptBackup} from '../lib/backup.js';
process.env.BACKUP_ENCRYPTION_KEY=randomBytes(32).toString('base64');
const config={enabled:true,channelId:'1234567890',channelSecret:'a'.repeat(32),identityKey:'test-hmac-key'};
test('measurement attribution respects independent consent and validates destinations',()=>{
 const attribution={last:{gclid:'click1',utm_campaign:'test'}};
 assert.deepEqual(trackingInput({attribution}).attrs,{});
 assert.equal(trackingInput({analytics:true,attribution}).attrs.last.gclid,undefined);
 assert.equal(trackingInput({ads:true,attribution}).attrs.last.gclid,'click1');
 assert.equal(destination('AW-18443678211/newLabel'),'AW-18443678211/newLabel');
 assert.equal(destination('AW-18443678211/<script>'),'');
});
test('server verifies identity nonce/audience/expiry and actual friendship; tokens never returned',async()=>{
 const saved=globalThis.fetch,nonce='test-nonce',box=encryptBackup({nonce,verifier:'secret-pkce'}).toString('base64');
 let wrongNonce=false;const calls=[];
 globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return new Response(JSON.stringify(url.endsWith('/token')?{id_token:'test-token',access_token:'test-access'}:url.endsWith('/verify')?{iss:'https://access.line.me',aud:config.channelId,nonce:wrongNonce?'wrong':nonce,exp:Math.floor(Date.now()/1000)+300,sub:'U'+'1'.repeat(32)}:{friendFlag:true}));};
 try{
  const identity=await verifyLogin(config,'test-code',box);assert.equal(identity.friend,true);assert.match(identity.userHash,/^[a-f0-9]{64}$/);assert.equal(Object.keys(identity).length,2);
  assert.equal(calls[0].opts.body.get('code_verifier'),'secret-pkce');
  wrongNonce=true;await assert.rejects(verifyLogin(config,'other-code',box),/identity_invalid/);
 }finally{globalThis.fetch=saved;}
});
const schema=process.env.LINE_TEST_SCHEMA;
test('real SQL: follow before/after callback, tamper resistance, redelivery, existing friends and unblocks',{skip:!schema},async()=>{
 assert.match(schema,/^line_test_\d+$/);const raw=neon(process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL);
 const sql=(strings,...values)=>raw.transaction([raw.query('SET LOCAL search_path TO '+schema),raw(strings,...values)]).then(r=>r[1]);
 const {userHash}=await import('../lib/line-tracking.js');
 const follow=(user,eventId,unblocked=false)=>({type:'follow',webhookEventId:eventId,timestamp:Date.now(),source:{type:'user',userId:user},follow:{isUnblocked:unblocked}});
 const user='U'+'a'.repeat(32),flow=await startLogin(sql,config,{ads:true,placement:'hero',attribution:{last:{gclid:'test-click'}}});
 const oauth=new URL(flow.url);assert.equal(oauth.searchParams.get('bot_prompt'),'aggressive');assert.equal(oauth.searchParams.get('code_challenge_method'),'S256');assert.equal(oauth.searchParams.get('state'),flow.state);
 const event=follow(user,'test-follow-001'.replaceAll('-',''));
 await receiveFollows(sql,[event],config);let rows=await sql`SELECT * FROM line_friend_conversions`;assert.equal(rows.length,0,'webhook alone cannot attribute to website');
 await sql`UPDATE line_login_sessions SET friend=true,user_hash=${userHash(user,config.identityKey)},consumed_at=now() WHERE state_hash=${hash(flow.state)}`;
 await matchFriends(sql);rows=await sql`SELECT * FROM line_friend_conversions`;assert.equal(rows.length,1);
 await receiveFollows(sql,[event,event],config);await matchFriends(sql);assert.equal((await sql`SELECT * FROM line_friend_conversions`).length,1);
 for(const [suffix,kind] of [['b','unblocked'],['c','unknown'],['d','existing'],['e','no-consent'],['f','new']]){
  const uid='U'+suffix.repeat(32),f=await startLogin(sql,config,{ads:kind!=='no-consent'});
  await sql`UPDATE line_login_sessions SET friend=true,user_hash=${userHash(uid,config.identityKey)},consumed_at=now() WHERE state_hash=${hash(f.state)}`;
  if(kind!=='existing'){
   const e=follow(uid,'testevent00000'+suffix,kind==='unblocked');if(kind==='unknown')delete e.follow;
   await receiveFollows(sql,[e],config);
  }
 }
 rows=await sql`SELECT * FROM line_friend_conversions`;assert.equal(rows.length,2,'only signed explicit new-friend events with consent match verified sessions');
 const stored=await sql`SELECT * FROM line_follow_events`;assert.ok(!JSON.stringify(stored).includes(user));
 const another=await startLogin(sql,config,{ads:true});
 await sql`UPDATE line_login_sessions SET friend=true,user_hash=${userHash(user,config.identityKey)} WHERE state_hash=${hash(another.state)}`;
 await matchFriends(sql);assert.equal((await sql`SELECT * FROM line_friend_conversions`).length,2,'same friend is not counted twice');
});
