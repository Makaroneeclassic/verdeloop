import {FormError} from './form-error.js';
import {scrypt as scryptCallback,randomBytes,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
export async function passwordHash(password){
 if(typeof password!=='string'||password.length<12||password.length>200)throw new FormError('รหัสผ่านต้องมี 12–200 ตัวอักษร');
 const salt=randomBytes(16).toString('hex');const key=await scrypt(password,salt,64);
 return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(password,hash){
 if(typeof password!=='string'||password.length>200)return false;
 const [type,salt,hex]=String(hash||'').split(':');
 if(type!=='scrypt'||!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{128}$/.test(hex))return false;
 const key=await scrypt(password,salt,64);return timingSafeEqual(key,Buffer.from(hex,'hex'));
}
export const canManage=user=>['owner','admin'].includes(user.role);
export const canRead=(user,lead)=>canManage(user)||user.role==='viewer'||lead.assigned_to===user.id||!lead.assigned_to;
export const canEdit=(user,lead)=>canManage(user)||(user.role==='sales'&&(lead.assigned_to===user.id||!lead.assigned_to));
export async function staffLogin(sql,name,password){
 const [user]=await sql`SELECT * FROM staff_users WHERE username=${name.toLowerCase()} AND active=true`;
 // Run scrypt even for unknown usernames to avoid a fast existence oracle.
 const hash=user?.password_hash||'scrypt:00000000000000000000000000000000:'+ '00'.repeat(64);
 const valid=await passwordMatches(password,hash);return valid&&user?user:null;
}
