import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import handler from '../api/admin.js';

process.env.ADMIN_USER = 'test-admin';
process.env.ADMIN_PASSWORD = 'test-password-not-for-production';
delete process.env.DATABASE_URL;
const headers = { host: 'verdeloopthailand.com', origin: 'https://verdeloopthailand.com' };
async function request(method = 'GET', body = {}, extra = {}) {
  const res = { headers: {}, code: 200,
    setHeader(k,v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.code = code; return this; },
    send(html) { this.html = html; return this; },
    redirect(code,url) { this.code=code; this.location=url; return this; },
  };
  await handler({ method, body, url:'/admin', headers:{...headers,...extra} },res);
  return res;
}
const login = () => request('POST', { action:'login', username:process.env.ADMIN_USER, password:process.env.ADMIN_PASSWORD });

test('login page is private, contains no customer list or Basic Auth prompt', async () => {
  const r=await request();
  assert.equal(r.code,200);
  assert.match(r.html,/autocomplete="current-password"/);
  assert.doesNotMatch(r.html,/ลีดจากเว็บ Verdeloop/);
  assert.equal(r.headers['www-authenticate'],undefined);
  assert.match(r.headers['cache-control'],/no-store/);
});
test('wrong credentials are escaped and password is not reflected', async () => {
  const r=await request('POST',{action:'login',username:'<svg onload=alert(1)>',password:'wrong-password'});
  assert.equal(r.code,401);
  assert.doesNotMatch(r.html,/<svg onload|wrong-password/);
});
test('cross-origin login and mutations are rejected',async () => {
  for(const action of ['login','delete','logout']) {
    const r=await request('POST',{action},{origin:'https://external.example'});
    assert.equal(r.code,403);
  }
});
test('signed cookie grants access, tampering and logout remove access',async () => {
  const r=await login();
  assert.equal(r.code,303); assert.equal(r.location,'/admin');
  const cookie=r.headers['set-cookie'];
  for(const flag of ['HttpOnly','Secure','SameSite=Strict','Max-Age=28800']) assert.ok(cookie.includes(flag));
  const valid=cookie.split(';')[0];
  // No DB configured in this test: reaching 503 proves the authenticated branch is reached.
  assert.equal((await request('GET',{}, {cookie:valid})).code,503);
  assert.match((await request('GET',{}, {cookie:valid+'x'})).html,/ยินดีต้อนรับกลับ/);
  assert.equal((await request('POST',{action:'delete',id:1})).code,401);
  const out=await request('POST',{action:'logout'},{cookie:valid});
  assert.match(out.headers['set-cookie'],/Max-Age=0/);
  assert.equal(out.location,'/admin');
});
test('expired signed sessions are denied',async () => {
  const payload=Buffer.from(JSON.stringify({expires:Date.now()-1000,nonce:'test'})).toString('base64url');
  const key=createHash('sha256').update(JSON.stringify(['verdeloop-admin-session-v1',process.env.ADMIN_USER,process.env.ADMIN_PASSWORD])).digest();
  const sig=createHmac('sha256',key).update(payload).digest('base64url');
  const r=await request('GET',{}, {cookie:`__Host-verdeloop_admin=${payload}.${sig}`});
  assert.match(r.html,/ยินดีต้อนรับกลับ/);
});
