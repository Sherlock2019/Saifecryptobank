// End-to-end checks for the mobile security layer (/api/m/*).
// Needs a server with a fresh user store and short timers, e.g.:
//   SAIFE_RUN_DIR=$(mktemp -d) MOBILE_IDLE_MS=6000 MOBILE_ALLOWLIST_COOLDOWN_MS=3000 PORT=3599 node server.js &
//   node scripts/mobile-smoke.mjs http://127.0.0.1:3599
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://127.0.0.1:3510';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

// tiny cookie-jar client
function client() {
  const c = { cookie: '', csrf: '' };
  c.call = async (method, path, body, { csrf = true } = {}) => {
    const headers = {}; if (c.cookie) headers.Cookie = c.cookie;
    if (method !== 'GET') { headers['Content-Type'] = 'application/json'; if (csrf) headers['X-CSRF-Token'] = c.csrf; }
    const r = await fetch(BASE + '/api/m/' + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    const sc = r.headers.get('set-cookie'); if (sc) { const m = /saife_m=([^;]*)/.exec(sc); c.cookie = m && m[1] ? 'saife_m=' + m[1] : ''; c.setCookie = sc; }
    const j = await r.json().catch(() => ({})); j.status = r.status;
    if (j.session && j.session.csrf) c.csrf = j.session.csrf;
    return j;
  };
  return c;
}
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32dec = (s) => { let bits = 0; let val = 0; const out = []; for (const ch of s) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const hotp = (secret, n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); const h = crypto.createHmac('sha1', b32dec(secret)).update(b).digest(); const o = h[19] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0'); };
let lastStep = 0;
// Smallest acceptable step above the last used one (server accepts ±1 step). While waiting for the next
// 30 s window, `keep` sends activity so the short test idle lock doesn't fire mid-wait.
async function freshCode(secret, keep) {
  for (;;) {
    const cur = Math.floor(Date.now() / 30000); const s = [cur - 1, cur, cur + 1].find((x) => x > lastStep);
    if (s != null) { lastStep = s; return hotp(secret, s); }
    if (keep) await keep.call('POST', 'activity'); await sleep(1000);
  }
}
const dev = (id) => ({ id, name: 'Smoke phone', platform: 'test', mobile: true, touch: true, webdriver: false, secure: false, tz: 'UTC', screen: '390x844' });
const DEV1 = crypto.randomBytes(16).toString('hex');

const cfg = await client().call('GET', 'config');
ok(cfg.ok && cfg.controls.length === 13, `config lists ${cfg.controls && cfg.controls.length} security layers`);
const fast = cfg.idleMs <= 10000;
if (!fast) console.log('      (idle lock test skipped: start the server with MOBILE_IDLE_MS=6000)');

const html = await fetch(BASE + '/mobile');
ok(/script-src 'self'/.test(html.headers.get('content-security-policy') || '') && html.headers.get('x-frame-options') === 'DENY', 'mobile page served with strict CSP + X-Frame-Options');

const A = client();
let r = await A.call('POST', 'login', { username: 'demo', password: 'wrong', device: dev(DEV1) });
ok(r.status === 401 && r.reason === 'INVALID_CREDENTIALS', 'wrong password refused');
r = await A.call('POST', 'login', { username: 'demo', password: 'SaifeDemo!2026', device: dev(DEV1) });
ok(r.ok && r.next === 'enroll', `password accepted, next step: ${r.next}`);
ok(/HttpOnly/.test(A.setCookie) && /SameSite=Strict/.test(A.setCookie), 'session cookie is HttpOnly + SameSite=Strict');
r = await A.call('GET', 'home');
ok(r.status === 403 && r.reason === 'FORBIDDEN_SCOPE', 'account data not reachable before MFA');

r = await A.call('POST', 'enroll/start');
const secret = r.secret; ok(/^[A-Z2-7]{32}$/.test(secret || ''), 'TOTP secret issued');
r = await A.call('POST', 'enroll/verify', { code: '000000' });
ok(!r.ok && r.reason === 'CODE_INVALID', 'wrong enrolment code refused');
const preCookie = A.cookie;
r = await A.call('POST', 'enroll/verify', { code: await freshCode(secret) });
ok(r.ok && r.recoveryCodes.length === 8 && r.session.state === 'ACTIVE', 'MFA enrolled, 8 recovery codes, session active');
const codes = r.recoveryCodes;
ok(A.cookie && A.cookie !== preCookie, 'session ID rotated after MFA');
const old = client(); old.cookie = preCookie;
r = await old.call('GET', 'home');
ok(r.status === 401, 'pre-MFA session token no longer valid');

r = await A.call('GET', 'home');
ok(r.ok && r.balances && r.balances.BTC.avail > 0, 'home loads balances after MFA');
const ethPx = r.markets.ETHUSDT.last; const btcPx = r.markets.BTCUSDT.last;
r = await A.call('POST', 'activity', {}, { csrf: false });
ok(r.status === 403 && r.reason === 'CSRF_FAILED', 'state change without CSRF token refused');

// authorization + trading protection
const cid = 'smoke-' + Date.now();
const lim = { acct: 'trader-1', market: 'ETHUSDT', side: 'BUY', type: 'LIMIT', price: (Math.round(ethPx * 0.97 * 100) / 100).toFixed(2), qty: 0.002, clientOrderId: cid };
const o1 = await A.call('POST', 'orders', lim);
ok(o1.ok && o1.account === 'cust-1', `body account ignored, order on ${o1.account}`);
const o2 = await A.call('POST', 'orders', lim);
ok(o2.ok && o2.duplicate && o2.order.id === o1.order.id, 'retry with same clientOrderId is a duplicate, not a second order');
r = await A.call('DELETE', 'orders/' + o1.order.id);
ok(r.ok && r.order.status === 'CANCELED', 'own order cancelled');
r = await A.call('POST', 'orders', { market: 'ETHUSDT', side: 'SELL', type: 'LIMIT', price: ethPx.toFixed(2), qty: 50 });
ok(!r.ok && r.reason === 'INSUFFICIENT_BALANCE', 'order above balance rejected');
r = await A.call('POST', 'orders', { market: 'BTCUSDT', side: 'BUY', type: 'MARKET', qty: 0.001 });
ok(r.ok && r.order.filled > 0, 'small market buy filled');

// withdrawal protection
r = await A.call('POST', 'withdrawals', { asset: 'BTC', amount: 0.01, address: 'bc1q-attacker-01' });
ok(r.status === 403 && r.reason === 'NOT_ALLOWLISTED', 'withdrawal to non-allowlisted address refused');
r = await A.call('POST', 'withdrawals', { asset: 'BTC', amount: Math.ceil((26000 / btcPx) * 1000) / 1000, address: 'bc1q-cust-cold-01' });
ok(r.status === 403 && r.reason === 'DAILY_LIMIT', 'withdrawal above daily limit refused');
r = await A.call('POST', 'withdrawals', { asset: 'BTC', amount: 0.01, address: 'bc1q-cust-cold-01' });
ok(r.status === 401 && r.reason === 'STEP_UP_REQUIRED', 'withdrawal without step-up code refused');
const wcode = await freshCode(secret, A);
r = await A.call('POST', 'withdrawals', { asset: 'BTC', amount: 0.01, address: 'bc1q-cust-cold-01', code: wcode });
ok(r.ok && r.withdrawal.status === 'SCREENING', 'step-up withdrawal accepted into Guardian screening');
const wdId = r.withdrawal && r.withdrawal.id;
r = await A.call('POST', 'withdrawals', { asset: 'BTC', amount: 0.01, address: 'bc1q-cust-cold-01', code: wcode });
ok(r.status === 401 && r.reason === 'CODE_REPLAY', 'reused TOTP code refused (replay)');
await sleep(3200);
r = await A.call('GET', 'home');
const w = r.withdrawals && r.withdrawals.find((x) => x.id === wdId);
ok(w && ['BROADCAST', 'CONFIRMED'].includes(w.status), `withdrawal from trusted device broadcast (${w ? w.status : r.status + ' ' + r.reason})`);

r = await A.call('POST', 'allowlist', { asset: 'ETH', label: 'New wallet', address: '0xNew-Wallet-77', code: await freshCode(secret, A) });
ok(r.ok, `new address added with step-up${r.ok ? '' : ` (${r.status} ${r.reason})`}`);
r = await A.call('POST', 'withdrawals', { asset: 'ETH', amount: 0.1, address: '0xNew-Wallet-77' });
ok(r.status === 403 && r.reason === 'ALLOWLIST_COOLING', 'new address blocked during cooling period');

// server-enforced idle lock
if (fast) {
  await sleep(cfg.idleMs + 2500);
  r = await A.call('GET', 'home');
  ok(r.status === 423 && r.reason === 'SESSION_LOCKED', `session locked by server after ${cfg.idleMs / 1000} s idle`);
  r = await A.call('POST', 'orders', { market: 'BTCUSDT', side: 'BUY', type: 'MARKET', qty: 0.001 });
  ok(r.status === 423, 'orders refused while locked');
  r = await A.call('POST', 'unlock', { code: await freshCode(secret) });
  ok(r.ok && r.session.state === 'ACTIVE', 'unlocked with a fresh MFA code');
  r = await A.call('GET', 'home');
  ok(r.ok, 'account usable again after re-authentication');
}

// lost device
const P = client();
r = await P.call('POST', 'lost-device', { username: 'demo', password: 'SaifeDemo!2026', method: 'recovery', code: '00000-00000' });
ok(r.status === 401, 'lost-device report needs a valid second factor');
r = await P.call('POST', 'lost-device', { username: 'demo', password: 'SaifeDemo!2026', method: 'recovery', code: codes[0] });
ok(r.ok && r.caseId && r.sessionsEnded >= 1 && r.totpReset, `lost device reported: ${r.sessionsEnded} session(s) ended, case ${r.caseId}`);
r = await A.call('GET', 'home');
ok(r.status === 401, 'stolen session no longer works');
const ops = await fetch(BASE + '/api/ops').then((x) => x.json());
ok(ops.cases.some((c) => c.rule === 'LOST_DEVICE_REPORTED' && c.status === 'OPEN'), 'Guardian case opened for human review');
ok(ops.audit.some((x) => x.action === 'HOLD_WITHDRAWALS' && x.target === 'cust-1'), 'withdrawals frozen via policy service');
r = await A.call('POST', 'login', { username: 'demo', password: 'SaifeDemo!2026', device: dev(DEV1) });
ok(r.status === 403 && r.reason === 'DEVICE_REVOKED', 'lost device cannot sign in');
const N = client(); const DEV2 = crypto.randomBytes(16).toString('hex');
r = await N.call('POST', 'login', { username: 'demo', password: 'SaifeDemo!2026', device: dev(DEV2) });
ok(r.ok && r.next === 'mfa' && r.methods.join() === 'recovery', 'new device: password alone cannot re-enrol, recovery code required');
r = await N.call('POST', 'mfa/recovery', { code: codes[0] });
ok(r.status === 401, 'used recovery code cannot be reused');
r = await N.call('POST', 'mfa/recovery', { code: codes[1] });
ok(r.ok && r.next === 'enroll', 'second recovery code accepted, new authenticator required');
r = await N.call('POST', 'enroll/start'); const secret2 = r.secret; lastStep = 0;
r = await N.call('POST', 'enroll/verify', { code: await freshCode(secret2) });
ok(r.ok, 'new authenticator enrolled on the new device');
r = await N.call('POST', 'withdrawals', { asset: 'BTC', amount: 0.01, address: 'bc1q-cust-cold-01' });
ok(r.status === 403 && r.reason === 'ACCOUNT_FROZEN', 'withdrawals stay frozen until the case is reviewed');
const lostCase = (await fetch(BASE + '/api/ops').then((x) => x.json())).cases.find((c) => c.rule === 'LOST_DEVICE_REPORTED' && c.status === 'OPEN');
await fetch(BASE + `/api/cases/${lostCase.id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'dismiss' }) });
r = await N.call('GET', 'home');
ok(r.ok && !r.flags.frozen && !r.flags.withdrawHold, 'freeze lifted after reviewer closes the case');

// brute force lockout (leaves the account locked for 5 min, so last)
const X = client();
for (let i = 0; i < 5; i++) await X.call('POST', 'login', { username: 'demo', password: 'guess-' + i, device: dev(DEV2) });
r = await X.call('POST', 'login', { username: 'demo', password: 'SaifeDemo!2026', device: dev(DEV2) });
ok(r.status === 429 && r.reason === 'ACCOUNT_LOCKED', 'sign-in locked after 5 failures, even with the right password');
const ops2 = await fetch(BASE + '/api/ops').then((x) => x.json());
ok(ops2.cases.some((c) => c.rule === 'AUTH_BRUTE_FORCE'), 'brute-force alert raised');

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll mobile checks passed');
process.exit(fails ? 1 : 0);
