'use strict';
/*
 * SAIFE mobile API (/api/m/*): the customer-facing security layer for the mobile app mockup.
 *
 * Real, enforced here: password (scrypt) + TOTP MFA (RFC 6238, one-time use) or WebAuthn passkeys,
 * server-side sessions with a 60 s idle lock that needs MFA to resume, session rotation, CSRF and
 * origin checks, per-session scopes, lost-device response, step-up withdrawals, destination allowlists
 * with a cooling period, daily limits, device risk signals, an encrypted user store, audit and Guardian cases.
 * Orders and withdrawals then go through the same engine as the web UI (guardrails, ledger, Guardian, custody).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

module.exports = function createMobile(d) {
  const { state, audit, openCase, policyApply, placeOrder, cancelOrder, requestWithdrawal, orderView, wdView, balView, tickerView, usd, readBody, send, tls, runDir } = d;

  // ------------------------------------------------------------------ config
  const IDLE_MS = Number(process.env.MOBILE_IDLE_MS || 60000);
  const SESSION_MAX_MS = 8 * 3600e3;
  const PENDING_MS = 5 * 60e3;
  const COOLDOWN_MS = Number(process.env.MOBILE_ALLOWLIST_COOLDOWN_MS || 60000);
  const DAILY_LIMIT_USD = Number(process.env.MOBILE_DAILY_LIMIT_USD || 25000);
  const MAX_FAILS = 5;
  const LOCKOUT_MS = 5 * 60e3;
  const DEFAULT_PW = 'SaifeDemo!2026';
  const DEMO_PW = process.env.MOBILE_DEMO_PASSWORD || DEFAULT_PW;
  const ACCT = 'cust-1';
  const STORE = path.join(runDir, 'mobile-users.json');
  const KEY_FILE = path.join(runDir, 'data.key');
  const now = () => Date.now();
  const sha = (x) => crypto.createHash('sha256').update(x).digest();
  const shaHex = (x) => sha(x).toString('hex');
  const b64u = (buf) => Buffer.from(buf).toString('base64url');
  const fromB64u = (s) => Buffer.from(String(s || ''), 'base64url');
  const safeEq = (a, b) => { const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || '')); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
  const fail = (code, reason, message, extra = {}) => ({ ok: false, code, reason, message, ...extra });
  const clean = (s, n = 80) => String(s == null ? '' : s).replace(/[^\w .:@()\/+,-]/g, '').slice(0, n);

  // ------------------------------------------------------------------ data key + encrypted store (at rest)
  fs.mkdirSync(runDir, { recursive: true });
  let KEY; let KEY_SRC;
  if (/^[0-9a-f]{64}$/i.test(process.env.SAIFE_DATA_KEY || '')) { KEY = Buffer.from(process.env.SAIFE_DATA_KEY, 'hex'); KEY_SRC = 'SAIFE_DATA_KEY env (inject from AWS Secrets Manager / KMS)'; }
  else {
    try { KEY = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex'); } catch { KEY = null; }
    if (!KEY || KEY.length !== 32) { KEY = crypto.randomBytes(32); fs.writeFileSync(KEY_FILE, KEY.toString('hex'), { mode: 0o600 }); }
    KEY_SRC = '.run/data.key, mode 0600 (local only; use KMS in production)';
  }
  const AAD = Buffer.from('saife-mobile-store-v1');
  const enc = (plain) => {
    const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', KEY, iv); c.setAAD(AAD);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
  };
  const dec = (s) => {
    const [v, iv, tag, ct] = s.split(':'); if (v !== 'v1') throw new Error('unknown store format');
    const dc = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64')); dc.setAAD(AAD); dc.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([dc.update(Buffer.from(ct, 'base64')), dc.final()]).toString('utf8');
  };
  let DB = { v: 1, users: {} };
  function save() { const tmp = STORE + '.tmp'; fs.writeFileSync(tmp, enc(JSON.stringify(DB)), { mode: 0o600 }); fs.renameSync(tmp, STORE); }
  try { DB = JSON.parse(dec(fs.readFileSync(STORE, 'utf8').trim())); }
  catch (e) { if (e.code !== 'ENOENT') console.error('[mobile] user store unreadable with current key, starting fresh:', e.message); }

  // ------------------------------------------------------------------ passwords, TOTP, recovery codes
  function hashPw(pw) { const salt = crypto.randomBytes(16); const h = crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 }); return `scrypt$16384$8$1$${salt.toString('base64')}$${h.toString('base64')}`; }
  const DUMMY_HASH = hashPw(crypto.randomBytes(8).toString('hex'));
  function checkPw(pw, rec) {
    const [, N, r, p, salt, h] = rec.split('$');
    const got = crypto.scryptSync(String(pw || ''), Buffer.from(salt, 'base64'), 32, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(got, Buffer.from(h, 'base64'));
  }
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function b32enc(buf) { let bits = 0; let val = 0; let out = ''; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
  function b32dec(s) { let bits = 0; let val = 0; const out = []; for (const ch of String(s).toUpperCase()) { const i = B32.indexOf(ch); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
  function hotp(key, counter) {
    const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
    const h = crypto.createHmac('sha1', key).update(buf).digest(); const o = h[19] & 15;
    return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
  }
  // Accepts the current 30 s step ±1; a step at or below the last accepted one is a replay.
  function totpCheck(secret, lastStep, code) {
    if (!secret) return fail(400, 'NO_AUTHENTICATOR', 'No authenticator is set up. Sign in again to set one up.');
    code = String(code || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) return fail(400, 'CODE_FORMAT', 'Enter the 6-digit code');
    const key = b32dec(secret); const step = Math.floor(now() / 30000);
    for (const w of [0, -1, 1]) {
      if (safeEq(hotp(key, step + w), code)) {
        if (step + w <= lastStep) return fail(401, 'CODE_REPLAY', 'That code was already used. Wait for the next code.');
        return { ok: true, step: step + w };
      }
    }
    return fail(401, 'CODE_INVALID', 'Wrong code');
  }
  const newRecoveryCodes = () => Array.from({ length: 8 }, () => { const h = crypto.randomBytes(5).toString('hex'); return `${h.slice(0, 5)}-${h.slice(5)}`; });
  const normRc = (c) => String(c || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  function useRecovery(u, code) {
    const hsh = shaHex('rc:' + normRc(code)); const i = u.recovery.indexOf(hsh);
    if (normRc(code).length !== 10 || i < 0) return false;
    u.recovery.splice(i, 1); return true;
  }

  // ------------------------------------------------------------------ users
  function newUser(username, pw) {
    const t = 0;
    return { username, acct: ACCT, pw: hashPw(pw), totp: null, lastStep: 0, recovery: [], passkeys: [], devices: {}, fails: 0, lockedUntil: 0,
      recoveryRequired: false, frozen: null, wdLog: [], createdAt: now(),
      allowlist: [
        { asset: 'BTC', address: 'bc1q-cust-cold-01', label: 'My cold wallet', addedAt: t, activeAt: t },
        { asset: 'ETH', address: '0xCust-Ledger-01', label: 'Hardware wallet', addedAt: t, activeAt: t },
        { asset: 'USDC', address: '0xCust-Ledger-01', label: 'Hardware wallet', addedAt: t, activeAt: t },
      ] };
  }
  if (!DB.users.demo) { DB.users.demo = newUser('demo', DEMO_PW); save(); }
  const events = new Map(); // username -> recent security events (shown in the app)
  function event(u, text, sev = 'info') { let l = events.get(u.username); if (!l) events.set(u.username, (l = [])); l.unshift({ ts: now(), text, sev }); if (l.length > 40) l.length = 40; }
  const actor = (u) => 'cust:' + u.username;

  // ------------------------------------------------------------------ sessions
  const sessions = new Map(); // sha256(token) -> session (raw token only ever lives in the cookie)
  function cookie(token, maxAge) { return `saife_m=${token}; Path=/api/m; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${tls ? '; Secure' : ''}`; }
  function createSession(ctx, u, deviceId, st) {
    const token = crypto.randomBytes(32).toString('base64url');
    const s = { key: shaHex(token), id: 'ses-' + crypto.randomBytes(4).toString('hex'), username: u.username, deviceId, state: st, ip: ctx.ip,
      createdAt: now(), lastActivity: now(), csrf: crypto.randomBytes(24).toString('base64url'), fails: 0, amr: ['pwd'], challenge: null, enrollSecret: null };
    sessions.set(s.key, s); ctx.res.setHeader('Set-Cookie', cookie(token, SESSION_MAX_MS / 1000));
    return s;
  }
  function rotate(ctx, s) { // new session id after privilege change (prevents session fixation)
    sessions.delete(s.key); const token = crypto.randomBytes(32).toString('base64url');
    s.key = shaHex(token); s.csrf = crypto.randomBytes(24).toString('base64url'); sessions.set(s.key, s);
    ctx.res.setHeader('Set-Cookie', cookie(token, SESSION_MAX_MS / 1000));
  }
  function endSession(s, why) { sessions.delete(s.key); const u = DB.users[s.username]; if (u && why) audit(actor(u), 'SESSION_ENDED', s.id, why, 'APPLIED'); }
  function lock(s, why) {
    if (s.state !== 'ACTIVE') return; s.state = 'LOCKED'; s.lockedAt = now(); s.fails = 0;
    const u = DB.users[s.username]; audit(actor(u), 'SESSION_LOCKED', s.id, why, 'APPLIED'); event(u, why === 'idle' ? `Session locked after ${IDLE_MS / 1000} s of inactivity` : 'Session locked', 'warn');
  }
  function expired(s) {
    if (now() - s.createdAt > SESSION_MAX_MS) return 'absolute lifetime reached';
    if (['MFA_PENDING', 'ENROLL'].includes(s.state) && now() - s.createdAt > PENDING_MS) return 'sign-in not completed in time';
    const u = DB.users[s.username]; if (!u) return 'user removed';
    const dv = u.devices[s.deviceId]; if (dv && dv.status !== 'active') return 'device ' + dv.status;
    return null;
  }
  function getSession(req) {
    const m = /(?:^|;\s*)saife_m=([A-Za-z0-9_-]{20,})/.exec(req.headers.cookie || ''); if (!m) return null;
    const s = sessions.get(shaHex(m[1])); if (!s) return null;
    const why = expired(s); if (why) { endSession(s, why); return null; }
    if (s.state === 'ACTIVE' && now() - s.lastActivity > IDLE_MS) lock(s, 'idle');
    return s;
  }
  setInterval(() => { for (const s of [...sessions.values()]) { const why = expired(s); if (why) endSession(s, why); else if (s.state === 'ACTIVE' && now() - s.lastActivity > IDLE_MS) lock(s, 'idle'); } }, 2000).unref();

  // Per-session scopes. The account a request acts on always comes from the session, never from the body.
  const SCOPES = {
    MFA_PENDING: ['mfa'], ENROLL: ['enroll'], LOCKED: ['unlock'],
    ACTIVE: ['read', 'trade', 'withdraw', 'security'],
  };
  const ACTIVE_SCOPES = new Set(SCOPES.ACTIVE);

  // ------------------------------------------------------------------ rate limits (per IP) and lockout
  const ipHits = new Map();
  function ipAllow(ip, max = 20) { const t = now(); const l = (ipHits.get(ip) || []).filter((x) => x > t - 60000); l.push(t); ipHits.set(ip, l); return l.length <= max; }
  setInterval(() => { const t = now(); for (const [ip, l] of ipHits) if (!l.some((x) => x > t - 60000)) ipHits.delete(ip); }, 60000).unref();
  function registerFail(u, ctx, kind) {
    u.fails = (u.fails || 0) + 1;
    audit(actor(u), 'AUTH_FAILED', u.username, `${kind} failure ${u.fails}/${MAX_FAILS} from ${ctx.ip}`, 'DENIED');
    event(u, `Failed ${kind} attempt from ${ctx.ip}`, 'warn');
    if (u.fails >= MAX_FAILS) {
      u.lockedUntil = now() + LOCKOUT_MS; u.fails = 0;
      openCase({ rule: 'AUTH_BRUTE_FORCE', title: 'Repeated failed sign-in attempts', severity: 'medium', accounts: [u.acct],
        summary: `${MAX_FAILS} failed ${kind} attempts for ${u.username} from ${ctx.ip}; sign-in locked for ${LOCKOUT_MS / 60000} min`,
        explanation: ['Possible credential stuffing or MFA guessing', 'Account sign-in temporarily locked (automatic, reversible)', 'Customer notified in the app'],
        features: { newIp: true, velocity: true }, actions: [['ALERT', u.acct]] });
      event(u, `Sign-in locked for ${LOCKOUT_MS / 60000} min after ${MAX_FAILS} failed attempts`, 'bad');
    }
    save();
  }
  const lockedOut = (u) => u.lockedUntil > now() ? fail(429, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${Math.ceil((u.lockedUntil - now()) / 1000)} s.`) : null;

  // ------------------------------------------------------------------ devices + integrity signals (optional layer)
  function deviceFrom(ctx, raw = {}) {
    const id = /^[a-f0-9]{32}$/.test(raw.id || '') ? raw.id : null;
    return { id, name: clean(raw.name, 40) || 'Browser', platform: clean(raw.platform, 40), ua: String(ctx.req.headers['user-agent'] || '').slice(0, 200),
      mobile: !!raw.mobile, touch: !!raw.touch, webdriver: !!raw.webdriver, secure: !!raw.secure, tz: clean(raw.tz, 40), screen: clean(raw.screen, 20) };
  }
  function riskOf(sig, prev, u, ip) {
    let score = 0; const why = [];
    if (sig.webdriver) { score += 60; why.push('Browser automation flag (navigator.webdriver)'); }
    if (sig.mobile && !sig.touch) { score += 20; why.push('Mobile user agent without touch support (emulator?)'); }
    if (prev && prev.ua && prev.ua !== sig.ua) { score += 25; why.push('User agent changed since this device was enrolled'); }
    if (!sig.secure) { score += 10; why.push('Plain HTTP connection (no TLS)'); }
    const knownIp = Object.values(u.devices).some((x) => x.ips && x.ips.includes(ip));
    if (Object.keys(u.devices).length && !knownIp) { score += 10; why.push('IP address not seen before'); }
    return { score: Math.min(100, score), why: why.length ? why : ['No risk signals'] };
  }
  function upsertDevice(ctx, u, raw) {
    const sig = deviceFrom(ctx, raw); if (!sig.id) return null;
    const prev = u.devices[sig.id]; const risk = riskOf(sig, prev, u, ctx.ip);
    const dv = prev || { id: sig.id, firstSeen: now(), status: 'active', trusted: false, ips: [] };
    Object.assign(dv, { name: sig.name, platform: sig.platform, mobile: sig.mobile, tz: sig.tz, screen: sig.screen, lastSeen: now(), risk });
    if (!prev) dv.ua = sig.ua; // the enrolment UA is kept as the baseline
    if (!dv.ips.includes(ctx.ip)) { dv.ips.push(ctx.ip); if (dv.ips.length > 5) dv.ips.shift(); }
    u.devices[sig.id] = dv; return { dv, isNew: !prev };
  }

  // Keeps the engine account in step with the customer's security state.
  function sync(u) {
    const S = state(); const a = S.accounts.get(u.acct); if (!a) return null;
    a.allowlistEnforced = true;
    a.allowlist = new Set(u.allowlist.filter((x) => x.activeAt <= now()).map((x) => x.address));
    for (const dv of Object.values(u.devices)) { if (dv.trusted && dv.status === 'active') a.knownDevices.add(dv.id); else a.knownDevices.delete(dv.id); }
    if (u.frozen) {
      const c = S.guardian.cases.find((x) => x.id === u.frozen.caseId);
      if (!c || c.status !== 'OPEN') {
        u.frozen = null; a.withdrawHold = false; save();
        audit('human:reviewer', 'RELEASE_WITHDRAWAL_FREEZE', u.acct, `Lost-device case ${c ? c.id + ' ' + c.status.toLowerCase() : 'closed'}`, 'APPLIED');
        event(u, 'Withdrawal freeze lifted after security review', 'good');
      } else a.withdrawHold = true;
    }
    return a;
  }
  const engineCtx = (ctx) => ({ ip: ctx.ip, device: ctx.s ? ctx.s.deviceId : undefined, source: 'mobile' });

  // ------------------------------------------------------------------ WebAuthn (passkeys): needs HTTPS (or localhost) and a domain name
  function newChallenge(s, type) { const v = b64u(crypto.randomBytes(32)); s.challenge = { v, type, exp: now() + 120000 }; return v; }
  function checkClientData(ctx, s, cdjB64, type) {
    let cd; try { cd = JSON.parse(fromB64u(cdjB64).toString('utf8')); } catch { return 'clientDataJSON unreadable'; }
    const ch = s.challenge; s.challenge = null;
    if (!ch || ch.exp < now() || ch.type !== type) return 'challenge expired';
    if (cd.type !== type || !safeEq(cd.challenge, ch.v)) return 'challenge mismatch';
    if (cd.origin !== ctx.origin) return `origin mismatch (${cd.origin})`;
    return null;
  }
  function checkAuthData(ctx, ad) {
    if (ad.length < 37) return { err: 'authenticatorData too short' };
    if (!sha(ctx.hostname).equals(ad.subarray(0, 32))) return { err: 'rpId mismatch' };
    const flags = ad[32]; if (!(flags & 0x01) || !(flags & 0x04)) return { err: 'user presence and verification required' };
    return { count: ad.readUInt32BE(33) };
  }
  function passkeyOptions(ctx, u, s) {
    return { ok: true, publicKey: { challenge: newChallenge(s, 'webauthn.get'), rpId: ctx.hostname, timeout: 60000, userVerification: 'required',
      allowCredentials: u.passkeys.map((k) => ({ type: 'public-key', id: k.id })) } };
  }
  function passkeyVerify(ctx, u, s, b) {
    const k = u.passkeys.find((x) => x.id === b.id); if (!k) return fail(401, 'PASSKEY_UNKNOWN', 'Passkey not registered for this account');
    const bad = checkClientData(ctx, s, b.clientDataJSON, 'webauthn.get'); if (bad) return fail(401, 'PASSKEY_INVALID', bad);
    const ad = fromB64u(b.authenticatorData); const r = checkAuthData(ctx, ad); if (r.err) return fail(401, 'PASSKEY_INVALID', r.err);
    let ok = false;
    try { ok = crypto.verify('sha256', Buffer.concat([ad, sha(fromB64u(b.clientDataJSON))]), crypto.createPublicKey({ key: fromB64u(k.spki), format: 'der', type: 'spki' }), fromB64u(b.signature)); } catch { ok = false; }
    if (!ok) return fail(401, 'PASSKEY_INVALID', 'Signature check failed');
    if ((r.count || k.signCount) && r.count <= k.signCount) return fail(401, 'PASSKEY_CLONED', 'Signature counter went backwards (possible cloned key)');
    k.signCount = r.count; k.lastUsed = now(); save(); return { ok: true };
  }

  // ------------------------------------------------------------------ views
  function sessionView(s) {
    if (!s) return null;
    return { id: s.id, state: s.state, username: s.username, deviceId: s.deviceId, scopes: SCOPES[s.state] || [], amr: s.amr, csrf: s.csrf,
      createdAt: s.createdAt, idleMs: IDLE_MS, idleRemainingMs: s.state === 'ACTIVE' ? Math.max(0, IDLE_MS - (now() - s.lastActivity)) : 0,
      expiresAt: s.createdAt + SESSION_MAX_MS };
  }
  function controls() {
    return [
      { layer: 'Customer identity', status: 'live', detail: `Password (scrypt) plus an authenticator code (TOTP, each code works once) or a verified passkey. ${MAX_FAILS} failures lock sign-in for ${LOCKOUT_MS / 60000} min and raise an alert.` },
      { layer: 'Session protection', status: 'live', detail: `Server-side session in an HttpOnly, SameSite=Strict cookie${tls ? ' (Secure)' : ''}; CSRF token; session ID rotated after MFA. The server locks it after ${IDLE_MS / 1000} s idle; resuming needs MFA.` },
      { layer: 'Lost-device response', status: 'live', detail: 'Report from any browser with password plus a recovery or authenticator code: signs out every device, removes passkeys, freezes withdrawals and opens a case for human review.' },
      { layer: 'Authorization', status: 'live', detail: 'Each session state has its own scopes (MFA pending, enrolment, active, locked). The account always comes from the session. The Guardian and staff are limited to pre-approved actions by the policy service.' },
      { layer: 'Trading protection', status: 'live', detail: 'Tick and lot checks, ±5% price band, maximum order value, per-account rate limit, atomic balance reservation, duplicate-safe clientOrderId.' },
      { layer: 'Withdrawal protection', status: 'live', detail: `A fresh authenticator code per withdrawal, allowlisted destinations only, ${COOLDOWN_MS / 1000} s cooling period on new addresses (24 h in production), per-transaction caps and a $${DAILY_LIMIT_USD.toLocaleString('en-US')} daily limit.` },
      { layer: 'Wallet custody', status: 'sim', detail: 'Separate BTC, ETH and USDC hot-wallet compartments with exposure caps, two independent human approvals and a mock MPC signer (Ops Console → Hot Wallets).' },
      { layer: 'Data and secrets', status: tls ? 'live' : 'partial', detail: `${tls ? 'This connection uses TLS.' : 'This connection is plain HTTP: start with --tls.'} User store encrypted at rest with AES-256-GCM (key: ${KEY_SRC}). Recovery codes and session tokens are stored only as SHA-256 hashes.` },
      { layer: 'Application and cloud', status: 'partial', detail: 'Strict CSP and security headers, origin checks, per-IP sign-in rate limits and a simulated WAF rule. WAF, IAM, scanning and protected deployments are AWS deployment tasks.' },
      { layer: 'Audit and monitoring', status: 'live', detail: 'Every sign-in, lock, device, address and withdrawal event goes to the audit log (Ops Console → Audit). Brute force, lost devices and risky devices open Guardian cases.' },
      { layer: 'Recovery', status: 'sim', detail: 'Multi-AZ failover, cross-Region DR drill and ledger reconciliation run in the simulator (Ops Console → Chaos & DR).' },
      { layer: 'AI Guardian', status: 'live', optional: true, detail: 'Screens every withdrawal asynchronously and opens cases for human review. It cannot sign: the policy service denies SIGN_TX.' },
      { layer: 'Device attestation', status: 'partial', optional: true, detail: 'Browser signals (automation flag, emulator hints, user-agent drift, insecure connection) give a device risk score; a high score blocks withdrawals. A native app would use App Attest or Play Integrity.' },
    ];
  }
  const usedUsd = (u) => { const t = now(); u.wdLog = (u.wdLog || []).filter((x) => x.ts > t - 86400e3); const S = state(); return u.wdLog.filter((x) => { const w = S.withdrawals.find((y) => y.id === x.id); return !w || w.status !== 'CANCELED'; }).reduce((s, x) => s + x.usd, 0); };
  const myOrders = new Map(); // username -> order ids placed from the app
  function home(ctx) {
    const { u, s } = ctx; const a = sync(u); const S = state();
    const prices = { BTC: S.markets.BTCUSDT.last, ETH: S.markets.ETHUSDT.last, USDT: 1, USDC: 1 };
    const ids = myOrders.get(u.username) || [];
    return {
      ok: true, session: sessionView(s), prices,
      markets: Object.fromEntries(Object.entries(S.markets).map(([k, m]) => [k, { ...tickerView(m), tick: m.tick, lot: m.lot, base: m.base, quote: m.quote, band: m.band, maxNotional: m.maxNotional, minNotional: m.minNotional }])),
      balances: balView(a),
      open: a.open.map((x) => S.orders.get(x)).filter(Boolean).map(orderView),
      history: ids.map((x) => S.orders.get(x)).filter((o) => o && o.status !== 'ACCEPTED' && o.status !== 'PARTIALLY_FILLED').slice(0, 15).map(orderView),
      withdrawals: S.withdrawals.filter((w) => w.acct === u.acct).slice(0, 20).map(wdView),
      flags: { tradingHold: a.tradingHold, withdrawHold: a.withdrawHold, stepUp: a.stepUp, frozen: u.frozen },
      limits: { dailyUsd: DAILY_LIMIT_USD, usedUsd: Math.round(usedUsd(u) * 100) / 100, perTx: Object.fromEntries(Object.values(S.wallets).map((w) => [w.asset, w.perTxCap])) },
      allowlist: u.allowlist.map((x) => ({ ...x, active: x.activeAt <= now(), activeInMs: Math.max(0, x.activeAt - now()) })),
      compartments: Object.values(S.wallets).map((w) => ({ asset: w.asset, network: w.network, paused: w.paused, pauseReason: w.pauseReason, exposurePct: Math.round((w.hot / w.cap) * 1000) / 10, perTxCap: w.perTxCap })),
      devices: Object.values(u.devices).map((x) => ({ id: x.id, name: x.name, platform: x.platform, status: x.status, trusted: x.trusted, firstSeen: x.firstSeen, lastSeen: x.lastSeen, ips: x.ips, risk: x.risk, current: x.id === s.deviceId })),
      passkeys: u.passkeys.map((k) => ({ id: k.id, name: k.name, createdAt: k.createdAt, lastUsed: k.lastUsed || null })),
      mfa: { totp: !!u.totp, recoveryLeft: u.recovery.length },
      events: (events.get(u.username) || []).slice(0, 30),
    };
  }

  // ------------------------------------------------------------------ handlers
  function activate(ctx, s, u, amr) {
    s.state = 'ACTIVE'; s.amr = ['pwd', amr]; s.mfaAt = now(); s.lastActivity = now(); s.fails = 0; rotate(ctx, s);
    u.fails = 0; const dv = u.devices[s.deviceId];
    const firstTrust = dv && !dv.trusted; if (dv) dv.trusted = true;
    const a = sync(u); if (a) a.knownIps.add(ctx.ip);
    audit(actor(u), 'LOGIN_SUCCESS', s.id, `MFA ${amr} · device ${dv ? dv.name : '?'} · ${ctx.ip}`, 'APPLIED');
    event(u, firstTrust ? `New device trusted after MFA: ${dv.name} (${ctx.ip})` : `Signed in on ${dv ? dv.name : 'device'} with ${amr === 'passkey' ? 'a passkey' : 'an authenticator code'}`, firstTrust ? 'warn' : 'good');
    save();
    return { ok: true, session: sessionView(s) };
  }
  const methodsFor = (u) => (u.recoveryRequired ? ['recovery'] : ['totp', ...(u.passkeys.length ? ['passkey'] : []), ...(u.recovery.length ? ['recovery'] : [])]);

  const H = {
    config: () => ({ ok: true, idleMs: IDLE_MS, tls, demoHint: DEMO_PW === DEFAULT_PW ? { username: 'demo', password: DEFAULT_PW } : null, controls: controls(), cooldownMs: COOLDOWN_MS, dailyLimitUsd: DAILY_LIMIT_USD }),

    login(ctx) {
      const b = ctx.body; if (!ipAllow(ctx.ip)) return fail(429, 'RATE_LIMITED', 'Too many sign-in attempts from this network. Wait a minute.');
      const u = DB.users[String(b.username || '').toLowerCase().trim()];
      const lo = u && lockedOut(u); if (lo) return lo;
      const ok = checkPw(b.password, u ? u.pw : DUMMY_HASH); // constant work even for unknown users
      if (!u || !ok) { if (u) registerFail(u, ctx, 'password'); return fail(401, 'INVALID_CREDENTIALS', 'Wrong username or password'); }
      const d = upsertDevice(ctx, u, b.device); if (!d) return fail(400, 'DEVICE_ID', 'Missing device identifier');
      if (d.dv.status !== 'active') { save(); audit(actor(u), 'LOGIN_BLOCKED', d.dv.id, `device ${d.dv.status}`, 'DENIED'); return fail(403, 'DEVICE_REVOKED', `This device was ${d.dv.status === 'lost' ? 'reported lost' : 'revoked'}. Use another device, or register this browser as a new device.`); }
      u.fails = 0; save();
      const next = u.totp && !u.recoveryRequired ? 'mfa' : (u.recoveryRequired ? 'mfa' : 'enroll');
      const s = createSession(ctx, u, d.dv.id, next === 'mfa' ? 'MFA_PENDING' : 'ENROLL');
      audit(actor(u), 'LOGIN_PASSWORD_OK', s.id, `${d.isNew ? 'new' : 'known'} device ${d.dv.name} · ${ctx.ip} · risk ${d.dv.risk.score}`, 'APPLIED');
      return { ok: true, next, methods: methodsFor(u), newDevice: d.isNew, session: sessionView(s), recoveryRequired: !!u.recoveryRequired };
    },

    mfaTotp(ctx) {
      const { u, s } = ctx; const lo = lockedOut(u); if (lo) return lo;
      if (u.recoveryRequired || !u.totp) return fail(400, 'RECOVERY_REQUIRED', 'Use a recovery code to set up a new authenticator');
      const r = totpCheck(u.totp, u.lastStep, ctx.body.code);
      if (!r.ok) { if (r.reason !== 'CODE_FORMAT') { s.fails++; registerFail(u, ctx, 'MFA'); if (s.fails >= 5) endSession(s, 'too many MFA failures'); } return r; }
      u.lastStep = r.step; return activate(ctx, s, u, 'otp');
    },
    mfaRecovery(ctx) {
      const { u, s } = ctx; const lo = lockedOut(u); if (lo) return lo;
      if (!useRecovery(u, ctx.body.code)) { s.fails++; registerFail(u, ctx, 'recovery code'); if (s.fails >= 5) endSession(s, 'too many recovery failures'); return fail(401, 'CODE_INVALID', 'Recovery code not valid'); }
      s.state = 'ENROLL'; s.viaRecovery = true; rotate(ctx, s); save();
      audit(actor(u), 'RECOVERY_CODE_USED', s.id, `${u.recovery.length} left · new authenticator required`, 'APPLIED');
      event(u, `Recovery code used (${u.recovery.length} left). Set up a new authenticator.`, 'warn');
      return { ok: true, next: 'enroll', session: sessionView(s) };
    },
    mfaPasskeyOptions(ctx) { if (!ctx.u.passkeys.length || ctx.u.recoveryRequired) return fail(400, 'NO_PASSKEY', 'No passkey available'); return passkeyOptions(ctx, ctx.u, ctx.s); },
    mfaPasskey(ctx) {
      const { u, s } = ctx; const lo = lockedOut(u); if (lo) return lo;
      const r = passkeyVerify(ctx, u, s, ctx.body); if (!r.ok) { s.fails++; registerFail(u, ctx, 'passkey'); return r; }
      return activate(ctx, s, u, 'passkey');
    },

    enrollStart(ctx) {
      const s = ctx.s; s.enrollSecret = b32enc(crypto.randomBytes(20));
      const label = encodeURIComponent('SAIFE:' + s.username);
      return { ok: true, secret: s.enrollSecret, otpauth: `otpauth://totp/${label}?secret=${s.enrollSecret}&issuer=SAIFE&algorithm=SHA1&digits=6&period=30` };
    },
    enrollVerify(ctx) {
      const { u, s } = ctx; if (!s.enrollSecret) return fail(400, 'NO_ENROLMENT', 'Start enrolment first');
      const r = totpCheck(s.enrollSecret, 0, ctx.body.code);
      if (!r.ok) { if (r.reason !== 'CODE_FORMAT' && ++s.fails >= 5) endSession(s, 'too many enrolment failures'); return r; }
      u.totp = s.enrollSecret; u.lastStep = r.step; u.recoveryRequired = false; s.enrollSecret = null;
      const codes = newRecoveryCodes(); u.recovery = codes.map((c) => shaHex('rc:' + normRc(c)));
      audit(actor(u), 'MFA_ENROLLED', u.username, 'TOTP authenticator registered; 8 recovery codes issued', 'APPLIED');
      event(u, 'Authenticator app turned on and recovery codes issued', 'good');
      const out = activate(ctx, s, u, 'otp');
      return { ...out, recoveryCodes: codes };
    },

    session: (ctx) => ({ ok: true, session: sessionView(ctx.s) }),
    logout(ctx) { if (ctx.s) { const u = DB.users[ctx.s.username]; endSession(ctx.s); if (u) { audit(actor(u), 'LOGOUT', ctx.s.id, 'user signed out', 'APPLIED'); event(u, 'Signed out'); } } ctx.res.setHeader('Set-Cookie', cookie('', 0)); return { ok: true }; },
    activity: (ctx) => ({ ok: true, session: sessionView(ctx.s) }),
    lockNow(ctx) { lock(ctx.s, 'manual'); return { ok: true, session: sessionView(ctx.s) }; },
    unlock(ctx) {
      const { u, s } = ctx; const r = totpCheck(u.totp, u.lastStep, ctx.body.code);
      if (!r.ok) { if (r.reason !== 'CODE_FORMAT') { s.fails++; registerFail(u, ctx, 'unlock'); if (s.fails >= 5) { endSession(s, 'too many unlock failures'); return fail(401, 'UNAUTHENTICATED', 'Too many attempts. Sign in again.'); } } return r; }
      u.lastStep = r.step; save(); return resume(ctx, 'otp');
    },
    unlockPasskeyOptions(ctx) { if (!ctx.u.passkeys.length) return fail(400, 'NO_PASSKEY', 'No passkey registered'); return passkeyOptions(ctx, ctx.u, ctx.s); },
    unlockPasskey(ctx) { const r = passkeyVerify(ctx, ctx.u, ctx.s, ctx.body); if (!r.ok) { ctx.s.fails++; registerFail(ctx.u, ctx, 'unlock'); return r; } return resume(ctx, 'passkey'); },

    home,

    order(ctx) {
      const { u } = ctx; sync(u); const b = ctx.body;
      const req = { market: b.market, side: b.side, type: b.type, qty: Number(b.qty), price: b.price != null && b.price !== '' ? Number(b.price) : undefined, tif: b.tif, clientOrderId: b.clientOrderId };
      const r = placeOrder(u.acct, req, engineCtx(ctx)); // any account field in the body is ignored
      if (!r.ok) return r;
      if (!r.duplicate) { let l = myOrders.get(u.username); if (!l) myOrders.set(u.username, (l = [])); l.unshift(r.order.id); if (l.length > 60) l.length = 60; }
      return { ok: true, duplicate: !!r.duplicate, queued: !!r.queued, account: u.acct, order: orderView(r.order) };
    },
    cancel(ctx, m) { const r = cancelOrder(ctx.u.acct, m[1], engineCtx(ctx)); return r.ok ? { ok: true, order: orderView(r.order) } : r; },

    withdraw(ctx) {
      const { u, s } = ctx; const b = ctx.body; const a = sync(u); const S = state();
      const asset = String(b.asset || ''); const amount = Number(b.amount); const address = String(b.address || '');
      if (u.frozen) return fail(403, 'ACCOUNT_FROZEN', `Withdrawals are frozen while ${u.frozen.caseId} (lost device) is reviewed`);
      if (!S.wallets[asset]) return fail(400, 'UNSUPPORTED_ASSET', 'Withdrawals supported for BTC, ETH and USDC');
      if (!(amount > 0)) return fail(400, 'INVALID_AMOUNT', 'Enter an amount');
      const entry = u.allowlist.find((x) => x.address === address && x.asset === asset);
      if (!entry) { audit(actor(u), 'WITHDRAWAL_BLOCKED', address, 'destination not allowlisted', 'DENIED'); return fail(403, 'NOT_ALLOWLISTED', 'Destination is not on your address allowlist'); }
      if (entry.activeAt > now()) return fail(403, 'ALLOWLIST_COOLING', `New address is in its security cooling period for ${Math.ceil((entry.activeAt - now()) / 1000)} s more`);
      const value = usd(asset, amount); const used = usedUsd(u);
      if (used + value > DAILY_LIMIT_USD) return fail(403, 'DAILY_LIMIT', `Above your daily withdrawal limit: $${Math.round(DAILY_LIMIT_USD - used).toLocaleString('en-US')} left today`);
      const dv = u.devices[s.deviceId];
      if (dv && dv.risk && dv.risk.score >= 60) {
        openCase({ rule: 'DEVICE_INTEGRITY_RISK', title: 'Withdrawal attempt from high-risk device', severity: 'high', accounts: [u.acct],
          summary: `Device ${dv.name} risk ${dv.risk.score}/100 (${dv.risk.why.join('; ')}) tried to withdraw ${amount} ${asset}`,
          explanation: ['Device integrity signals suggest automation or emulation', 'Withdrawal refused; trading unaffected', 'Human review before the device is trusted again'],
          features: { newDevice: true, usd: value }, actions: [['ALERT', u.acct]] });
        return fail(403, 'DEVICE_RISK', 'Withdrawals are blocked on this device (integrity risk). Use your enrolled phone.');
      }
      if (!b.code) return fail(401, 'STEP_UP_REQUIRED', 'Confirm with a code from your authenticator app');
      const t = totpCheck(u.totp, u.lastStep, b.code);
      if (!t.ok) { if (t.reason !== 'CODE_FORMAT') registerFail(u, ctx, 'step-up'); return t; }
      u.lastStep = t.step;
      if (a.stepUp) { // a fresh MFA satisfies a Guardian step-up request
        a.stepUp = false;
        for (const w of S.withdrawals) if (w.acct === u.acct && w.status === 'HELD_STEP_UP') { w.guardianHold = false; w.status = 'SCREENING'; w.holdUntil = now(); w.reasons.push('Step-up (TOTP) passed in the mobile app'); }
      }
      const r = requestWithdrawal(u.acct, { asset, amount, address, memo: b.memo }, engineCtx(ctx));
      if (!r.ok) { save(); return r; }
      u.wdLog.push({ ts: now(), usd: value, id: r.withdrawal.id }); save();
      audit(actor(u), 'WITHDRAWAL_STEP_UP_OK', r.withdrawal.id, `${amount} ${asset} to allowlisted ${entry.label} · TOTP`, 'APPLIED');
      event(u, `Withdrawal of ${amount} ${asset} to ${entry.label} submitted for screening`);
      return { ok: true, withdrawal: wdView(r.withdrawal) };
    },
    allowAdd(ctx) {
      const { u } = ctx; const b = ctx.body; const asset = String(b.asset || ''); const address = clean(b.address, 80).trim(); const label = clean(b.label, 30).trim() || 'New address';
      if (!['BTC', 'ETH', 'USDC'].includes(asset)) return fail(400, 'UNSUPPORTED_ASSET', 'Choose BTC, ETH or USDC');
      const re = asset === 'BTC' ? /^(bc1|[13])[A-Za-z0-9-]{8,78}$/ : /^0x[A-Za-z0-9-]{6,78}$/;
      if (!re.test(address)) return fail(400, 'BAD_ADDRESS', asset === 'BTC' ? 'Bitcoin addresses start with bc1, 1 or 3' : 'Ethereum addresses start with 0x');
      if (u.allowlist.some((x) => x.asset === asset && x.address === address)) return fail(409, 'EXISTS', 'Address already on your allowlist');
      if (u.allowlist.length >= 12) return fail(400, 'LIMIT', 'Allowlist is full');
      const t = totpCheck(u.totp, u.lastStep, b.code); if (!t.ok) { if (t.reason !== 'CODE_FORMAT') registerFail(u, ctx, 'step-up'); return t; }
      u.lastStep = t.step;
      u.allowlist.push({ asset, address, label, addedAt: now(), activeAt: now() + COOLDOWN_MS }); save();
      audit(actor(u), 'ALLOWLIST_ADD', address, `${asset} · ${label} · active after ${COOLDOWN_MS / 1000} s cooling period`, 'APPLIED');
      event(u, `New ${asset} address "${label}" added. Usable in ${COOLDOWN_MS / 1000} s.`, 'warn');
      return { ok: true };
    },
    allowRemove(ctx) {
      const { u } = ctx; const i = u.allowlist.findIndex((x) => x.asset === ctx.body.asset && x.address === ctx.body.address);
      if (i < 0) return fail(404, 'NOT_FOUND', 'Address not found');
      const [x] = u.allowlist.splice(i, 1); save(); audit(actor(u), 'ALLOWLIST_REMOVE', x.address, x.asset, 'APPLIED'); event(u, `Address "${x.label}" removed`);
      return { ok: true };
    },
    revokeDevice(ctx) {
      const { u, s } = ctx; const dv = u.devices[ctx.body.deviceId];
      if (!dv) return fail(404, 'NOT_FOUND', 'Device not found');
      if (dv.id === s.deviceId) return fail(400, 'CURRENT_DEVICE', 'To remove this device, sign out instead');
      dv.status = 'revoked'; let n = 0; for (const x of [...sessions.values()]) if (x.username === u.username && x.deviceId === dv.id) { endSession(x, 'device revoked by owner'); n++; }
      sync(u); save(); audit(actor(u), 'DEVICE_REVOKED', dv.id, `${dv.name}; ${n} session(s) ended`, 'APPLIED'); event(u, `Device ${dv.name} revoked`, 'warn');
      return { ok: true, sessionsEnded: n };
    },
    passkeyRegOptions(ctx) {
      const { u, s } = ctx;
      return { ok: true, publicKey: { challenge: newChallenge(s, 'webauthn.create'), rp: { id: ctx.hostname, name: 'SAIFE' },
        user: { id: b64u(sha('user:' + u.username).subarray(0, 16)), name: u.username, displayName: u.username },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], timeout: 60000, attestation: 'none',
        authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' }, excludeCredentials: u.passkeys.map((k) => ({ type: 'public-key', id: k.id })) } };
    },
    passkeyRegister(ctx) {
      const { u, s } = ctx; const b = ctx.body;
      const bad = checkClientData(ctx, s, b.clientDataJSON, 'webauthn.create'); if (bad) return fail(400, 'PASSKEY_INVALID', bad);
      const r = checkAuthData(ctx, fromB64u(b.authenticatorData)); if (r.err) return fail(400, 'PASSKEY_INVALID', r.err);
      if (![-7, -257].includes(Number(b.alg))) return fail(400, 'PASSKEY_ALG', 'Unsupported key type');
      try { crypto.createPublicKey({ key: fromB64u(b.publicKey), format: 'der', type: 'spki' }); } catch { return fail(400, 'PASSKEY_INVALID', 'Public key unreadable'); }
      if (!/^[A-Za-z0-9_-]{16,512}$/.test(b.id || '')) return fail(400, 'PASSKEY_INVALID', 'Bad credential id');
      if (u.passkeys.length >= 5) return fail(400, 'LIMIT', 'Up to 5 passkeys');
      const dv = u.devices[s.deviceId];
      u.passkeys.push({ id: b.id, spki: b.publicKey, alg: Number(b.alg), signCount: r.count, name: clean(b.name, 30) || (dv ? dv.name : 'Passkey'), deviceId: s.deviceId, createdAt: now() }); save();
      audit(actor(u), 'PASSKEY_REGISTERED', b.id.slice(0, 16), 'WebAuthn, user verification required', 'APPLIED'); event(u, 'Passkey added', 'good');
      return { ok: true };
    },
    passkeyRemove(ctx) {
      const { u } = ctx; const i = u.passkeys.findIndex((k) => k.id === ctx.body.id); if (i < 0) return fail(404, 'NOT_FOUND', 'Passkey not found');
      u.passkeys.splice(i, 1); save(); audit(actor(u), 'PASSKEY_REMOVED', String(ctx.body.id).slice(0, 16), '', 'APPLIED'); event(u, 'Passkey removed', 'warn'); return { ok: true };
    },

    // Public: a customer whose phone is lost reports it from any browser.
    lostDevice(ctx) {
      const b = ctx.body; if (!ipAllow(ctx.ip, 10)) return fail(429, 'RATE_LIMITED', 'Too many attempts from this network. Wait a minute.');
      const u = DB.users[String(b.username || '').toLowerCase().trim()];
      const lo = u && lockedOut(u); if (lo) return lo;
      const pwOk = checkPw(b.password, u ? u.pw : DUMMY_HASH);
      if (!u || !pwOk) { if (u) registerFail(u, ctx, 'lost-device verification'); return fail(401, 'INVALID_CREDENTIALS', 'Could not verify your identity'); }
      let via;
      if (b.method === 'totp') { const t = u.totp && !u.recoveryRequired ? totpCheck(u.totp, u.lastStep, b.code) : fail(401, 'CODE_INVALID', 'No authenticator on file'); if (!t.ok) { registerFail(u, ctx, 'lost-device verification'); return fail(401, 'CODE_INVALID', 'Could not verify your identity'); } u.lastStep = t.step; via = 'authenticator code'; }
      else { if (!useRecovery(u, b.code)) { registerFail(u, ctx, 'lost-device verification'); return fail(401, 'CODE_INVALID', 'Could not verify your identity'); } via = 'recovery code'; }
      let ended = 0; for (const x of [...sessions.values()]) if (x.username === u.username) { endSession(x, 'lost device reported'); ended++; }
      let marked = 0; for (const dv of Object.values(u.devices)) if (dv.status === 'active') { dv.status = 'lost'; dv.trusted = false; marked++; }
      const passkeys = u.passkeys.length; u.passkeys = [];
      const totpReset = via === 'recovery code'; // the authenticator is assumed to be on the lost phone
      if (totpReset) { u.totp = null; u.recoveryRequired = true; }
      const S = state();
      const pending = S.withdrawals.filter((w) => w.acct === u.acct && ['SCREENING', 'QUEUED_LIQUIDITY', 'HELD_POLICY', 'HELD_FALLBACK'].includes(w.status)).map((w) => w.id);
      const c = openCase({ rule: 'LOST_DEVICE_REPORTED', title: 'Customer reported a lost or stolen device', severity: 'high', accounts: [u.acct], withdrawalIds: pending,
        summary: `${u.username} verified with password + ${via} from ${ctx.ip}: ${ended} session(s) revoked, ${marked} device(s) marked lost, ${passkeys} passkey(s) removed${totpReset ? ', authenticator reset' : ''}`,
        explanation: ['Identity verified (password + second factor) before any action', 'Every session and device revoked; passkeys removed', 'Withdrawals frozen until a reviewer closes this case (Confirm also cancels pending withdrawals)', 'Trading and balances are untouched'],
        features: { newDevice: true }, actions: [['ALERT', u.acct], ['HOLD_WITHDRAWALS', u.acct], ...pending.map((id) => ['HOLD_WITHDRAWAL', id])] });
      u.frozen = { caseId: c.id, at: now() }; sync(u); save();
      audit(actor(u), 'LOST_DEVICE_REPORTED', u.acct, `verified via ${via}; case ${c.id}`, 'APPLIED');
      event(u, `Lost device reported: all sessions signed out, withdrawals frozen (${c.id})`, 'bad');
      return { ok: true, caseId: c.id, sessionsEnded: ended, devicesMarked: marked, passkeysRemoved: passkeys, totpReset, pendingHeld: pending.length, recoveryLeft: u.recovery.length };
    },
  };
  function resume(ctx, how) {
    const { u, s } = ctx; s.state = 'ACTIVE'; s.lastActivity = now(); s.fails = 0; rotate(ctx, s);
    audit(actor(u), 'SESSION_UNLOCKED', s.id, `re-authenticated with ${how}`, 'APPLIED'); event(u, 'Session unlocked', 'good');
    return { ok: true, session: sessionView(s) };
  }

  // [method, path, scope, handler]. scope: 'public' = no session; 'any' = any session state.
  const ROUTES = [
    ['GET', '/api/m/config', 'public', H.config],
    ['POST', '/api/m/login', 'public', H.login],
    ['POST', '/api/m/lost-device', 'public', H.lostDevice],
    ['GET', '/api/m/session', 'any', H.session],
    ['POST', '/api/m/logout', 'any', H.logout],
    ['POST', '/api/m/mfa/totp', 'mfa', H.mfaTotp],
    ['POST', '/api/m/mfa/recovery', 'mfa', H.mfaRecovery],
    ['POST', '/api/m/mfa/passkey/options', 'mfa', H.mfaPasskeyOptions],
    ['POST', '/api/m/mfa/passkey', 'mfa', H.mfaPasskey],
    ['POST', '/api/m/enroll/start', 'enroll', H.enrollStart],
    ['POST', '/api/m/enroll/verify', 'enroll', H.enrollVerify],
    ['POST', '/api/m/unlock', 'unlock', H.unlock],
    ['POST', '/api/m/unlock/passkey/options', 'unlock', H.unlockPasskeyOptions],
    ['POST', '/api/m/unlock/passkey', 'unlock', H.unlockPasskey],
    ['POST', '/api/m/activity', 'read', H.activity],
    ['POST', '/api/m/lock', 'read', H.lockNow],
    ['GET', '/api/m/home', 'read', H.home],
    ['POST', '/api/m/orders', 'trade', H.order],
    ['DELETE', /^\/api\/m\/orders\/([\w-]+)$/, 'trade', H.cancel],
    ['POST', '/api/m/withdrawals', 'withdraw', H.withdraw],
    ['POST', '/api/m/allowlist', 'withdraw', H.allowAdd],
    ['POST', '/api/m/allowlist/remove', 'withdraw', H.allowRemove],
    ['POST', '/api/m/devices/revoke', 'security', H.revokeDevice],
    ['POST', '/api/m/passkeys/options', 'security', H.passkeyRegOptions],
    ['POST', '/api/m/passkeys', 'security', H.passkeyRegister],
    ['POST', '/api/m/passkeys/remove', 'security', H.passkeyRemove],
  ];

  async function handle(req, res, url) {
    const p = url.pathname; const method = req.method; let m = null;
    const route = ROUTES.find((r) => r[0] === method && (typeof r[1] === 'string' ? r[1] === p : (m = r[1].exec(p))));
    if (!route) return send(res, 404, { ok: false, reason: 'NOT_FOUND' });
    const host = String(req.headers.host || 'localhost');
    const ctx = { req, res, ip: String(req.socket.remoteAddress || '').replace(/^::ffff:/, ''), origin: `${tls ? 'https' : 'http'}://${host}`, hostname: host.replace(/:\d+$/, '').replace(/^\[|\]$/g, ''), body: {} };
    if (method !== 'GET') {
      const o = req.headers.origin; if (o && o !== ctx.origin) return send(res, 403, { ok: false, reason: 'BAD_ORIGIN', message: 'Cross-origin request refused' });
      if (!/^application\/json/i.test(req.headers['content-type'] || '')) return send(res, 415, { ok: false, reason: 'JSON_REQUIRED', message: 'Content-Type must be application/json' });
      const body = await readBody(req); if (body === null || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { ok: false, reason: 'BAD_JSON' });
      ctx.body = body;
    }
    const scope = route[2];
    if (scope !== 'public') {
      const s = getSession(req);
      if (!s) { if (route[3] === H.logout) return send(res, 200, H.logout(ctx)); return send(res, 401, { ok: false, reason: 'UNAUTHENTICATED', message: 'Please sign in' }); }
      if (method !== 'GET' && !safeEq(req.headers['x-csrf-token'], s.csrf)) {
        audit('cust:' + s.username, 'CSRF_REJECTED', p, 'missing or wrong CSRF token', 'DENIED');
        return send(res, 403, { ok: false, reason: 'CSRF_FAILED', message: 'Missing or invalid CSRF token' });
      }
      if (scope !== 'any' && !(SCOPES[s.state] || []).includes(scope)) {
        if (s.state === 'LOCKED' && ACTIVE_SCOPES.has(scope)) return send(res, 423, { ok: false, reason: 'SESSION_LOCKED', message: 'Session locked. Verify to continue.' });
        audit('cust:' + s.username, 'SCOPE_DENIED', p, `session state ${s.state} lacks '${scope}'`, 'DENIED');
        return send(res, 403, { ok: false, reason: 'FORBIDDEN_SCOPE', message: `Not allowed in state ${s.state}` });
      }
      if (method !== 'GET' && ACTIVE_SCOPES.has(scope)) s.lastActivity = now(); // reads (polling) never keep a session alive
      ctx.s = s; ctx.u = DB.users[s.username];
    }
    const r = await route[3](ctx, m);
    if (r.ok) return send(res, 200, r);
    const { ok, code, edge, ...rest } = r; // eslint-disable-line no-unused-vars
    return send(res, code || 400, { ok: false, ...rest });
  }

  return { handle, ACCT };
};
