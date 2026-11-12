/* Shared helpers: API, SSE, formatting, narration banner, toasts, tiny canvas charts (no dependencies). */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 2) => (n == null || isNaN(n) ? '–' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtQ = (n) => (n == null ? '–' : Math.abs(n) >= 1000 ? fmt(n, 0) : Math.abs(n) >= 1 ? fmt(n, 4) : fmt(n, 6));
const tstr = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour12: false });
const usdK = (n) => (n >= 1e9 ? '$' + fmt(n / 1e9, 2) + 'B' : n >= 1e6 ? '$' + fmt(n / 1e6, 2) + 'M' : n >= 1e3 ? '$' + fmt(n / 1e3, 1) + 'k' : '$' + fmt(n, 0));

async function api(method, path, body) {
  try {
    const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ...j };
  } catch (e) { return { ok: false, reason: 'NETWORK', message: e.message }; }
}

function connectStream(handlers) {
  const es = new EventSource('/api/stream');
  for (const [k, fn] of Object.entries(handlers)) es.addEventListener(k, (e) => { try { fn(JSON.parse(e.data)); } catch (err) { console.error(k, err); } });
  return es;
}

function toast(msg, kind = 'info', ms = 4500) {
  let box = $('#toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const el = document.createElement('div'); el.className = 'toast ' + kind; el.innerHTML = msg; box.prepend(el);
  while (box.children.length > 5) box.lastChild.remove();
  setTimeout(() => el.remove(), ms);
}

function showNarration(n, currentPage) {
  let el = $('#narration'); if (!el) { el = document.createElement('div'); el.id = 'narration'; document.body.appendChild(el); }
  const link = n.page && n.page !== currentPage ? ` <a href="${n.page === 'ops' ? '/ops.html#attack' : '/'}">→ open ${n.page === 'ops' ? 'Ops Console' : 'Trade view'}</a>` : '';
  el.innerHTML = `<button class="x" title="hide">×</button><div class="st">Demo ${n.step ? `step ${n.step} / ${n.total}` : ''}</div><div class="tt">${esc(n.title)}</div><div class="tx">${esc(n.text)}${link}</div><div class="prog"><div style="width:${n.total ? (n.step / n.total) * 100 : 100}%"></div></div>`;
  el.style.display = 'block';
  $('.x', el).onclick = () => { el.style.display = 'none'; };
}

function setupDemoButton(btn) {
  let running = false; let staging = false;
  const paint = () => { btn.textContent = running ? '■ Stop demo' : staging ? 'Signing in…' : '▶ Run demo'; btn.classList.toggle('running', running); btn.disabled = staging; };
  btn.onclick = async () => {
    if (running) { await api('POST', '/api/demo/stop'); return; }
    staging = true; paint();
    const signedIn = await signInStage();
    staging = false; paint();
    if (!signedIn) { toast('Demo cancelled at sign-in', 'warn'); return; }
    const chip = $('.user-chip'); if (chip) chip.textContent = 'trader-1 · signed in with MFA (mock)';
    const r = await api('POST', '/api/demo/start');
    if (!r.ok) toast(esc(r.message || r.reason), 'bad'); else { running = true; paint(); }
  };
  return { set(v) { running = v; paint(); } };
}

/* ---------- scripted sign-in stage shown before the guided demo (mockup: no real credentials) ---------- */
function signInStage() {
  return new Promise((resolve) => {
    const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const rnd = new Uint8Array(20); crypto.getRandomValues(rnd);
    const secret = [...rnd].map((b) => B32[b & 31]).join('');
    const T = window.SaifeTOTP;
    const codeNow = () => (T ? T.code(secret) : String(Math.floor(100000 + Math.random() * 900000)));
    const secsLeft = () => (T ? T.secondsLeft() : 30 - (Math.floor(Date.now() / 1000) % 30));
    const ua = navigator.userAgent;
    const devName = `${/iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'Linux PC'} · ${/Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : 'Safari'}`;
    const steps = [
      ['Edge check', 'TLS + AWS WAF rate rule passed'],
      ['Password', 'scrypt hash, constant-time compare'],
      ['Device', `${devName}: known device, risk 0/100`],
      ['MFA', 'TOTP code, one-time use, ±30 s window'],
      ['Session', 'ID rotated · HttpOnly cookie · CSRF token · 60 s idle lock armed'],
    ];
    const ov = document.createElement('div'); ov.id = 'signin';
    ov.innerHTML = `
      <div class="si-wrap" role="dialog" aria-modal="true" aria-label="Demo sign-in">
        <div class="si-tag">Demo stage 0 · Customer sign-in with MFA <span>scripted mockup · demo credentials · no real secrets</span></div>
        <div class="si-grid">
          <div class="si-card">
            <div class="si-brand"><svg width="26" height="26" viewBox="0 0 24 24"><path fill="#fcd535" d="M12 2l4 4-4 4-4-4zM4 10l4 4-4 4-4-4zM20 10l4 4-4 4-4-4zM12 14l4 4-4 4-4-4z"/></svg>SAIFE<span>TRADE</span></div>
            <div class="si-pane si-login">
              <h3>Sign in</h3>
              <label>Username<input class="si-user" readonly></label>
              <label>Password<input class="si-pw" readonly></label>
              <button class="si-btn" tabindex="-1">Sign in</button>
            </div>
            <div class="si-pane si-mfa" hidden>
              <h3>Two-step verification</h3>
              <p>Enter the 6-digit code from your authenticator app.</p>
              <div class="si-boxes">${'<span></span>'.repeat(6)}</div>
              <div class="si-status"></div>
            </div>
            <div class="si-pane si-done" hidden>
              <div class="si-ok">✓</div>
              <h3>Signed in as trader-1</h3>
              <p>Password + authenticator code verified. Session locks after 60 s without interaction.</p>
            </div>
          </div>
          <div class="si-side">
            <div class="si-phone">
              <div class="si-ph-head">Authenticator</div>
              <div class="si-ph-acct">SAIFE · trader-1</div>
              <div class="si-ph-code">––– –––</div>
              <div class="si-ph-bar"><div></div></div>
              <div class="si-ph-secs"></div>
            </div>
            <ol class="si-steps">${steps.map(([t, d]) => `<li><b>${t}</b><span>${d}</span></li>`).join('')}</ol>
          </div>
        </div>
        <div class="si-foot"><button class="si-skip">Skip ▸▸</button><button class="si-cancel">Cancel</button></div>
      </div>`;
    document.body.appendChild(ov);
    const q = (s) => ov.querySelector(s);
    let cancelled = false; let skip = false; let done = false;
    const finish = (v) => { if (done) return; done = true; clearInterval(tick); ov.classList.add('out'); setTimeout(() => ov.remove(), 260); resolve(v); };
    q('.si-cancel').onclick = () => { cancelled = true; finish(false); };
    q('.si-skip').onclick = () => { skip = true; };
    const onKey = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); cancelled = true; finish(false); } };
    document.addEventListener('keydown', onKey);
    const paintAuth = () => {
      const c = codeNow(); const s = secsLeft();
      q('.si-ph-code').textContent = `${c.slice(0, 3)} ${c.slice(3)}`; q('.si-ph-secs').textContent = `${s} s`;
      q('.si-ph-bar div').style.width = (s / 30) * 100 + '%';
    };
    const tick = setInterval(paintAuth, 250); paintAuth();
    const wait = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (cancelled) throw new Error('cancel'); if (skip) return; await new Promise((r) => setTimeout(r, 30)); } };
    const type = async (el, text, mask) => { el.value = ''; for (const ch of text) { if (skip) break; el.value += mask ? '•' : ch; await wait(mask ? 55 : 80); } el.value = mask ? '•'.repeat(text.length) : text; };
    const li = [...ov.querySelectorAll('.si-steps li')];
    const mark = async (i, ms = 450) => { li[i].className = 'on'; await wait(ms); li[i].className = 'done'; };
    const show = (cls) => { for (const p of ov.querySelectorAll('.si-pane')) p.hidden = !p.classList.contains(cls); };
    (async () => {
      try {
        await wait(350); await mark(0, 400);
        await type(q('.si-user'), 'trader-1');
        await type(q('.si-pw'), 'demo-password-01', true);
        q('.si-btn').classList.add('press'); await wait(350);
        await mark(1, 500); await mark(2, 500);
        show('si-mfa'); li[3].className = 'on'; q('.si-phone').classList.add('hot'); await wait(700);
        const code = codeNow(); const boxes = [...ov.querySelectorAll('.si-boxes span')];
        for (let i = 0; i < 6; i++) { boxes[i].textContent = code[i]; boxes[i].className = 'f'; await wait(160); }
        q('.si-status').textContent = 'Verifying…'; await wait(550);
        q('.si-status').textContent = '✓ Code accepted'; q('.si-status').className = 'si-status ok'; li[3].className = 'done'; q('.si-phone').classList.remove('hot');
        await wait(350); await mark(4, 500);
        show('si-done'); for (const l of li) l.className = 'done';
        await (skip ? new Promise((r) => setTimeout(r, 500)) : wait(1300));
        document.removeEventListener('keydown', onKey); finish(true);
      } catch { /* cancelled */ }
    })();
  });
}

