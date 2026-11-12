// Smoke test: exercises the main API paths against a running server. Usage: node scripts/smoke.mjs [baseUrl]
const BASE = process.argv[2] || 'http://127.0.0.1:3510';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };
const call = async (method, path, body) => { const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };

await call('POST', '/api/reset');
await sleep(1500);
const s = await call('GET', '/api/state');
ok(s.markets && s.markets.BTCUSDT.book.bids.length > 5, 'order book seeded');

// order + idempotent retry
const cid = 'smoke-' + Date.now();
const o1 = await call('POST', '/api/orders', { market: 'BTCUSDT', side: 'BUY', type: 'MARKET', qty: 0.01, clientOrderId: cid });
ok(o1.ok && o1.order.filled > 0, `market buy filled (${o1.order && o1.order.status})`);
const o2 = await call('POST', '/api/orders', { market: 'BTCUSDT', side: 'BUY', type: 'MARKET', qty: 0.01, clientOrderId: cid });
ok(o2.ok && o2.duplicate && o2.order.id === o1.order.id, 'retry with same clientOrderId returns same order');

// guardrails
const bad = await call('POST', '/api/orders', { market: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: 1, qty: 0.01 });
ok(!bad.ok && bad.reason === 'PRICE_BAND', 'price band guardrail rejects');
const lot = await call('POST', '/api/orders', { market: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: s.markets.BTCUSDT.ticker.last, qty: 0.00001 });
ok(!lot.ok && lot.reason === 'INVALID_LOT', 'lot size guardrail rejects');

// limit + cancel releases reservation
const px = Math.round(s.markets.BTCUSDT.ticker.last * 0.97 * 10) / 10;
const lim = await call('POST', '/api/orders', { market: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: px, qty: 0.01 });
ok(lim.ok && lim.order.status === 'ACCEPTED', 'passive limit rests in book');
const can = await call('DELETE', '/api/orders/' + lim.order.id);
ok(can.ok && can.order.status === 'CANCELED', 'cancel works');

// normal withdrawal broadcasts
const wd = await call('POST', '/api/withdrawals', { asset: 'BTC', amount: 0.05, address: 'bc1q-trader-cold-01', device: 'macbook-chrome' });
ok(wd.ok, 'withdrawal accepted into screening');
await sleep(3500);
let st = await call('GET', '/api/state');
const w1 = st.user.withdrawals.find((x) => x.id === wd.withdrawal.id);
ok(w1 && ['BROADCAST', 'CONFIRMED'].includes(w1.status), `allowlisted withdrawal broadcast (${w1 && w1.status})`);

// new-device high-value withdrawal is held + step-up
const wd2 = await call('POST', '/api/withdrawals', { asset: 'BTC', amount: 0.5, address: 'bc1q-new-unverified-01', device: 'android-new-5521' });
await sleep(1500);
st = await call('GET', '/api/state');
const w2 = st.user.withdrawals.find((x) => x.id === wd2.withdrawal.id);
ok(w2 && w2.status === 'HELD_STEP_UP' && st.user.flags.stepUp, `new-device withdrawal held for step-up (${w2 && w2.status})`);
await call('POST', '/api/stepup', { device: 'android-new-5521' });

// attack: hot wallet drain
const a = await call('POST', '/api/attacks/hot-wallet-drain/run');
ok(a.ok, 'drain scenario started');
await sleep(11000);
const ops = await call('GET', '/api/ops');
ok(ops.attack.last && ops.attack.last.id === 'hot-wallet-drain', 'drain scenario finished');
ok(ops.attack.last.stats.lost === 0, `no BTC left platform in drain (lost ${ops.attack.last.stats.lost})`);
ok(ops.cases.some((c) => c.rule === 'COORDINATED_ACCOUNT_TAKEOVER'), 'coordinated ATO case opened');
ok(ops.wallets.find((w) => w.asset === 'BTC').paused, 'BTC compartment paused');

// prompt injection: privileged calls denied
await call('POST', '/api/attacks/ai-injection/run');
await sleep(7500);
const ops2 = await call('GET', '/api/ops');
ok(ops2.audit.filter((x) => x.decision === 'DENIED').length >= 3, 'compromised-Guardian privileged calls DENIED');

// ledger tamper
await call('POST', '/api/attacks/ledger-tamper/run');
await sleep(6500);
const ops3 = await call('GET', '/api/ops');
const tcs = ops3.cases.filter((c) => c.status === 'OPEN' && ['BALANCE_WITHOUT_LEDGER', 'RECON_MISMATCH'].includes(c.rule));
ok(tcs.length > 0, `unbacked balance detected (${tcs.map((c) => c.rule).join(', ')})`);
ok(ops3.attack.last.stats.lost === 0, 'tampered funds not withdrawn');
for (const tc of tcs) await call('POST', `/api/cases/${tc.id}/resolve`, { decision: 'confirm' });
await sleep(2500);
const ops4 = await call('GET', '/api/ops');
ok(ops4.recon.ok && ops4.recon.accounts.length === 0, 'reconciliation clean after reversal');

// metrics
const m = await fetch(BASE + '/metrics').then((r) => r.text());
ok(/saife_request_latency_ms_bucket/.test(m) && /saife_hot_wallet_balance\{asset="BTC"\}/.test(m), '/metrics exposes Prometheus series');
const last = ops4.last; console.log(`      last second: ${last.rps} req/s, p99 ${last.p99} ms`);

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
