/* Trade page: order book, chart, trades, order entry, wallet, account tabs. */
const T = { sym: 'BTCUSDT', otype: 'LIMIT', markets: {}, user: null, ops: null, btab: 'open', priceSet: false };
const demo = setupDemoButton($('#demoBtn'));
const mk = () => T.markets[T.sym];
const dp = () => (T.sym === 'BTCUSDT' ? 1 : 2);

async function load() {
  const s = await api('GET', '/api/state');
  T.markets = s.markets; T.user = s.user; T.ops = s.ops; T.priceSet = false;
  demo.set(s.ops.demo.running);
  renderAll();
}

function renderAll() { renderTicker(); renderBook(); renderTrades(true); renderChart(); renderForm(); renderBottom(); renderWallet(); renderGuard(); }

function renderTicker() {
  const m = mk(); if (!m) return; const t = m.ticker;
  $('#tkLast').textContent = fmt(t.last, dp()); $('#tkLast').className = 'tk-last num ' + (t.change >= 0 ? 'up' : 'down');
  $('#tkChg').textContent = (t.change >= 0 ? '+' : '') + fmt(t.change, 2) + '%'; $('#tkChg').className = 'num ' + (t.change >= 0 ? 'up' : 'down');
  $('#tkHigh').textContent = fmt(t.high, dp()); $('#tkLow').textContent = fmt(t.low, dp()); $('#tkVol').textContent = fmt(t.vol, 2) + ' ' + m.base;
  const st = $('#tkStatus');
  if (t.halted) { st.textContent = 'Halted (DR fence)'; st.className = 'down'; } else if (t.failover) { st.textContent = 'Matching failover…'; st.className = 'muted'; } else { st.textContent = 'Trading'; st.className = 'up'; }
  const own = T.ops && T.ops.infra.matching.find((x) => x.market === T.sym);
  if (own) $('#tkOwner').textContent = `${own.owner.pod} · AZ-${own.owner.az} · token ${own.owner.token}`;
  document.title = `${fmt(t.last, dp())} | ${m.base}/USDT · SAIFE Trade`;
}

function bookRows(levels, side, maxTotal) {
  let cum = 0;
  return levels.map(([p, q]) => {
    cum += q; const pct = Math.min(100, (cum / maxTotal) * 100);
    return `<div class="row3" data-p="${p}"><div class="bar" style="width:${pct}%;background:${side === 'ask' ? 'rgba(246,70,93,.13)' : 'rgba(14,203,129,.13)'}"></div><span class="${side === 'ask' ? 'down' : 'up'}">${fmt(p, dp())}</span><span>${fmtQ(q)}</span><span>${fmt(p * q, 2)}</span></div>`;
  }).join('');
}
function renderBook() {
  const m = mk(); if (!m) return; const b = m.book;
  const asks = b.asks.slice(0, 14); const bids = b.bids.slice(0, 14);
  const tot = (a) => a.reduce((s, x) => s + x[1], 0); const maxT = Math.max(tot(asks), tot(bids), 1e-9);
  $('#asks').innerHTML = bookRowsRev(asks, maxT);
  $('#bids').innerHTML = bookRows(bids, 'bid', maxT);
  const t = m.ticker; $('#midPrice').textContent = fmt(t.last, dp()); $('#midPrice').className = 'num ' + (t.change >= 0 ? 'up' : 'down');
  if (asks[0] && bids[0]) $('#spread').textContent = 'spread ' + fmt(asks[0][0] - bids[0][0], dp());
  $('#bkQ').textContent = `Amount (${m.base})`;
}
function bookRowsRev(asks, maxT) { // asks displayed best-at-bottom, cumulative from best
  let cum = 0; const rows = asks.map(([p, q]) => { cum += q; return [p, q, cum]; });
  return rows.reverse().map(([p, q, c]) => `<div class="row3" data-p="${p}"><div class="bar" style="width:${Math.min(100, (c / maxT) * 100)}%;background:rgba(246,70,93,.13)"></div><span class="down">${fmt(p, dp())}</span><span>${fmtQ(q)}</span><span>${fmt(p * q, 2)}</span></div>`).join('');
}

