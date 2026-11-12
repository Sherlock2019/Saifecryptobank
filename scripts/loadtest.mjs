// Real HTTP load test against a running server (measures end-to-end round trips on this machine).
// Usage: node scripts/loadtest.mjs [rps=500] [seconds=20] [baseUrl=http://127.0.0.1:3510]
// Mix: 50% limit orders, 25% cancels, 25% state reads, sent as the authorized 'loadtest' account.
const RPS = Number(process.argv[2] || 500); const SECS = Number(process.argv[3] || 20); const BASE = process.argv[4] || 'http://127.0.0.1:3510';
const H = { 'Content-Type': 'application/json', 'x-demo-user': 'loadtest', 'x-sim-ip': '10.0.7.7' };
const lat = []; let errors = 0; let rejects = 0; let sent = 0; const open = [];
const st = await fetch(BASE + '/api/ops').then((r) => r.json());
const last = (await fetch(BASE + '/api/state').then((r) => r.json())).markets.BTCUSDT.ticker.last;
console.log(`Load test: ${RPS} req/s for ${SECS}s against ${BASE} (server synthetic load currently ${st.load.rps} rps)`);
async function one() {
  const r = Math.random(); const t0 = performance.now(); let res;
  try {
    if (r < 0.5) {
      const side = Math.random() < 0.5 ? 'BUY' : 'SELL'; const px = Math.round(last * (side === 'BUY' ? 0.99 : 1.01) * 10) / 10;
      res = await fetch(BASE + '/api/orders', { method: 'POST', headers: H, body: JSON.stringify({ market: 'BTCUSDT', side, type: 'LIMIT', price: px, qty: 0.001 }) });
      const j = await res.json(); if (j.ok && j.order.status === 'ACCEPTED') open.push(j.order.id);
    } else if (r < 0.75 && open.length) {
      res = await fetch(BASE + '/api/orders/' + open.shift(), { method: 'DELETE', headers: H }); await res.arrayBuffer();
    } else {
      res = await fetch(BASE + '/healthz'); await res.arrayBuffer();
    }
    if (res.status >= 500) errors++; else if (res.status >= 400) rejects++;
  } catch { errors++; }
  lat.push(performance.now() - t0);
}
const t0 = Date.now(); const inflight = new Set();
while (Date.now() - t0 < SECS * 1000) {
  const due = Math.floor(((Date.now() - t0) / 1000) * RPS);
  while (sent < due) { sent++; const p = one(); inflight.add(p); p.finally(() => inflight.delete(p)); }
  await new Promise((r) => setTimeout(r, 2));
}
await Promise.all(inflight);
lat.sort((a, b) => a - b); const q = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))].toFixed(1);
console.log(`sent ${sent} · achieved ${(sent / SECS).toFixed(0)} req/s · 5xx ${errors} · 4xx ${rejects}`);
console.log(`latency ms  p50 ${q(0.5)}  p95 ${q(0.95)}  p99 ${q(0.99)}  max ${lat[lat.length - 1].toFixed(1)}`);
console.log('Note: local round trips only. On AWS, run the same mix with k6/Locust from the agreed geography against the ALB.');
