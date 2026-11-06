import {createHmac,timingSafeEqual} from 'node:crypto';
export function validSignature(raw,signature,secret){
 if(typeof signature!=='string'||!secret||!/^[A-Za-z0-9+/]{43}=$/.test(signature))return false;
 const expected=createHmac('sha256',secret).update(raw).digest();const supplied=Buffer.from(signature,'base64');
 return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
}
export async function groupSummary(token,id){
 if(!/^C[a-f0-9]{32}$/i.test(id))throw Error('invalid_group');
 const r=await fetch('https://api.line.me/v2/bot/group/'+id+'/summary',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});
 if(!r.ok)throw Error('group_unavailable');const data=await r.json();
 return {groupId:id,name:String(data.groupName||'กลุ่ม LINE').slice(0,200)};
}
export async function receiveGroups(sql,events,token){
 const groups=new Map();
 for(const event of events){const id=event.source?.groupId;if(event.source?.type!=='group'||!/^C[a-f0-9]{32}$/i.test(id)||!['join','message','leave'].includes(event.type)||!Number.isSafeInteger(event.timestamp)||event.timestamp>Date.now()+300000)continue;
 if(!groups.has(id)||groups.get(id).timestamp<event.timestamp)groups.set(id,event);
 }
 for(const [id,event] of [...groups].slice(0,10)){
  const key='line_group:'+id;const [old]=await sql`SELECT value FROM system_state WHERE key=${key}`;
  if(old?.value?.lastEventAt>=event.timestamp)continue;
  let name=old?.value?.name||'กลุ่ม LINE';
  if(event.type!=='leave'&&!old){try{name=(await groupSummary(token,id)).name;}catch{}}
  const value={groupId:id,name,active:event.type!=='leave',lastEventAt:event.timestamp};
  await sql`INSERT INTO system_state(key,value) VALUES(${key},${JSON.stringify(value)}::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now() WHERE (system_state.value->>'lastEventAt')::bigint<${event.timestamp}`;
 }
}