function renderTrades() {
  const m = mk(); if (!m) return;
  $('#tradeList').innerHTML = m.trades.slice(0, 32).map((t) => `<div class="row3"><span class="${t.takerSide === 'BUY' ? 'up' : 'down'}">${fmt(t.price, dp())}</span><span>${fmtQ(t.qty)}</span><span class="muted">${tstr(t.ts)}</span></div>`).join('');
}

function renderChart() {
  const m = mk(); if (!m) return; drawCandles($('#cv'), m.candles, { dp: dp() });
  const c = m.candles[m.candles.length - 1];
  if (c) $('#ohlc').innerHTML = `O <span class="${c.c >= c.o ? 'up' : 'down'}">${fmt(c.o, dp())}</span> H <span>${fmt(c.h, dp())}</span> L <span>${fmt(c.l, dp())}</span> C <span class="${c.c >= c.o ? 'up' : 'down'}">${fmt(c.c, dp())}</span>`;
}

function renderForm() {
  const m = mk(); if (!m || !T.user) return; const b = T.user.balances;
  $('#avQuote').textContent = fmt(b.USDT.avail, 2) + ' USDT'; $('#avBase').textContent = fmtQ(b[m.base].avail) + ' ' + m.base;
  $$('.bU').forEach((e) => { e.textContent = m.base; }); $('#buyBtn').textContent = 'Buy ' + m.base; $('#sellBtn').textContent = 'Sell ' + m.base;
  $$('.lim').forEach((e) => { e.style.display = T.otype === 'LIMIT' ? '' : 'none'; });
  if (!T.priceSet) { $('#bPrice').value = m.ticker.last.toFixed(dp()); $('#sPrice').value = m.ticker.last.toFixed(dp()); T.priceSet = true; }
  calcTotals();
  const f = T.user.flags; const hb = $('#holdBanner');
  if (f.tradingHold) { hb.style.display = ''; hb.innerHTML = '<div class="warnbox">Trading hold applied by risk policy (AI Sentinel case). Waiting for human review.</div>'; } else hb.style.display = 'none';
}
function calcTotals() {
  const m = mk(); if (!m) return; const px = T.otype === 'LIMIT' ? null : m.ticker.last;
  $('#bTot').textContent = fmt((px || +$('#bPrice').value) * +$('#bQty').value, 2) + ' USDT';
  $('#sTot').textContent = fmt((px || +$('#sPrice').value) * +$('#sQty').value, 2) + ' USDT';
}