/* ---------- canvas helpers ---------- */
function fitCanvas(cv) {
  const r = cv.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
  const w = Math.max(10, Math.floor(r.width)); const h = Math.max(10, Math.floor(r.height));
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { ctx, w, h };
}
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }

/* series: [{data:[{t,v}], color, label, fill}] ; opts: {min, max, thresholds:[{v,color,label}], yfmt, grid} */
function drawLines(cv, series, opts = {}) {
  const { ctx, w, h } = fitCanvas(cv); ctx.clearRect(0, 0, w, h);
  const padL = 44; const padR = 8; const padT = 8; const padB = 18;
  const all = series.flatMap((s) => s.data.map((d) => d.v)).filter((v) => v != null && !isNaN(v));
  const thr = (opts.thresholds || []).map((t) => t.v);
  const min = opts.min != null ? opts.min : Math.min(0, ...all);
  const max = opts.max != null ? opts.max : niceMax(Math.max(1, ...all, ...thr.map((v) => v * 1.1)));
  const ts = series.flatMap((s) => s.data.map((d) => d.t)); const t1 = ts.length ? Math.max(...ts) : Date.now(); const t0 = opts.span ? t1 - opts.span : (ts.length ? Math.min(...ts) : t1 - 1);
  const X = (t) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (w - padL - padR);
  const Y = (v) => padT + (1 - (v - min) / Math.max(1e-9, max - min)) * (h - padT - padB);
  ctx.font = '10px ui-monospace, Menlo, monospace'; ctx.fillStyle = '#7b8494'; ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const v = min + ((max - min) * i) / 4; const y = Y(v); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke(); ctx.fillText((opts.yfmt || ((x) => fmt(x, x < 10 && max <= 10 ? 1 : 0)))(v), 2, y + 3); }
  const stepT = 60000; for (let t = Math.ceil(t0 / stepT) * stepT; t <= t1; t += stepT) { const x = X(t); ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, h - padB); ctx.stroke(); ctx.fillText(new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), x - 14, h - 4); }
  for (const t of opts.thresholds || []) { const y = Y(t.v); ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = t.color; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke(); ctx.restore(); ctx.fillStyle = t.color; ctx.fillText(t.label || '', w - padR - ctx.measureText(t.label || '').width - 2, y - 3); }
  for (const s of series) {
    const pts = s.data.filter((d) => d.v != null && d.t >= t0); if (pts.length < 2) continue;
    ctx.beginPath(); pts.forEach((d, i) => (i ? ctx.lineTo(X(d.t), Y(d.v)) : ctx.moveTo(X(d.t), Y(d.v))));
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.6; ctx.stroke();
    if (s.fill) { ctx.lineTo(X(pts[pts.length - 1].t), Y(Math.max(min, 0))); ctx.lineTo(X(pts[0].t), Y(Math.max(min, 0))); ctx.closePath(); ctx.globalAlpha = 0.12; ctx.fillStyle = s.color; ctx.fill(); ctx.globalAlpha = 1; }
  }
}

