// SAIFE mobile app mockup. Talks only to /api/m/* (see mobile-api.js). No inline script, CSP-safe DOM building.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const T = window.SaifeTOTP;
  const ASSET_NAMES = { BTC: 'Bitcoin', ETH: 'Ether', USDT: 'Tether USD', USDC: 'USD Coin' };
  const st = {
    cfg: {}, csrf: '', session: null, home: null, screen: 'login', tab: 'home', locked: false, poll: null, deadline: 0, idleMs: 60000,
    market: 'BTCUSDT', side: 'BUY', otype: 'MARKET', lostMethod: 'recovery', codes: [], username: '', expanded: new Set(), deviceId: '', memAuth: null, addrSig: '',
  };

  // ---------------------------------------------------------------- helpers
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || (v === false && k !== 'spellcheck')) continue;
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k.startsWith('data-') || k.startsWith('aria-')) el.setAttribute(k, v);
      else if (k in el) el[k] = v; else el.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }
  const fmtUsd = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dp = (a) => (a === 'BTC' ? 6 : a === 'ETH' ? 5 : 2);
  const fmtAmt = (a, n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: dp(a) });
  const fmtPx = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ago = (ts) => { const s = Math.max(0, Math.round((Date.now() - ts) / 1000)); if (s < 60) return s + ' s ago'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return new Date(ts).toLocaleDateString(); };
  const tm = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const short = (a) => (a.length > 18 ? a.slice(0, 9) + '…' + a.slice(-6) : a);
  const decimals = (step) => { const s = String(step); return s.includes('.') ? s.split('.')[1].length : 0; };
  const roundTo = (x, step) => (Math.round(x / step) * step).toFixed(decimals(step));
  const floorTo = (x, step) => (Math.floor(x / step + 1e-9) * step).toFixed(decimals(step));
  const randHex = (n) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); };
  function setMsg(id, text, ok) { const el = $(id); el.textContent = text || ''; el.classList.toggle('ok', !!ok); }
  function toast(text, kind = '') { const el = $('toast'); el.textContent = text; el.className = 'toast ' + kind; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 3600); }
  async function copyText(text) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch { /* fall back */ }
    const ta = h('textarea', { value: text, readOnly: true }); ta.className = 'offscreen'; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove(); return ok;
  }
  const kv = (k, v, cls) => h('div', { class: 'kv' }, h('span', { text: k }), h('span', { class: cls || '', text: v }));
  const passkeyOk = () => !!(window.PublicKeyCredential && window.isSecureContext) && !/^(\d{1,3}\.){3}\d{1,3}$|^\[/.test(location.hostname);
  const b64u = {
    enc: (buf) => { const b = new Uint8Array(buf); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
    dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)),
  };

  // ---------------------------------------------------------------- device identity + integrity signals
  function loadDeviceId() { let id = null; try { id = localStorage.getItem('saife.deviceId'); } catch { id = null; } return /^[a-f0-9]{32}$/.test(id || '') ? id : newDeviceId(); }
  function newDeviceId() { const id = randHex(16); try { localStorage.setItem('saife.deviceId', id); } catch { /* private mode */ } st.deviceId = id; return id; }
  function deviceInfo() {
    const ua = navigator.userAgent;
    const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux PC' : 'Device';
    const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { tz = ''; }
    return { id: st.deviceId, name: `${kind} · ${br}`, platform: (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '',
      mobile: /Mobi|Android|iPhone|iPad/.test(ua), touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0, webdriver: !!navigator.webdriver,
      secure: !!window.isSecureContext, tz, screen: `${screen.width}x${screen.height}` };
  }

  // ---------------------------------------------------------------- API
  async function api(method, path, body, opts = {}) {
    const o = { method, credentials: 'same-origin', headers: {}, cache: 'no-store' };
    if (method !== 'GET') { o.headers['Content-Type'] = 'application/json'; if (!opts.noCsrf) o.headers['X-CSRF-Token'] = st.csrf || ''; o.body = JSON.stringify(body || {}); }
    let r; let j;
    try { r = await fetch('/api/m/' + path, o); j = await r.json().catch(() => ({})); }
    catch { return { ok: false, status: 0, reason: 'NETWORK', message: 'Network error. Check your connection.' }; }
    j.status = r.status;
    if (j.session) applySession(j.session);
    if (r.status === 423 && j.reason === 'SESSION_LOCKED') showLock();
    else if (r.status === 401 && j.reason === 'UNAUTHENTICATED' && st.screen === 'main') sessionEnded(j.message === 'Please sign in' ? 'Your session ended. Sign in again.' : j.message);
    return j;
  }
  function applySession(s) {
    st.session = s; if (s.csrf) st.csrf = s.csrf; if (s.username) st.username = s.username;
    if (s.state === 'ACTIVE') { st.idleMs = s.idleMs; st.deadline = Date.now() + s.idleRemainingMs; }
    if (s.state === 'LOCKED' && st.screen === 'main') showLock();
  }

  // ---------------------------------------------------------------- navigation
  function go(name) {
    st.screen = name;
    for (const el of document.querySelectorAll('.screen')) el.hidden = el.dataset.screen !== name;
    if (name !== 'main') { stopPoll(); $('lock').hidden = true; st.locked = false; closeSheet(); }
    if (name === 'login') { $('loginBtn').disabled = false; setTimeout(() => (st.username ? $('loginPw') : $('loginUser')).focus(), 50); }
  }
  function route(s, info) {
    if (!s) return go('login');
    if (s.state === 'ACTIVE') return enterMain();
    if (s.state === 'LOCKED') { enterMain(); return showLock(); }
    if (s.state === 'MFA_PENDING') return showMfa(info || { methods: ['totp', 'recovery'] });
    if (s.state === 'ENROLL') return showEnroll();
    return go('login');
  }
  function sessionEnded(msg) { clearMain(); st.csrf = ''; st.session = null; go('login'); setMsg('loginMsg', msg || ''); }
  function clearMain() {
    stopPoll(); st.home = null;
    for (const id of ['mktList', 'assetList', 'recentList', 'openList', 'histList', 'addrList', 'wdList', 'custList', 'pkList', 'devList', 'checkList', 'evList', 'banners']) $(id).replaceChildren();
    $('evFeed').replaceChildren(h('li', { class: 'muted', text: 'Sign in to see events.' })); $('evCount').textContent = '';
    $('pfTotal').textContent = '$–'; $('pfSub').textContent = '';
  }

  // ---------------------------------------------------------------- login
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); setMsg('loginMsg', '');
    const username = $('loginUser').value.trim(); const password = $('loginPw').value;
    if (!username || !password) return setMsg('loginMsg', 'Enter your username and password');
    $('loginBtn').disabled = true;
    const r = await api('POST', 'login', { username, password, device: deviceInfo() });
    $('loginBtn').disabled = false;
    if (!r.ok) {
      setMsg('loginMsg', r.message || 'Sign-in failed');
      if (r.reason === 'DEVICE_REVOKED') {
        $('loginMsg').append(' ', h('button', { class: 'mini', type: 'button', text: 'Register as a new device', on: { click: () => { newDeviceId(); setMsg('loginMsg', 'New device ID created. Sign in again. MFA is required before it is trusted.', true); } } }));
      }
      return;
    }
    $('loginPw').value = ''; st.username = username;
    if (r.next === 'enroll') showEnroll(); else showMfa(r);
  });
  $('hintFill').addEventListener('click', () => { const d = st.cfg.demoHint; if (!d) return; $('loginUser').value = d.username; $('loginPw').value = d.password; $('loginBtn').focus(); });

  // ---------------------------------------------------------------- MFA
  function showMfa(r) {
    go('mfa'); const methods = r.methods || ['totp'];
    const recoveryOnly = r.recoveryRequired || (methods.length === 1 && methods[0] === 'recovery');
    $('mfaNewDevice').hidden = !r.newDevice;
    $('mfaPasskeyBtn').hidden = !(methods.includes('passkey') && passkeyOk());
    $('mfaUseRecovery').hidden = !methods.includes('recovery');
    $('mfaUseTotp').hidden = recoveryOnly;
    $('mfaRecoveryLead').textContent = recoveryOnly
      ? 'Your authenticator was reset after a lost-device report. Enter one of your recovery codes to set up a new one.'
      : 'Enter one of your recovery codes. You will then set up a new authenticator.';
    showMfaBox(recoveryOnly ? 'recovery' : 'totp');
  }
  function showMfaBox(which) {
    $('mfaTotpBox').hidden = which !== 'totp'; $('mfaRecoveryBox').hidden = which !== 'recovery';
    setMsg('mfaMsg', ''); setMsg('recoveryMsg', ''); $('mfaCode').value = ''; $('recoveryCode').value = '';
    setTimeout(() => $(which === 'totp' ? 'mfaCode' : 'recoveryCode').focus(), 50);
  }
  $('mfaUseRecovery').addEventListener('click', () => showMfaBox('recovery'));
  $('mfaUseTotp').addEventListener('click', () => showMfaBox('totp'));
  function endedDuringLogin(r) { if (r.status === 401 && r.reason === 'UNAUTHENTICATED') { go('login'); setMsg('loginMsg', 'Too many attempts or sign-in timed out. Start again.'); return true; } return false; }
  $('mfaForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const code = $('mfaCode').value.replace(/\D/g, '');
    const r = await api('POST', 'mfa/totp', { code });
    if (r.ok) return enterMain();
    if (endedDuringLogin(r)) return;
    $('mfaCode').value = ''; setMsg('mfaMsg', r.message || 'Verification failed');
  });
  $('mfaCode').addEventListener('input', () => { const v = $('mfaCode').value.replace(/\D/g, ''); $('mfaCode').value = v; if (v.length === 6) $('mfaForm').requestSubmit(); });
  $('recoveryForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const r = await api('POST', 'mfa/recovery', { code: $('recoveryCode').value });
    if (r.ok) return showEnroll();
    if (endedDuringLogin(r)) return;
    setMsg('recoveryMsg', r.message || 'Recovery code not accepted');
  });
  $('mfaPasskeyBtn').addEventListener('click', async () => {
    const r = await passkeyAssert('mfa/passkey/options', 'mfa/passkey');
    if (r.ok) return enterMain();
    if (endedDuringLogin(r)) return;
    setMsg('mfaMsg', r.message || 'Passkey sign-in failed');
  });

  // ---------------------------------------------------------------- enrolment
  async function showEnroll() {
    go('enroll'); $('enrollStep1').hidden = false; $('enrollStep2').hidden = true; setMsg('enrollMsg', ''); $('enrollCode').value = ''; $('enrollKey').textContent = '…';
    const r = await api('POST', 'enroll/start');
    if (!r.ok) { if (!endedDuringLogin(r)) setMsg('enrollMsg', r.message || 'Could not start enrolment'); return; }
    st.pendingSecret = r.secret; $('enrollKey').textContent = r.secret.match(/.{1,4}/g).join(' '); $('enrollOpen').href = r.otpauth;
  }
  $('enrollCopy').addEventListener('click', async () => toast((await copyText(st.pendingSecret || '')) ? 'Setup key copied' : 'Copy failed. Select the key and copy it.', 'good'));
  $('enrollDemo').addEventListener('click', () => {
    if (!st.pendingSecret) return;
    authSet({ secret: st.pendingSecret, user: st.username || 'demo', added: Date.now() });
    toast('Added. The demo authenticator now shows codes for this key.', 'good');
    if (matchMedia('(max-width: 760px)').matches) openDrawer();
  });
  $('enrollForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const r = await api('POST', 'enroll/verify', { code: $('enrollCode').value.replace(/\D/g, '') });
    if (!r.ok) { if (!endedDuringLogin(r)) { $('enrollCode').value = ''; setMsg('enrollMsg', r.message || 'Code not accepted'); } return; }
    st.codes = r.recoveryCodes || []; st.pendingSecret = null;
    $('recoveryCodes').replaceChildren(...st.codes.map((c) => h('code', { text: c })));
    $('codesSaved').checked = false; $('codesDone').disabled = true; $('enrollStep1').hidden = true; $('enrollStep2').hidden = false;
  });
  $('codesCopy').addEventListener('click', async () => toast((await copyText(st.codes.join('\n'))) ? 'Recovery codes copied' : 'Copy failed', 'good'));
  $('codesSaved').addEventListener('change', () => { $('codesDone').disabled = !$('codesSaved').checked; });
  $('codesDone').addEventListener('click', () => { st.codes = []; $('recoveryCodes').replaceChildren(); enterMain(); });

  // ---------------------------------------------------------------- lost device (public)
  function resetLost() {
    $('lostFormBox').hidden = false; $('lostResult').hidden = true; $('lostPw').value = ''; $('lostCode').value = ''; $('lostConfirm').checked = false; $('lostBtn').disabled = true; setMsg('lostMsg', '');
    $('lostUser').value = st.username || '';
  }
  $('lostMethod').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; st.lostMethod = b.dataset.m;
    for (const x of $('lostMethod').children) x.classList.toggle('on', x === b);
    const rec = st.lostMethod === 'recovery';
    $('lostCodeLbl').textContent = rec ? 'Recovery code' : 'Authenticator code (from another device)';
    $('lostCode').placeholder = rec ? 'xxxxx-xxxxx' : '6 digits'; $('lostCode').inputMode = rec ? 'text' : 'numeric';
    $('lostCodeNote').textContent = rec ? 'Using a recovery code also resets your authenticator, since it was probably on the lost phone.' : 'Your authenticator stays active because you still have it.';
  });
  $('lostConfirm').addEventListener('change', () => { $('lostBtn').disabled = !$('lostConfirm').checked; });
  $('lostForm').addEventListener('submit', async (e) => {
    e.preventDefault(); setMsg('lostMsg', ''); $('lostBtn').disabled = true;
    const r = await api('POST', 'lost-device', { username: $('lostUser').value.trim(), password: $('lostPw').value, method: st.lostMethod, code: $('lostCode').value });
    $('lostBtn').disabled = false;
    if (!r.ok) return setMsg('lostMsg', r.message || 'Could not verify your identity');
    $('lostPw').value = ''; $('lostCode').value = ''; st.csrf = ''; st.session = null; clearMain();
    const items = [
      `Signed out ${r.sessionsEnded} active session${r.sessionsEnded === 1 ? '' : 's'}`,
      `${r.devicesMarked} device${r.devicesMarked === 1 ? '' : 's'} marked lost (no longer trusted)`,
      `${r.passkeysRemoved} passkey${r.passkeysRemoved === 1 ? '' : 's'} removed`,
      `Withdrawals frozen. Case ${r.caseId} sent to the security team`,
    ];
    if (r.pendingHeld) items.push(`${r.pendingHeld} pending withdrawal${r.pendingHeld === 1 ? '' : 's'} held`);
    if (r.totpReset) items.push('Authenticator reset. Set up a new one at next sign-in.');
    $('lostChecks').replaceChildren(...items.map((t) => h('li', { text: t })));
    $('lostNext').textContent = `Recovery codes left: ${r.recoveryLeft}. Sign in from a new device${r.totpReset ? ' with a recovery code to set up a new authenticator' : ''}. A reviewer lifts the withdrawal freeze in Ops Console → Attack Lab review queue.`;
    $('lostFormBox').hidden = true; $('lostResult').hidden = false;
  });
  $('lostFromApp').addEventListener('click', () => { go('lost'); resetLost(); });

  // ---------------------------------------------------------------- main app
  function enterMain() {
    go('main'); st.locked = false; $('scrMain').classList.remove('locked'); $('lock').hidden = true;
    const u = st.username || (st.session && st.session.username) || 'you';
    $('avatar').textContent = u.slice(0, 1); $('hello').textContent = `Hi, ${u}`;
    setTab(st.tab); startPoll(); refresh();
  }
  function startPoll() { stopPoll(); st.poll = setInterval(refresh, 2000); }
  function stopPoll() { if (st.poll) clearInterval(st.poll); st.poll = null; }
  async function refresh() {
    if (st.locked || st.screen !== 'main' || refresh.busy) return;
    refresh.busy = true; const r = await api('GET', 'home'); refresh.busy = false;
    if (r.ok && st.screen === 'main' && !st.locked) { st.home = r; render(); }
  }
  function setTab(name) {
    st.tab = name;
    for (const v of document.querySelectorAll('.view')) v.hidden = v.dataset.view !== name;
    for (const b of $('tabbar').children) b.classList.toggle('on', b.dataset.tab === name);
    $('views').scrollTop = 0; if (st.home) render();
  }
  $('tabbar').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });
  document.querySelector('.quick').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; const q = b.dataset.quick;
    if (q === 'buy' || q === 'sell') { setSide(q === 'buy' ? 'BUY' : 'SELL'); setTab('trade'); } else if (q === 'withdraw') setTab('wallet'); else setTab('security');
  });

  // server-enforced idle lock: the client only reports interaction; the server decides
  let lastSent = 0; let trailing = null;
  function onActivity() {
    if (st.screen !== 'main' || st.locked) return;
    const t = Date.now();
    if (t - lastSent >= 10000) sendActivity();
    else if (!trailing) trailing = setTimeout(() => { trailing = null; sendActivity(); }, 10000 - (t - lastSent));
  }
  function sendActivity() { if (st.screen !== 'main' || st.locked) return; lastSent = Date.now(); api('POST', 'activity'); }
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) $('app').addEventListener(ev, onActivity, { passive: true });

  function showLock(why) {
    if (st.screen !== 'main') return;
    if (!st.locked) {
      st.locked = true; stopPoll(); closeSheet(); $('scrMain').classList.add('locked'); $('lock').hidden = false;
      $('unlockCode').value = ''; setMsg('unlockMsg', '');
      $('unlockPasskey').hidden = !(st.home && st.home.passkeys.length && passkeyOk());
      setTimeout(() => $('unlockCode').focus(), 60);
    }
    $('lockWhy').textContent = why || `Locked after ${Math.round(st.idleMs / 1000)} s of inactivity. The server paused your session; verify to continue.`;
  }
  function hideLock() { st.locked = false; $('lock').hidden = true; $('scrMain').classList.remove('locked'); startPoll(); refresh(); }
  $('unlockForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const r = await api('POST', 'unlock', { code: $('unlockCode').value.replace(/\D/g, '') });
    if (r.ok) { hideLock(); return toast('Unlocked', 'good'); }
    $('unlockCode').value = ''; setMsg('unlockMsg', r.message || 'Wrong code');
  });
  $('unlockCode').addEventListener('input', () => { const v = $('unlockCode').value.replace(/\D/g, ''); $('unlockCode').value = v; if (v.length === 6) $('unlockForm').requestSubmit(); });
  $('unlockPasskey').addEventListener('click', async () => { const r = await passkeyAssert('unlock/passkey/options', 'unlock/passkey'); if (r.ok) { hideLock(); toast('Unlocked', 'good'); } else setMsg('unlockMsg', r.message || 'Passkey failed'); });
  $('idleBtn').addEventListener('click', lockNow);
  async function lockNow() { const r = await api('POST', 'lock'); if (r.ok) showLock('Locked by you. Verify to continue.'); }
  async function logout() { await api('POST', 'logout'); sessionEnded('Signed out.'); }

  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]'); if (g) { if (g.dataset.go === 'lost') resetLost(); go(g.dataset.go); return; }
    const a = e.target.closest('[data-action]'); if (!a) return;
    if (a.dataset.action === 'lock') lockNow();
    else if (a.dataset.action === 'logout') logout();
    else if (a.dataset.action === 'cancel-login') { api('POST', 'logout'); st.csrf = ''; go('login'); }
  });

  // ---------------------------------------------------------------- render
  function totals(H) {
    let avail = 0; let res = 0;
    for (const [a, b] of Object.entries(H.balances)) { avail += b.avail * (H.prices[a] || 0); res += b.res * (H.prices[a] || 0); }
    return { avail, res };
  }
  function render() {
    const H = st.home; if (!H) return;
    const amr = (H.session && H.session.amr) || [];
    $('authMethod').textContent = `Verified with ${amr.includes('passkey') ? 'a passkey' : 'an authenticator code'}`;
    renderBanners(H);
    if (st.tab === 'home') renderHome(H); else if (st.tab === 'trade') renderTrade(H); else if (st.tab === 'wallet') renderWallet(H); else renderSecurity(H);
    renderFeed(H.events);
  }
  function renderBanners(H) {
    const out = [];
    const f = H.flags;
    if (f.frozen) out.push(h('div', { class: 'banner bad' }, h('span', null, h('b', { text: 'Withdrawals frozen. ' }), `Lost-device case ${f.frozen.caseId} is under review. Trading still works.`)));
    else if (f.withdrawHold) out.push(h('div', { class: 'banner warn' }, h('span', null, h('b', { text: 'Withdrawals on hold. ' }), 'Our risk team is reviewing recent activity.')));
    if (f.tradingHold) out.push(h('div', { class: 'banner warn' }, h('span', null, h('b', { text: 'Trading paused. ' }), 'Unusual order activity is being reviewed.')));
    if (f.stepUp) out.push(h('div', { class: 'banner info' }, h('span', null, h('b', { text: 'Security check. ' }), 'Your next withdrawal needs a fresh authenticator code.')));
    for (const c of H.compartments) if (c.paused) out.push(h('div', { class: 'banner info' }, h('span', null, h('b', { text: `${c.asset} withdrawals paused. ` }), 'Custody review in progress; funds are safe.')));
    $('banners').replaceChildren(...out);
  }
  function renderHome(H) {
    const t = totals(H);
    $('pfTotal').textContent = fmtUsd(t.avail + t.res);
    $('pfSub').textContent = `Available ${fmtUsd(t.avail)} · In orders ${fmtUsd(t.res)}`;
    $('mktList').replaceChildren(...Object.values(H.markets).map((m) => h('div', { class: 'item tap', on: { click: () => { st.market = m.symbol; setTab('trade'); } } },
      h('div', { class: 'ic ' + m.base, text: m.base.slice(0, 1) }),
      h('div', { class: 'grow' }, h('div', { class: 't', text: `${m.base}/USDT` }), h('div', { class: 'sub', text: ASSET_NAMES[m.base] })),
      h('div', { class: 'r' }, h('div', { class: 'num', text: fmtPx(m.last) }), h('div', { class: 'num ' + (m.change >= 0 ? 'up' : 'down'), text: `${m.change >= 0 ? '+' : ''}${m.change.toFixed(2)}%` })))));
    $('assetList').replaceChildren(...['BTC', 'ETH', 'USDT', 'USDC'].map((a) => {
      const b = H.balances[a]; const amt = b.avail + b.res;
      return h('div', { class: 'item' }, h('div', { class: 'ic ' + a, text: a.slice(0, 1) }),
        h('div', { class: 'grow' }, h('div', { class: 't', text: a }), h('div', { class: 'sub', text: b.res ? `${fmtAmt(a, b.res)} in orders` : ASSET_NAMES[a] })),
        h('div', { class: 'r' }, h('div', { class: 'num', text: fmtAmt(a, amt) }), h('div', { class: 'sub num', text: fmtUsd(amt * H.prices[a]) })));
    }));
    const recent = [
      ...H.withdrawals.map((w) => ({ ts: w.ts, t: `Sent ${fmtAmt(w.asset, w.amount)} ${w.asset}`, sub: short(w.address), st: wdStatus(w.status) })),
      ...[...H.open, ...H.history].map((o) => ({ ts: o.ts, t: `${o.side === 'BUY' ? 'Bought' : 'Sold'} ${o.filled || o.qty} ${o.market.replace('USDT', '')}`, sub: `${o.type.toLowerCase()} · ${o.avgPrice ? '@ ' + fmtPx(o.avgPrice) : o.price ? '@ ' + fmtPx(o.price) : ''}`, st: ordStatus(o.status) })),
    ].sort((a, b) => b.ts - a.ts).slice(0, 6);
    const list = $('recentList'); list.setAttribute('data-empty', 'No activity yet. Try a small buy on the Trade tab.');
    list.replaceChildren(...recent.map((x) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't', text: x.t }), h('div', { class: 'sub', text: `${x.sub} · ${ago(x.ts)}` })), h('span', { class: 'st ' + x.st[1], text: x.st[0] }))));
  }
  const WD = { SCREENING: ['Screening', 'info'], QUEUED_LIQUIDITY: ['Queued', 'warn'], HELD_REVIEW: ['Held for review', 'warn'], HELD_STEP_UP: ['Needs step-up', 'warn'], HELD_POLICY: ['Held', 'warn'], HELD_FALLBACK: ['Held (fail-closed)', 'warn'], BROADCAST: ['Sent', 'info'], CONFIRMED: ['Confirmed', 'good'], CANCELED: ['Canceled', 'bad'] };
  const wdStatus = (s) => WD[s] || [s, ''];
  const ordStatus = (s) => ({ ACCEPTED: ['Open', 'info'], PARTIALLY_FILLED: ['Partial', 'info'], FILLED: ['Filled', 'good'], FILLED_PARTIAL_IOC: ['Partly filled', 'good'], CANCELED: ['Canceled', 'bad'], EXPIRED: ['Expired', 'bad'] }[s] || [s, '']);

  // trade
  function setSide(s) { st.side = s; for (const b of $('tSide').children) b.classList.toggle('on', b.dataset.s === s); if (st.home) renderTrade(st.home); }
  $('tSide').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setSide(b.dataset.s); });
  $('tMarket').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.market = b.dataset.m; $('tPrice').value = ''; $('tQty').value = st.market === 'BTCUSDT' ? '0.001' : '0.01'; if (st.home) renderTrade(st.home); });
  $('tType').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; st.otype = b.dataset.t;
    for (const x of $('tType').children) x.classList.toggle('on', x === b);
    $('tPriceFld').hidden = st.otype !== 'LIMIT';
    if (st.otype === 'LIMIT' && !$('tPrice').value && st.home) { const m = st.home.markets[st.market]; $('tPrice').value = roundTo(m.last, m.tick); }
    if (st.home) renderTrade(st.home);
  });
  for (const id of ['tQty', 'tPrice']) $(id).addEventListener('input', () => st.home && renderTrade(st.home));
  $('tPct').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !st.home) return; const p = Number(b.dataset.p) / 100; const H = st.home; const m = H.markets[st.market];
    const px = st.otype === 'LIMIT' && Number($('tPrice').value) > 0 ? Number($('tPrice').value) : m.last * (st.side === 'BUY' ? 1.05 : 1);
    const q = st.side === 'BUY' ? (H.balances.USDT.avail * p) / px : H.balances[m.base].avail * p;
    $('tQty').value = floorTo(Math.max(0, q), m.lot); renderTrade(H);
  });
  function renderTrade(H) {
    const m = H.markets[st.market];
    for (const b of $('tMarket').children) b.classList.toggle('on', b.dataset.m === st.market);
    $('tPx').textContent = fmtPx(m.last); $('tChg').textContent = `${m.change >= 0 ? '+' : ''}${m.change.toFixed(2)}%`; $('tChg').className = 'chg num ' + (m.change >= 0 ? 'up' : 'down');
    $('tBase').textContent = m.base;
    const qty = Number($('tQty').value) || 0; const px = st.otype === 'LIMIT' ? Number($('tPrice').value) || 0 : m.last;
    $('tAvail').textContent = st.side === 'BUY' ? `${fmtAmt('USDT', H.balances.USDT.avail)} USDT` : `${fmtAmt(m.base, H.balances[m.base].avail)} ${m.base}`;
    $('tTotal').textContent = `${st.otype === 'MARKET' ? '≈ ' : ''}${fmtPx(qty * px)} USDT`;
    const sb = $('tSubmit'); sb.textContent = `Review ${st.side === 'BUY' ? 'buy' : 'sell'}`; sb.className = 'btn block ' + (st.side === 'BUY' ? 'buy' : 'sell');
    const open = $('openList'); open.setAttribute('data-empty', 'No open orders');
    open.replaceChildren(...H.open.map((o) => h('div', { class: 'item' },
      h('div', { class: 'grow' }, h('div', { class: 't ' + (o.side === 'BUY' ? 'up' : 'down'), text: `${o.side} ${o.qty} ${o.market.replace('USDT', '')}` }), h('div', { class: 'sub', text: `Limit @ ${fmtPx(o.price)} · filled ${o.filled} · ${ago(o.ts)}` })),
      h('button', { class: 'mini danger', type: 'button', text: 'Cancel', on: { click: async (e) => { e.currentTarget.disabled = true; const r = await api('DELETE', 'orders/' + o.id); toast(r.ok ? 'Order canceled' : r.message, r.ok ? 'good' : 'bad'); refresh(); } } }))));
    const hist = $('histList'); hist.setAttribute('data-empty', 'No orders yet');
    hist.replaceChildren(...H.history.slice(0, 10).map((o) => { const s = ordStatus(o.status); return h('div', { class: 'item' },
      h('div', { class: 'grow' }, h('div', { class: 't', text: `${o.side} ${o.filled || o.qty} ${o.market.replace('USDT', '')}` }), h('div', { class: 'sub', text: `${o.type.toLowerCase()}${o.avgPrice ? ' · avg ' + fmtPx(o.avgPrice) : ''} · ${ago(o.ts)}` })),
      h('span', { class: 'st ' + s[1], text: s[0] })); }));
  }
  $('tSubmit').addEventListener('click', () => {
    const H = st.home; if (!H) return; const m = H.markets[st.market];
    const qty = $('tQty').value.trim(); const price = st.otype === 'LIMIT' ? $('tPrice').value.trim() : '';
    if (!(Number(qty) > 0)) return toast('Enter an amount', 'warn');
    if (st.otype === 'LIMIT' && !(Number(price) > 0)) return toast('Enter a limit price', 'warn');
    const cid = 'm-' + randHex(8); const px = st.otype === 'LIMIT' ? Number(price) : m.last;
    const retry = h('input', { type: 'checkbox' });
    const msg = h('div', { class: 'msg' });
    const btn = h('button', { class: 'btn block ' + (st.side === 'BUY' ? 'buy' : 'sell'), type: 'button', text: `Confirm ${st.side === 'BUY' ? 'buy' : 'sell'}` });
    btn.addEventListener('click', async () => {
      btn.disabled = true; // a second tap cannot send a second order
      const body = { market: st.market, side: st.side, type: st.otype, qty, price: price || undefined, clientOrderId: cid };
      const r = await api('POST', 'orders', body);
      if (!r.ok) { btn.disabled = false; msg.textContent = `${r.message || 'Rejected'} (${r.reason})`; return; }
      let extra = '';
      if (retry.checked) { const r2 = await api('POST', 'orders', body); extra = r2.ok && r2.duplicate && r2.order.id === r.order.id ? ' Retry returned the same order (duplicate: true), no second fill.' : ' Retry result: ' + (r2.reason || 'new order'); }
      closeSheet(); toast(`${ordStatus(r.order.status)[0]}: ${r.order.side} ${r.order.filled || r.order.qty} ${m.base}${r.order.avgPrice ? ' @ ' + fmtPx(r.order.avgPrice) : ''}.${extra}`, 'good'); refresh();
    });
    openSheet(h('h3', { text: `${st.side === 'BUY' ? 'Buy' : 'Sell'} ${m.base}` }),
      kv('Market', `${m.base}/USDT`), kv('Order type', st.otype === 'MARKET' ? 'Market (best available price)' : 'Limit'), kv('Amount', `${qty} ${m.base}`, 'num'),
      kv('Price', st.otype === 'MARKET' ? `≈ ${fmtPx(m.last)}` : fmtPx(px), 'num'), kv('Estimated total', `${fmtPx(Number(qty) * px)} USDT`, 'num'),
      h('div', { class: 'prot' }, h('b', { text: 'Trading protection' }), h('ul', null,
        h('li', { text: 'Balance checked and reserved before matching' }), h('li', { text: `Price must stay within ±${m.band * 100}% of last trade` }),
        h('li', { text: `Order value between ${m.minNotional} and ${m.maxNotional.toLocaleString('en-US')} USDT; per-account rate limit` }),
        h('li', null, 'Duplicate-safe order ID ', h('code', { text: cid })))),
      h('label', { class: 'chk' }, retry, h('span', { text: 'Simulate a network retry (send this order twice)' })), msg, btn,
      h('button', { class: 'btn ghost block', type: 'button', text: 'Cancel', on: { click: closeSheet } }));
  });

  // wallet
  $('wAsset').addEventListener('change', () => { st.addrSig = ''; $('wAmt').value = $('wAsset').value === 'BTC' ? '0.01' : $('wAsset').value === 'ETH' ? '0.1' : '50'; st.home && renderWallet(st.home); });
  function renderWallet(H) {
    const asset = $('wAsset').value; const b = H.balances[asset];
    const entries = H.allowlist.filter((x) => x.asset === asset);
    const sig = asset + '|' + entries.map((x) => x.address + (x.active ? 1 : Math.ceil(x.activeInMs / 5000))).join(',');
    if (sig !== st.addrSig) {
      st.addrSig = sig; const prev = $('wAddr').value;
      $('wAddr').replaceChildren(...(entries.length ? entries.map((x) => h('option', { value: x.address, disabled: !x.active, text: x.active ? `${x.label} · ${short(x.address)}` : `${x.label} (usable in ${Math.ceil(x.activeInMs / 1000)} s)` })) : [h('option', { value: '', text: 'No allowlisted address. Add one below.' })]));
      if (entries.some((x) => x.address === prev && x.active)) $('wAddr').value = prev;
    }
    $('wAvail').textContent = `· ${fmtAmt(asset, b.avail)} available`;
    const L = H.limits; const pct = Math.min(100, (L.usedUsd / L.dailyUsd) * 100);
    $('wLimitTxt').textContent = `${fmtUsd(L.usedUsd)} of ${fmtUsd(L.dailyUsd)}`;
    $('wLimitBar').style.width = pct + '%'; $('wLimitBar').className = 'bar-fill' + (pct > 90 ? ' bad' : pct > 70 ? ' warn' : '');
    $('wPerTx').textContent = `${L.perTx[asset]} ${asset}`;
    const al = $('addrList'); al.setAttribute('data-empty', 'No addresses yet');
    al.replaceChildren(...H.allowlist.map((x) => h('div', { class: 'item' },
      h('div', { class: 'ic ' + x.asset, text: x.asset.slice(0, 1) }),
      h('div', { class: 'grow' }, h('div', { class: 't', text: x.label }), h('div', { class: 'addr', text: short(x.address) })),
      h('span', { class: 'chip ' + (x.active ? 'live' : 'partial'), text: x.active ? 'Active' : `Cooling ${Math.ceil(x.activeInMs / 1000)} s` }),
      h('button', { class: 'mini', type: 'button', text: 'Remove', 'aria-label': `Remove ${x.label}`, on: { click: () => removeAddr(x) } }))));
    const wl = $('wdList'); wl.setAttribute('data-empty', 'No withdrawals yet');
    wl.replaceChildren(...H.withdrawals.map((w) => { const s = wdStatus(w.status); const open = st.expanded.has(w.id);
      return h('div', { class: 'item tap', on: { click: () => { if (open) st.expanded.delete(w.id); else st.expanded.add(w.id); renderWallet(st.home); } } },
        h('div', { class: 'grow' }, h('div', { class: 't', text: `${fmtAmt(w.asset, w.amount)} ${w.asset}` }), h('div', { class: 'sub', text: `${short(w.address)} · ${ago(w.ts)}` }),
          open ? h('div', { class: 'why' }, ...(w.reasons.length ? w.reasons : ['Waiting for AI Guardian screening']).map((x) => h('div', { text: '• ' + x })), w.txid ? h('div', { class: 'addr', text: 'tx ' + short(w.txid) }) : null) : null),
        h('span', { class: 'st ' + s[1], text: s[0] })); }));
    $('custList').replaceChildren(...H.compartments.map((c) => h('div', { class: 'item' },
      h('div', { class: 'ic ' + c.asset, text: c.asset.slice(0, 1) }),
      h('div', { class: 'grow' }, h('div', { class: 't', text: `${c.asset} hot wallet` }), h('div', { class: 'sub', text: `${c.network} · ${c.exposurePct}% of cap · max ${c.perTxCap} ${c.asset}/tx` })),
      h('span', { class: 'chip ' + (c.paused ? 'bad' : 'live'), text: c.paused ? 'Paused' : 'Normal' }))));
  }
  $('wSubmit').addEventListener('click', async () => {
    const H = st.home; if (!H) return; setMsg('wMsg', '');
    const asset = $('wAsset').value; const address = $('wAddr').value; const amount = $('wAmt').value.trim();
    if (!address) return setMsg('wMsg', 'Choose an allowlisted address');
    if (!(Number(amount) > 0)) return setMsg('wMsg', 'Enter an amount');
    if (Number(amount) > H.balances[asset].avail) return setMsg('wMsg', `Not enough ${asset} available`);
    if (Number(amount) > H.limits.perTx[asset]) return setMsg('wMsg', `Above the per-transaction cap of ${H.limits.perTx[asset]} ${asset}`);
    // Ask the server first without a code: it checks allowlist, cooling, freeze and limits without spending a code.
    const pre = await api('POST', 'withdrawals', { asset, amount, address });
    if (pre.reason !== 'STEP_UP_REQUIRED') return setMsg('wMsg', pre.message || 'Withdrawal not allowed');
    const entry = H.allowlist.find((x) => x.address === address && x.asset === asset);
    const code = h('input', { class: 'otp', inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 6, placeholder: '••••••', 'aria-label': 'Authenticator code' });
    const msg = h('div', { class: 'msg' }); const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Confirm withdrawal' });
    const form = h('form', { class: 'form', novalidate: true }, code, msg, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); btn.disabled = true;
      const r = await api('POST', 'withdrawals', { asset, amount, address, code: code.value.replace(/\D/g, '') });
      btn.disabled = false;
      if (!r.ok) { code.value = ''; msg.textContent = r.message || 'Rejected'; return; }
      closeSheet(); toast(`Withdrawal submitted. AI Guardian is screening it (${wdStatus(r.withdrawal.status)[0]}).`, 'good'); refresh();
    });
    code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, ''); });
    openSheet(h('h3', { text: 'Confirm withdrawal' }),
      kv('Amount', `${amount} ${asset}`, 'num'), kv('Value', '≈ ' + fmtUsd(Number(amount) * H.prices[asset]), 'num'), kv('To', entry ? entry.label : ''), kv('Address', short(address), 'num'), kv('Network', (H.compartments.find((c) => c.asset === asset) || {}).network || ''),
      h('div', { class: 'prot' }, h('b', { text: 'Step-up verification' }), h('ul', null,
        h('li', { text: 'Destination is on your allowlist and past its cooling period' }), h('li', { text: 'Within your daily limit and the per-transaction cap' }),
        h('li', { text: 'Then: AI Guardian screening (about 2 s) and the custody signer policy check' }))),
      h('p', { class: 'lead', text: 'Enter a new code from your authenticator app' }), form,
      h('button', { class: 'btn ghost block', type: 'button', text: 'Cancel', on: { click: closeSheet } }));
    setTimeout(() => code.focus(), 80);
  });
  $('addrAdd').addEventListener('click', () => {
    const asset = h('select', null, ...['BTC', 'ETH', 'USDC'].map((a) => h('option', { text: a })));
    const label = h('input', { placeholder: 'e.g. My Ledger', maxLength: 30 });
    const addr = h('input', { placeholder: 'bc1… or 0x…', autocapitalize: 'none', spellcheck: false });
    const code = h('input', { class: 'otp', inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 6, placeholder: '••••••' });
    const msg = h('div', { class: 'msg' }); const btn = h('button', { class: 'btn primary block', type: 'submit', text: 'Add address' });
    const form = h('form', { class: 'form', novalidate: true },
      h('label', { class: 'fld' }, h('span', { text: 'Asset' }), asset), h('label', { class: 'fld' }, h('span', { text: 'Name' }), label),
      h('label', { class: 'fld' }, h('span', { text: 'Address' }), addr), h('label', { class: 'fld' }, h('span', { text: 'Authenticator code' }), code), msg, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); btn.disabled = true;
      const r = await api('POST', 'allowlist', { asset: asset.value, label: label.value, address: addr.value.trim(), code: code.value.replace(/\D/g, '') });
      btn.disabled = false;
      if (!r.ok) { msg.textContent = r.message || 'Not added'; if (/^CODE/.test(r.reason || '')) code.value = ''; return; }
      closeSheet(); st.addrSig = ''; toast(`Address added. Usable in ${Math.round(st.cfg.cooldownMs / 1000)} s (security cooling period).`, 'warn'); refresh();
    });
    openSheet(h('h3', { text: 'Add an address' }),
      h('p', { class: 'note', text: `New addresses need a code and can be used after a ${Math.round(st.cfg.cooldownMs / 1000)} s cooling period (24 hours in production), so a stolen session can't drain funds immediately.` }), form,
      h('button', { class: 'btn ghost block', type: 'button', text: 'Cancel', on: { click: closeSheet } }));
  });
  async function removeAddr(x) {
    const yes = h('button', { class: 'btn danger block', type: 'button', text: 'Remove address' });
    yes.addEventListener('click', async () => { const r = await api('POST', 'allowlist/remove', { asset: x.asset, address: x.address }); closeSheet(); st.addrSig = ''; toast(r.ok ? 'Address removed' : r.message, r.ok ? 'good' : 'bad'); refresh(); });
    openSheet(h('h3', { text: `Remove "${x.label}"?` }), h('p', { class: 'note', text: `${x.asset} · ${x.address}. Adding it back needs a code and a new cooling period.` }), yes,
      h('button', { class: 'btn ghost block', type: 'button', text: 'Keep it', on: { click: closeSheet } }));
  }

  // security
  function renderSecurity(H) {
    const s = H.session;
    $('sesState').textContent = s.state === 'ACTIVE' ? 'Active' : s.state;
    $('sesAmr').textContent = (s.amr || []).map((x) => ({ pwd: 'Password', otp: 'Authenticator code', passkey: 'Passkey' }[x] || x)).join(' + ');
    $('sesStart').textContent = `${tm(s.createdAt)} (max 8 h)`;
    $('sesIdle').textContent = `${Math.round(s.idleMs / 1000)} s idle, enforced by the server`;
    $('sesConn').textContent = st.cfg.tls ? 'Encrypted (HTTPS)' : 'Plain HTTP, not encrypted';
    $('sesConn').className = st.cfg.tls ? 'up' : 'down';
    $('mfaTotpState').textContent = H.mfa.totp ? 'On · each code works once' : 'Off';
    $('mfaRcState').textContent = `${H.mfa.recoveryLeft} of 8 left`;
    $('pkList').replaceChildren(...H.passkeys.map((k) => h('div', { class: 'item' }, h('div', { class: 'ic ok' }),
      h('div', { class: 'grow' }, h('div', { text: `Passkey · ${k.name}` }), h('div', { class: 'sub', text: `Added ${ago(k.createdAt)}${k.lastUsed ? ' · used ' + ago(k.lastUsed) : ''}` })),
      h('button', { class: 'mini', type: 'button', text: 'Remove', on: { click: async () => { const r = await api('POST', 'passkeys/remove', { id: k.id }); toast(r.ok ? 'Passkey removed' : r.message, r.ok ? 'good' : 'bad'); refresh(); } } }))));
    const ok = passkeyOk(); $('pkAdd').disabled = !ok; $('pkNote').hidden = ok;
    $('pkNote').textContent = 'Passkeys need HTTPS on a domain name, or localhost. Browsers block them on a raw IP address, so on this connection use the authenticator app. They work through an SSH tunnel (http://localhost:3510/mobile) or behind a domain with a real certificate.';
    $('devList').replaceChildren(...H.devices.sort((a, b) => b.lastSeen - a.lastSeen).map((d) => {
      const r = d.risk || { score: 0, why: [] }; const rc = r.score >= 60 ? 'bad' : r.score >= 25 ? 'partial' : 'live';
      return h('div', { class: 'item' },
        h('div', { class: 'grow' },
          h('div', { class: 't' }, d.name, ' ', d.current ? h('span', { class: 'chip live', text: 'This device' }) : null, d.status !== 'active' ? h('span', { class: 'chip bad', text: d.status }) : null),
          h('div', { class: 'sub', text: `${d.trusted ? 'Trusted after MFA' : 'Not trusted'} · last seen ${ago(d.lastSeen)} · ${d.ips.join(', ')}` }),
          h('div', { class: 'why' }, h('span', { class: 'chip ' + rc, text: `Integrity risk ${r.score}/100` }), ' ', r.why.join(' · '))),
        !d.current && d.status === 'active' ? h('button', { class: 'mini danger', type: 'button', text: 'Revoke', on: { click: async () => { const x = await api('POST', 'devices/revoke', { deviceId: d.id }); toast(x.ok ? `Device revoked, ${x.sessionsEnded} session(s) ended` : x.message, x.ok ? 'good' : 'bad'); refresh(); } } }) : null);
    }));
    const ev = $('evList'); ev.setAttribute('data-empty', 'No events yet');
    ev.replaceChildren(...H.events.slice(0, 12).map((e) => h('div', { class: 'item' }, h('div', { class: 'ic ' + (e.sev === 'bad' ? 'no' : e.sev === 'warn' ? 'warnc' : 'ok') }), h('div', { class: 'grow' }, h('div', { text: e.text }), h('div', { class: 'sub', text: ago(e.ts) })))));
  }
  $('pkAdd').addEventListener('click', passkeyRegister);

  async function passkeyRegister() {
    const o = await api('POST', 'passkeys/options'); if (!o.ok) return toast(o.message || 'Not available', 'bad');
    const pk = o.publicKey; pk.challenge = b64u.dec(pk.challenge); pk.user.id = b64u.dec(pk.user.id); pk.excludeCredentials = pk.excludeCredentials.map((c) => ({ ...c, id: b64u.dec(c.id) }));
    let cred; try { cred = await navigator.credentials.create({ publicKey: pk }); } catch (e) { return toast('Passkey not created: ' + (e.message || e.name), 'warn'); }
    const resp = cred.response; const spki = resp.getPublicKey ? resp.getPublicKey() : null;
    if (!spki) return toast('This browser cannot export the passkey public key', 'bad');
    const r = await api('POST', 'passkeys', { id: cred.id, clientDataJSON: b64u.enc(resp.clientDataJSON), authenticatorData: b64u.enc(resp.getAuthenticatorData()), publicKey: b64u.enc(spki), alg: resp.getPublicKeyAlgorithm(), name: deviceInfo().name });
    toast(r.ok ? 'Passkey added. You can use it to sign in and unlock.' : r.message, r.ok ? 'good' : 'bad'); refresh();
  }
  async function passkeyAssert(optPath, path) {
    if (!passkeyOk()) return { ok: false, message: 'Passkeys need HTTPS on a domain name' };
    const o = await api('POST', optPath); if (!o.ok) return o;
    const pk = o.publicKey; pk.challenge = b64u.dec(pk.challenge); pk.allowCredentials = pk.allowCredentials.map((c) => ({ ...c, id: b64u.dec(c.id) }));
    let cred; try { cred = await navigator.credentials.get({ publicKey: pk }); } catch { return { ok: false, message: 'Passkey cancelled' }; }
    const r = cred.response;
    return api('POST', path, { id: cred.id, clientDataJSON: b64u.enc(r.clientDataJSON), authenticatorData: b64u.enc(r.authenticatorData), signature: b64u.enc(r.signature) });
  }

  // live security checks: real requests, real refusals
  $('runChecks').addEventListener('click', async () => {
    const H = st.home; if (!H) return; const btn = $('runChecks'); btn.disabled = true; const list = $('checkList'); list.replaceChildren();
    const add = (name, pass, detail) => list.append(h('div', { class: 'item' }, h('div', { class: 'ic ' + (pass ? 'ok' : 'no') }), h('div', { class: 'grow' }, h('div', { text: name }), h('div', { class: 'sub', text: detail }))));
    try {
      let r = await api('POST', 'activity', {}, { noCsrf: true });
      add('Request without a CSRF token is refused', r.status === 403 && r.reason === 'CSRF_FAILED', `${r.status} ${r.reason || ''}`);
      add('Session cookie hidden from JavaScript', !document.cookie.includes('saife_m'), 'HttpOnly, SameSite=Strict; document.cookie has no session token');
      const e = H.markets.ETHUSDT; const cid = 'chk-' + randHex(6);
      const body = { acct: 'trader-1', account: 'trader-1', market: 'ETHUSDT', side: 'BUY', type: 'LIMIT', price: roundTo(e.last * 0.97, e.tick), qty: '0.002', clientOrderId: cid };
      r = await api('POST', 'orders', body);
      add('Account comes from the session, not the request', r.ok && r.account === 'cust-1', r.ok ? `Request said "trader-1", order booked on ${r.account}` : `${r.reason}: ${r.message}`);
      if (r.ok) {
        const r2 = await api('POST', 'orders', body);
        add('A retried order is not placed twice', r2.ok && r2.duplicate && r2.order.id === r.order.id, r2.ok ? `Same clientOrderId → same order ${r2.order.id} (duplicate: ${r2.duplicate})` : r2.reason);
        await api('DELETE', 'orders/' + r.order.id);
      }
      r = await api('POST', 'orders', { market: 'ETHUSDT', side: 'SELL', type: 'LIMIT', price: roundTo(e.last, e.tick), qty: '50' });
      add('Order larger than the balance is rejected', !r.ok && r.reason === 'INSUFFICIENT_BALANCE', `${r.reason}: ${r.message}`);
      r = await api('POST', 'orders', { market: 'BTCUSDT', side: 'BUY', type: 'MARKET', qty: '10' });
      add('Order above the maximum value is rejected', !r.ok && r.reason === 'MAX_NOTIONAL', `${r.reason}: ${r.message}`);
      r = await api('POST', 'withdrawals', { asset: 'BTC', amount: '0.01', address: 'bc1q-attacker-0001' });
      add('Withdrawal to an unknown address is refused', !r.ok && ['NOT_ALLOWLISTED', 'ACCOUNT_FROZEN'].includes(r.reason), `${r.reason}: ${r.message}`);
      const good = H.allowlist.find((x) => x.asset === 'BTC' && x.active);
      if (good) {
        r = await api('POST', 'withdrawals', { asset: 'BTC', amount: '0.001', address: good.address });
        add('Withdrawal without a fresh MFA code is refused', !r.ok && ['STEP_UP_REQUIRED', 'ACCOUNT_FROZEN'].includes(r.reason), `${r.reason}: ${r.message}`);
        const big = Math.ceil(((H.limits.dailyUsd + 1000) / H.prices.BTC) * 1000) / 1000;
        r = await api('POST', 'withdrawals', { asset: 'BTC', amount: String(big), address: good.address });
        add('Withdrawal above the daily limit is refused', !r.ok && ['DAILY_LIMIT', 'ACCOUNT_FROZEN'].includes(r.reason), `${big} BTC → ${r.reason}: ${r.message}`);
      }
      const hr = await fetch('/mobile.html', { method: 'HEAD', cache: 'no-store' }); const csp = hr.headers.get('content-security-policy') || '';
      add('Strict CSP and anti-framing headers', /script-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp) && hr.headers.get('x-frame-options') === 'DENY', csp ? "script-src 'self', frame-ancestors 'none', X-Frame-Options DENY" : 'CSP header missing');
      add('Connection encrypted (TLS)', location.protocol === 'https:', location.protocol === 'https:' ? 'HTTPS' : 'Plain HTTP. On EC2, restart with ./start.sh --public --tls');
    } finally { btn.disabled = false; refresh(); }
  });

  // ---------------------------------------------------------------- sheets
  function openSheet(...kids) { $('sheet').replaceChildren(...kids); $('sheetWrap').hidden = false; }
  function closeSheet() { $('sheetWrap').hidden = true; $('sheet').replaceChildren(); }
  $('sheetWrap').addEventListener('click', (e) => { if (e.target === $('sheetWrap')) closeSheet(); });

  // ---------------------------------------------------------------- demo authenticator (stands in for an authenticator app)
  function authGet() { try { const v = JSON.parse(localStorage.getItem('saife.demoAuth') || 'null'); if (v && v.secret) return v; } catch { /* storage blocked */ } return st.memAuth; }
  function authSet(v) { st.memAuth = v; try { if (v) localStorage.setItem('saife.demoAuth', JSON.stringify(v)); else localStorage.removeItem('saife.demoAuth'); } catch { /* storage blocked */ } renderAuth(); }
  function renderAuth() { const a = authGet(); $('authEmpty').hidden = !!a; $('authFull').hidden = !a; if (a) $('authAcct').textContent = `SAIFE · ${a.user}`; authTick(); }
  function authTick() {
    const a = authGet(); if (!a) return;
    const c = T.code(a.secret); const left = T.secondsLeft();
    $('authCode').textContent = `${c.slice(0, 3)} ${c.slice(3)}`; $('authSecs').textContent = `${left} s`;
    $('authBar').style.width = (left / 30) * 100 + '%'; $('authBar').className = 'bar-fill' + (left <= 5 ? ' bad' : left <= 10 ? ' warn' : '');
  }
  function visibleOtpInput() {
    if (!$('lock').hidden) return $('unlockCode');
    if (!$('sheetWrap').hidden) return $('sheet').querySelector('input.otp');
    const scr = document.querySelector(`.screen[data-screen="${st.screen}"]`);
    return [...scr.querySelectorAll('input.otp:not(.rc)')].find((x) => x.offsetParent !== null) || null;
  }
  $('authFill').addEventListener('click', () => {
    const a = authGet(); const el = visibleOtpInput(); if (!a) return;
    if (!el) return toast('No code field on screen right now', 'warn');
    el.value = T.code(a.secret); el.dispatchEvent(new Event('input', { bubbles: true })); el.focus(); closeDrawer();
  });
  $('authCode').addEventListener('click', async () => { const a = authGet(); if (a && (await copyText(T.code(a.secret)))) toast('Code copied', 'good'); });
  $('authRemove').addEventListener('click', () => authSet(null));
  function openDrawer() { $('sideRight').classList.add('open'); $('keyFab').classList.add('hide'); }
  function closeDrawer() { $('sideRight').classList.remove('open'); $('keyFab').classList.remove('hide'); }
  $('keyFab').addEventListener('click', openDrawer);
  $('drawerClose').addEventListener('click', closeDrawer);

  function renderFeed(events) {
    const f = $('evFeed'); $('evCount').textContent = events.length ? String(events.length) : '';
    f.replaceChildren(...(events.length ? events.slice(0, 25).map((e) => h('li', { class: e.sev }, h('time', { text: tm(e.ts) }), e.text)) : [h('li', { class: 'muted', text: 'No events yet.' })]));
  }

  // ---------------------------------------------------------------- security layers panel
  function renderLayers(list) {
    const LBL = { live: 'Live', partial: 'Partial', sim: 'Simulated' };
    const make = () => list.map((c) => h('li', { on: { click: (e) => e.currentTarget.classList.toggle('open') } },
      h('div', { class: 'lt' }, h('span', null, c.layer, c.optional ? h('span', { class: 'opt', text: 'optional' }) : null), h('span', { class: 'chip ' + c.status, text: LBL[c.status] || c.status })),
      h('div', { class: 'ld', text: c.detail })));
    $('layers').replaceChildren(...make()); $('layersMob').replaceChildren(...make());
  }

  // ---------------------------------------------------------------- clock + idle ring
  const CIRC = 94.25;
  setInterval(() => {
    authTick();
    if (st.screen !== 'main' || st.locked || !st.session || st.session.state !== 'ACTIVE') return;
    const rem = Math.max(0, st.deadline - Date.now()); const frac = rem / st.idleMs;
    $('idleArc').style.strokeDashoffset = String(CIRC * (1 - frac)); $('idleSec').textContent = String(Math.ceil(rem / 1000));
    $('idleBtn').className = 'idle' + (rem < 10000 ? ' crit' : rem < 20000 ? ' warn' : '');
    if (rem <= 0 && !st.checking) { st.checking = true; api('GET', 'session').then(() => { st.checking = false; }); }
  }, 250);
  const clock = () => { $('sbTime').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, ''); };
  setInterval(clock, 10000); clock();

  // ---------------------------------------------------------------- boot
  (async function init() {
    st.deviceId = loadDeviceId(); renderAuth();
    const cfg = await api('GET', 'config'); st.cfg = cfg.ok ? cfg : { controls: [], cooldownMs: 60000 };
    st.idleMs = st.cfg.idleMs || 60000; renderLayers(st.cfg.controls || []);
    const cb = $('connBadge'); cb.textContent = st.cfg.tls ? 'Encrypted (TLS)' : 'Not encrypted (HTTP)'; cb.className = 'conn ' + (st.cfg.tls ? 'tls' : 'plain');
    if (st.cfg.demoHint) { $('demoHint').hidden = false; $('hintUser').textContent = st.cfg.demoHint.username; $('hintPw').textContent = st.cfg.demoHint.password; }
    $('lostUser').value = '';
    const s = await api('GET', 'session');
    route(s.ok ? s.session : null);
  })();
})();