async function submit(side) {
  const m = mk(); const qty = +$(side === 'BUY' ? '#bQty' : '#sQty').value; const price = +$(side === 'BUY' ? '#bPrice' : '#sPrice').value;
  const body = { market: T.sym, side, type: T.otype, qty, price: T.otype === 'LIMIT' ? price : undefined, clientOrderId: 'web-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) };
  const r = await api('POST', '/api/orders', body);
  if (r.ok) toast(`<b>${side} ${fmtQ(qty)} ${m.base}</b> → ${r.order.status}${r.order.filled ? ` (filled ${fmtQ(r.order.filled)} @ ${fmt(r.order.avgPrice, dp())})` : ''}${r.queued ? ' · queued during matching failover' : ''}<br><span class="muted">ACCEPTED after commit · ${r.order.id}</span>`, 'good');
  else toast(`<b>Rejected: ${esc(r.reason)}</b><br>${esc(r.message || '')}`, 'bad');
  if ($('#retryChk').checked && r.ok) {
    const r2 = await api('POST', '/api/orders', body);
    toast(r2.duplicate ? `<b>Retry with same clientOrderId</b> → same order ${r2.order.id} returned. <span class="up">No duplicate.</span>` : `Retry result: ${esc(r2.reason || r2.order && r2.order.status)}`, r2.duplicate ? 'good' : 'warn', 6000);
  }
}

function renderBottom() {
  if (!T.user) return; const u = T.user; const el = $('#bottomBody'); let h = '';
  const ordRow = (o, cancel) => `<tr><td class="muted">${tstr(o.ts)}</td><td>${o.market.replace('USDT', '/USDT')}</td><td>${o.type}${o.tif === 'IOC' && o.type === 'LIMIT' ? ' IOC' : ''}</td><td class="${o.side === 'BUY' ? 'up' : 'down'}">${o.side}</td><td class="n">${o.type === 'MARKET' ? 'Market' : fmt(o.price, 2)}</td><td class="n">${fmtQ(o.qty)}</td><td class="n">${fmtQ(o.filled)}</td><td class="n">${o.avgPrice ? fmt(o.avgPrice, 2) : '–'}</td><td><span class="chip ${o.status === 'FILLED' ? 'g' : /CANCEL|EXPIRED/.test(o.status) ? '' : 'b'}">${o.status}</span>${o.reason ? ` <span class="dim">${o.reason}</span>` : ''}</td><td class="dim">${esc(o.clientOrderId || '')}</td>${cancel ? `<td><button class="btn sm" data-cancel="${o.id}">Cancel</button></td>` : ''}</tr>`;
  const ordHead = (c) => `<table class="t"><tr><th>Time</th><th>Pair</th><th>Type</th><th>Side</th><th class="n">Price</th><th class="n">Amount</th><th class="n">Filled</th><th class="n">Avg</th><th>Status</th><th>clientOrderId</th>${c ? '<th></th>' : ''}</tr>`;
  if (T.btab === 'open') h = u.open.length ? ordHead(true) + u.open.map((o) => ordRow(o, true)).join('') + '</table>' : '<div class="empty">No open orders</div>';
  if (T.btab === 'hist') h = u.history.length ? ordHead(false) + u.history.map((o) => ordRow(o, false)).join('') + '</table>' : '<div class="empty">No orders yet. Place one, or press ▶ Run demo</div>';
  if (T.btab === 'bal') h = `<table class="t"><tr><th>Asset</th><th class="n">Available</th><th class="n">Reserved (in orders / withdrawals)</th><th class="n">Total</th></tr>${Object.entries(u.balances).map(([k, b]) => `<tr><td><b>${k}</b></td><td class="n">${fmtQ(b.avail)}</td><td class="n">${fmtQ(b.res)}</td><td class="n">${fmtQ(b.avail + b.res)}</td></tr>`).join('')}</table><p class="note" style="padding:0 10px">Balances are integer units (sats / micro-USDT) inside the engine; the reconciliation job checks them against the double-entry ledger every 2 s.</p>`;
  if (T.btab === 'ledger') h = u.ledger.length ? `<table class="t"><tr><th>Time</th><th>Tx</th><th>Type</th><th>Asset</th><th class="n">Amount</th><th>Ref</th></tr>${u.ledger.map((e) => `<tr><td class="muted">${tstr(e.ts)}</td><td class="dim">${e.tx}</td><td>${e.type}</td><td>${e.asset}</td><td class="n ${e.amount >= 0 ? 'up' : 'down'}">${e.amount >= 0 ? '+' : ''}${fmtQ(e.amount)}</td><td class="dim">${esc(e.ref)}</td></tr>`).join('')}</table>` : '<div class="empty">No ledger entries yet. Each trade writes 4 balanced entries (base ±, quote ±)</div>';
  if (T.btab === 'wds') h = u.withdrawals.length ? `<table class="t"><tr><th>Time</th><th>Asset</th><th class="n">Amount</th><th>Destination</th><th>Status</th><th>Risk (shadow)</th><th>Trail</th></tr>${u.withdrawals.map(wdRow).join('')}</table>` : '<div class="empty">No withdrawals</div>';
  el.innerHTML = h;
  $$('[data-cancel]', el).forEach((b) => { b.onclick = async () => { const r = await api('DELETE', '/api/orders/' + b.dataset.cancel); toast(r.ok ? 'Order canceled; reservation released' : esc(r.reason), r.ok ? 'good' : 'bad'); }; });
}
function wdChip(s) { return `<span class="chip ${s === 'CONFIRMED' || s === 'BROADCAST' ? 'g' : s.startsWith('HELD') || s === 'QUEUED_LIQUIDITY' ? 'a' : s === 'CANCELED' ? 'r' : 'b'}">${s}</span>`; }
function wdRow(w) { return `<tr><td class="muted">${tstr(w.ts)}</td><td>${w.asset}</td><td class="n">${fmtQ(w.amount)}</td><td class="dim">${esc(w.address)}</td><td>${wdChip(w.status)}</td><td class="n">${w.risk ? w.risk.score : '–'}</td><td class="muted" style="font-size:11.5px">${w.reasons.map(esc).join(' → ') || 'screening (2 s hold)…'}</td></tr>`; }

function renderWallet() {
  if (!T.user) return; const u = T.user; const asset = $('#wdAsset').value;
  const sel = $('#wdAddr'); const cur = sel.value;
  const opts = (asset === 'BTC' ? ['bc1q-trader-cold-01'] : ['0xTrader-Ledger-01']).map((a) => `<option value="${a}">${a} ✓ allowlisted</option>`).join('') + '<option value="__new">+ New address (not allowlisted)</option>';
  if (sel.dataset.asset !== asset) { sel.innerHTML = opts; sel.dataset.asset = asset; } else if (cur) sel.value = cur;
  $('#wdCustom').style.display = sel.value === '__new' ? '' : 'none';
  $('#wdAv').textContent = `· avbl ${fmtQ(u.balances[asset].avail)} ${asset}`;
  const f = u.flags; const box = $('#stepUpBox');
  if (f.stepUp) box.innerHTML = '<div class="warnbox"><b>Step-up required.</b> AI Sentinel flagged a withdrawal from an unrecognised device. <button class="btn sm y" id="stepUpBtn" style="margin-top:6px">Verify with MFA (mock)</button></div>';
  else if (f.withdrawHold) box.innerHTML = '<div class="warnbox">Withdrawals on hold pending human review.</div>';
  else box.innerHTML = '';
  const sb = $('#stepUpBtn'); if (sb) sb.onclick = async () => { const r = await api('POST', '/api/stepup', { device: $('#wdDev').value }); toast(r.ok ? 'Step-up passed; held withdrawal released to screening' : esc(r.reason), r.ok ? 'good' : 'bad'); };
  if (T.ops) $('#compChips').innerHTML = T.ops.wallets.map((w) => `<span class="chip ${w.paused ? 'r' : 'g'}">${w.asset} hot ${fmtQ(w.hot)}${w.paused ? ' · PAUSED' : ''}</span>`).join('');
}

function renderGuard() {
  if (!T.ops) return; const g = T.ops.guardian; const p = $('#guardPill');
  const crit = T.ops.cases.some((c) => c.status === 'OPEN' && c.severity === 'critical');
  p.className = 'pill ' + (g.outage ? 'bad' : crit ? 'bad' : g.openCases ? 'warn' : '');
  p.lastElementChild.textContent = g.outage ? 'AI Sentinel · OUTAGE (fail-closed)' : `AI Sentinel · ${g.openCases ? g.openCases + ' open case' + (g.openCases > 1 ? 's' : '') : 'watching'}`;
}

// ---- events
$('#pairs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; T.sym = b.dataset.s; $$('#pairs button').forEach((x) => x.classList.toggle('active', x === b)); T.priceSet = false; renderAll(); };
$('#otype').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; T.otype = b.dataset.t; $$('#otype button').forEach((x) => x.classList.toggle('active', x === b)); renderForm(); };
$('#btabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; T.btab = b.dataset.b; $$('#btabs button').forEach((x) => x.classList.toggle('active', x === b)); renderBottom(); };
$('#wtabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; $$('#wtabs button').forEach((x) => x.classList.toggle('active', x === b)); $('#wdPane').style.display = b.dataset.w === 'wd' ? '' : 'none'; $('#depPane').style.display = b.dataset.w === 'dep' ? '' : 'none'; };
$('#buyBtn').onclick = () => submit('BUY'); $('#sellBtn').onclick = () => submit('SELL');
['#bPrice', '#bQty', '#sPrice', '#sQty'].forEach((s) => { $(s).oninput = calcTotals; });
$$('.pct').forEach((row) => { row.onclick = (e) => {
  const b = e.target.closest('button'); if (!b || !T.user) return; const pct = parseInt(b.textContent, 10) / 100; const m = mk();
  if (row.dataset.side === 'BUY') { const px = T.otype === 'LIMIT' ? +$('#bPrice').value : m.ticker.last * 1.05; $('#bQty').value = (Math.floor((T.user.balances.USDT.avail * pct) / px / m.lot) * m.lot).toFixed(4); }
  else $('#sQty').value = (Math.floor((T.user.balances[m.base].avail * pct) / m.lot) * m.lot).toFixed(4);
  calcTotals(); }; });
$('#asks').onclick = $('#bids').onclick = (e) => { const r = e.target.closest('.row3'); if (!r) return; $('#bPrice').value = r.dataset.p; $('#sPrice').value = r.dataset.p; calcTotals(); };
$('#wdAsset').onchange = renderWallet; $('#wdAddr').onchange = renderWallet;
$('#wdBtn').onclick = async () => {
  const addr = $('#wdAddr').value === '__new' ? ($('#wdCustom').value || 'bc1q-new-unverified-01') : $('#wdAddr').value;
  const r = await api('POST', '/api/withdrawals', { asset: $('#wdAsset').value, amount: +$('#wdAmt').value, address: addr, device: $('#wdDev').value });
  if (r.ok) { toast(`<b>Withdrawal ${r.withdrawal.id}</b> → SCREENING (2 s hold while AI Sentinel screens it)`, 'good'); T.btab = 'wds'; $$('#btabs button').forEach((x) => x.classList.toggle('active', x.dataset.b === 'wds')); }
  else toast(`<b>Rejected: ${esc(r.reason)}</b><br>${esc(r.message || '')}`, 'bad');
};
$('#depBtn').onclick = async () => { const r = await api('POST', '/api/deposits', { asset: $('#depAsset').value, amount: +$('#depAmt').value }); toast(r.ok ? 'Deposit credited (simulated confirmation)' : esc(r.message || r.reason), r.ok ? 'good' : 'bad'); };
window.addEventListener('resize', renderChart);

connectStream({
  tick(d) {
    for (const [k, v] of Object.entries(d)) {
      const m = T.markets[k]; if (!m) continue;
      m.ticker = v.ticker; m.book = v.book;
      if (v.trades.length) m.trades = v.trades.slice().reverse().concat(m.trades).slice(0, 60);
      const cs = m.candles; const last = cs[cs.length - 1];
      if (v.candle) { if (last && last.t === v.candle.t) cs[cs.length - 1] = v.candle; else if (!last || v.candle.t > last.t) { cs.push(v.candle); if (cs.length > 240) cs.shift(); } }
    }
    renderTicker(); renderBook(); renderTrades(); renderChart(); calcTotals();
  },
  user(u) { T.user = u; renderForm(); renderBottom(); renderWallet(); },
  ops(o) { T.ops = o; renderGuard(); renderWallet(); renderTicker(); },
  metrics(s) { const p = $('#sloPill'); p.className = 'pill ' + (s.p99 > 100 ? 'bad' : s.p99 > 70 ? 'warn' : ''); p.lastElementChild.textContent = `p99 ${fmt(s.p99, 1)} ms · ${s.rps} req/s`; },
  alert(a) { toast(`<b>AI Sentinel · ${esc(a.severity.toUpperCase())}</b> ${esc(a.title)}<br><span class="muted">${esc(a.summary)}</span>`, 'ai', 7000); },
  narration(n) { showNarration(n, 'trade'); },
  demoEnd() { demo.set(false); },
  reset() { load(); },
});
load();