function drawCandles(cv, candles, opts = {}) {
  const { ctx, w, h } = fitCanvas(cv); ctx.clearRect(0, 0, w, h);
  if (!candles || !candles.length) return;
  const padR = 66; const padB = 20; const volH = 50; const n = Math.min(candles.length, Math.floor((w - padR) / 7)); const cs = candles.slice(-n);
  let lo = Math.min(...cs.map((c) => c.l)); let hi = Math.max(...cs.map((c) => c.h)); const pad = (hi - lo) * 0.08 || hi * 0.001; lo -= pad; hi += pad;
  const vmax = Math.max(...cs.map((c) => c.v)) || 1; const cw = (w - padR) / n; const ph = h - padB - volH - 6;
  const Y = (p) => 6 + (1 - (p - lo) / (hi - lo)) * ph;
  ctx.font = '10.5px ui-monospace, Menlo, monospace'; ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.fillStyle = '#848e9c';
  for (let i = 0; i <= 5; i++) { const p = lo + ((hi - lo) * i) / 5; const y = Y(p); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w - padR, y); ctx.stroke(); ctx.fillText(fmt(p, opts.dp != null ? opts.dp : 1), w - padR + 6, y + 3); }
  cs.forEach((c, i) => {
    const x = i * cw + cw / 2; const up = c.c >= c.o; const col = up ? '#0ecb81' : '#f6465d';
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
    const y1 = Y(Math.max(c.o, c.c)); const y2 = Y(Math.min(c.o, c.c)); ctx.fillRect(x - cw * 0.35, y1, cw * 0.7, Math.max(1, y2 - y1));
    const vh = (c.v / vmax) * volH; ctx.globalAlpha = 0.35; ctx.fillRect(x - cw * 0.35, h - padB - vh, cw * 0.7, vh); ctx.globalAlpha = 1;
    if (i % 24 === 0) { ctx.fillStyle = '#5e6673'; ctx.fillText(new Date(c.t).toLocaleTimeString('en-GB', { hour12: false }), x - 22, h - 5); }
  });
  const last = cs[cs.length - 1].c; const y = Y(last); const col = cs[cs.length - 1].c >= cs[cs.length - 1].o ? '#0ecb81' : '#f6465d';
  ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w - padR, y); ctx.stroke(); ctx.restore();
  ctx.fillStyle = col; ctx.fillRect(w - padR + 2, y - 8, padR - 4, 16); ctx.fillStyle = '#fff'; ctx.fillText(fmt(last, opts.dp != null ? opts.dp : 1), w - padR + 6, y + 4);
}
