# SAIFE Trade POC

Proof of concept for the **SAFE AWS Trading Platform: Scope of Work** (Dzoan Tran, 12 Nov 2026).

It has two parts:
- an exchange-style spot trading UI running on mock data;
- a backend **Ops Console** with the live AWS architecture, a Grafana-style dashboard, simulated attacks, and the **AI Sentinel (Guardian)** response.

> Simulation only. No real funds, private keys, exchange connectivity or AWS resources. The UI is an original design in a generic dark exchange style (no third-party branding).

## Run

```bash
./start.sh                 # background start, waits until healthy, prints URLs (Node 18+, zero npm deps)
./start.sh --fg            # foreground instead (or: npm start)
./start.sh --status | --logs | --stop
PORT=3511 ./start.sh       # another port (default 3510)
```

Open:
- **Trading UI:** http://127.0.0.1:3510
- **Ops Console:** http://127.0.0.1:3510/ops.html
- **Prometheus metrics:** http://127.0.0.1:3510/metrics

### On AWS EC2 (Amazon Linux 2023 or Ubuntu)

```bash
sudo dnf install -y git || sudo apt-get install -y git
git clone https://github.com/Sherlock2019/Devopsprojectsdemo-DzoanNguyen.git saife && cd saife
./start.sh --install --public   # installs Node.js 20 if missing, binds 0.0.0.0, prints http://<public-ip>:3510
```

- A t3.small (or larger) is enough.
- In the instance Security Group, open inbound **TCP 3510 to your IP only**. The UI has no login.
- Alternative without opening the port: run `./start.sh`, then from your laptop run `ssh -L 3510:127.0.0.1:3510 ec2-user@<ec2-ip>` and browse http://127.0.0.1:3510.
- The server keeps running after you log out (`nohup`). Stop it with `./start.sh --stop`.

Press **▶ Run demo** on either page. The guided demo takes about 75 s and resets the simulation first:

1. Baseline traffic, then a ramp to **500 req/s**, with p99 shown live.
2. A market order, then an idempotent retry using the same `clientOrderId` (no duplicate fill).
3. A normal withdrawal: 2 s screening hold → Sentinel clears it → mock MPC signer → hot wallet shrinks → top-up proposal.
4. **Attack: hot-wallet drain** (2019-style stolen API keys across 8 accounts).
5. **Attack: order flood:** rate limit → Guardian velocity hold → WAF edge block.
6. **Chaos: AZ failure:** matching lease failover with a fencing token, Aurora reader promotion, pod rescheduling.
7. Human review: confirm or dismiss cases, approve treasury top-ups.

## What's in it

| Area | Where | What happens |
|---|---|---|
| Spot trading | Trade page | Limit and market orders, cancel, live book, 5 s candles, trades, open orders, history, balances, ledger |
| Guardrails (TR-02/03) | `placeOrder()` | Tick/lot/min/max notional, ±5% price band, per-account rate limit, atomic reservation, idempotent `clientOrderId`, ACCEPTED only after commit |
| Matching (TR-04) | `matchOrder()` | Price-time priority, self-trade prevention, IOC, partial fills; one fenced owner per market with standby in the other AZ |
| Ledger (TR-05) | `execTrade()` | Integer units (sats, micro-USDT), 4 balanced entries per trade, per-account ledger totals, reconciliation every 2 s |
| Outbox (TR-06) | `emit()` / `guardianTick()` | At-least-once relay injects duplicates; the consumer dedupes by sequence |
| AI Sentinel | `guardianEval()` | Async, never in the order path. Rules: order velocity, spoofing/layering, wash trading, new device + high value, coordinated ATO, balance without ledger, prompt-injection memo, outflow velocity. Shadow-model score is shown but never acts |
| Policy service | `policyApply()` | Allows only pre-approved, reversible actions: holds, step-up, compartment pause. Anything else, such as `SIGN_TX`, is **DENIED** and audited |
| Hot wallets | Ops → Hot Wallets | BTC / ETH / USDC compartments with caps; target = clamp(forecast + fees + 25% buffer); top-ups and sweeps need 2 different human roles, then a mock signer; calculator reproduces the scope example (0.40 + 0.10 → 0.35 BTC) |
| Attack Lab | Ops → Attack Lab | 8 scenarios with a live timeline (attacker / WAF / Sentinel / policy) and a human review queue |
| Grafana-style dashboard | Ops → Grafana | RPS, p50/p95/p99 vs 100 ms SLO, errors/rejects/WAF, Guardian lag, hot-wallet % of cap, pods and CPU per AZ, Alertmanager rules |
| Chaos & DR | Ops → Chaos & DR | Load slider (0–1000 rps), fail/restore an AZ, matching leases, cross-Region DR drill (timings compressed, RPO = snapshot age) |
| Audit (TR-08) | Ops → Audit | Actor, action, target, decision, policy version, case, correlation id |

## What is real vs simulated

- **Real code running on mock data:** order validation, reservation, matching, ledger, reconciliation, outbox and dedupe, Guardian rules, policy allowlist, wallet sizing, approvals, Prometheus text output.
- **Simulated:**
  - CloudFront/WAF, ALB, EKS pods and nodes, Aurora/ElastiCache failover, SQS, Cognito (a fixed `trader-1` session), MPC signer, blockchain (fake txids) and the DR Region.
  - **Latency:** in-process handler time is measured, and modeled AWS hop latency (edge, ALB, Aurora commit) is added. This is a demo signal, not evidence of the AWS p99. On AWS, run the same mix with k6 or Locust from the agreed geography against the ALB.
  - **Synthetic load** runs through the real engine functions in-process. `scripts/loadtest.mjs` measures real HTTP round trips locally.

## Tests

```bash
npm run smoke                       # 20 end-to-end checks (orders, idempotency, guardrails, withdrawals, attacks, recon, /metrics)
node scripts/loadtest.mjs 500 20    # real HTTP load: 500 req/s for 20 s
```

Last local run, 12 Nov 2026:
- Smoke test: 20/20 pass.
- Synthetic load: 518 req/s at p99 ≈ 10 ms (modeled). During an AZ failure, p99 rose to about 150 ms and recovered in about 8 s.
- Real HTTP load test: 500 req/s at p99 2.3 ms (local, single process).

## How it was built

- Single Node.js process (`server.js`), no npm dependencies; state is in memory and resets on restart or via **Reset**.
- Static frontend in `public/`: plain HTML, CSS and JS. The candlestick and Grafana-style charts are drawn on `<canvas>` with a small helper in `common.js`. Live updates use Server-Sent Events (`/api/stream`).
- Built with Claude Code from the scope-of-work PDF, kept as a simple POC. Production items from the scope are deliberately out of scope: CloudFormation templates, Helm charts, a real Cognito integration, a real Prometheus/Grafana deployment, and a real custody provider.

```
server.js            engine + simulation + HTTP/SSE API
public/index.html    trading UI          public/trade.js
public/ops.html      ops console         public/ops.js
public/common.js     helpers + charts    public/style.css
scripts/smoke.mjs    end-to-end checks   scripts/loadtest.mjs  HTTP load test
```
