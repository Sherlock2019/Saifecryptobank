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
  let running = false;
  const paint = () => { btn.textContent = running ? '■ Stop demo' : '▶ Run demo'; btn.classList.toggle('running', running); };
  btn.onclick = async () => {
    if (running) { await api('POST', '/api/demo/stop'); return; }
    const r = await api('POST', '/api/demo/start');
    if (!r.ok) toast(esc(r.message || r.reason), 'bad'); else { running = true; paint(); }
  };
  return { set(v) { running = v; paint(); } };
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
