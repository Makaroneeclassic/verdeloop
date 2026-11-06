// Thai numbers are stored as domestic digits. Explicit non-Thai international
// numbers retain their +country code; never reinterpret them as Thai numbers.
export function normalizePhone(value) {
 if(typeof value!=='string'||value.length>100)return null;
 let phone=value.normalize('NFKC').replace(/[๐-๙]/g,c=>String(c.charCodeAt(0)-0x0e50)).trim();
 if(!phone||!/^[+\d\s().\-‐‑‒–—]+$/.test(phone))return null;
 phone=phone.replace(/[\s().\-‐‑‒–—]/g,'');
 if(phone.startsWith('00'))phone='+'+phone.slice(2);
 if(phone.startsWith('+66'))phone='0'+phone.slice(3).replace(/^0/,'');
 else if(phone.startsWith('66')&&phone.length>=10)phone='0'+phone.slice(2).replace(/^0/,'');
 else if(phone.startsWith('+'))return /^\+[1-9]\d{7,14}$/.test(phone)?phone:null;
 else if(/^[1-9]\d{7,8}$/.test(phone))phone='0'+phone;
 return /^0\d{8,9}$/.test(phone)?phone:null;
}
