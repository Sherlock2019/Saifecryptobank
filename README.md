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
./start.sh --install --public --tls   # Node.js 20 if missing, binds 0.0.0.0, HTTPS (self-signed), prints https://<public-ip>:3510
```

- A t3.small (or larger) is enough.
- In the instance Security Group, open inbound **TCP 3510 to your IP only**. The trading UI and ops console have no login; only the mobile app does.
- `--tls` creates a self-signed certificate for the public IP in `.run/tls/`. The browser warns once (Advanced → Proceed). Without `--tls`, traffic, including passwords, is unencrypted.
- Alternative without opening the port: run `./start.sh`, then from your laptop run `ssh -L 3510:127.0.0.1:3510 ubuntu@<ec2-ip>` (`ec2-user@` on Amazon Linux) and browse http://127.0.0.1:3510. This is also the only way to try passkeys, which browsers block on a raw IP address.

## Mobile app (`/mobile`)

A phone-sized customer app: a phone frame on desktop, full screen on a real phone. Sign in with **demo / SaifeDemo!2026** (set `MOBILE_DEMO_PASSWORD` to change it; the hint is then hidden). It trades and withdraws on its own account `cust-1` through the same engine, Guardian and custody controls as the web UI.

First sign-in asks you to set up an authenticator. Enter the setup key in Google or Microsoft Authenticator, 1Password or Authy, or tap **Add to the demo authenticator**, which shows codes in a side panel (a drawer on phones). Save the 8 recovery codes; you need one to report a lost phone.

| Layer | What the server enforces (`mobile-api.js`) |
|---|---|
| Customer identity | Password (scrypt) + TOTP (RFC 6238, each code works once) or a WebAuthn passkey with user verification. 5 failures → 5 min lockout + Guardian alert. |
| Session protection | Server-side session, HttpOnly SameSite=Strict cookie (Secure under TLS), CSRF token, ID rotated after MFA. **Locks after 60 s without interaction**; polling doesn't count. Unlock needs MFA. |
| Lost-device response | "Lost or stolen phone?" on the sign-in screen: password + recovery code → every session ended, devices marked lost, passkeys removed, authenticator reset, withdrawals frozen, case `LOST_DEVICE_REPORTED` opened. A reviewer closing the case (Ops Console) lifts the freeze. Re-enrolment needs another recovery code, so a stolen password is not enough. |
| Authorization | Scopes per session state (MFA pending / enrolment / active / locked). The account always comes from the session; a body field such as `acct: "trader-1"` is ignored. |
| Trading protection | Engine guardrails: tick/lot, ±5% band, max value, rate limit, atomic reservation, idempotent `clientOrderId` (confirm button disabled after one tap, optional retry demo). |
| Withdrawal protection | Fresh TOTP per withdrawal, allowlisted destinations only, new addresses wait 60 s (24 h in production), per-tx caps, $25,000 daily limit, then Guardian screening and the mock signer. |
| Data and secrets | User store `.run/mobile-users.json` is AES-256-GCM encrypted (key from `SAIFE_DATA_KEY` or `.run/data.key`, mode 0600). Recovery codes and session tokens are stored only as hashes. Strict CSP, `X-Frame-Options: DENY`, nosniff, HSTS under TLS. |
| Audit and monitoring | Every auth, lock, device, address and withdrawal event goes to Ops Console → Audit as `cust:demo`. |
| Device attestation (optional) | Browser signals (automation flag, emulator hints, user-agent drift, plain HTTP, new IP) give a risk score; ≥ 60 blocks withdrawals and opens a case. A native app would use App Attest or Play Integrity. |

Security → **Live security checks** sends real attack-style requests (no CSRF token, someone else's account, duplicate order, unknown address, no step-up, over limit) and shows each refusal. Reset the mobile users with `./start.sh --stop && rm .run/mobile-users.json`.

Tunables: `MOBILE_IDLE_MS` (60000), `MOBILE_ALLOWLIST_COOLDOWN_MS` (60000), `MOBILE_DAILY_LIMIT_USD` (25000), `MOBILE_DEMO_PASSWORD`, `SAIFE_DATA_KEY` (64 hex chars).
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
# 44 mobile security checks; needs a fresh user store and short timers:
SAIFE_RUN_DIR=$(mktemp -d) MOBILE_IDLE_MS=6000 MOBILE_ALLOWLIST_COOLDOWN_MS=3000 PORT=3599 node server.js &
node scripts/mobile-smoke.mjs http://127.0.0.1:3599
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
mobile-api.js        mobile auth/security API (/api/m/*)
public/mobile.html   mobile app mockup   public/mobile.js  public/mobile.css  public/totp.js
scripts/mobile-smoke.mjs  mobile security checks
scripts/smoke.mjs    end-to-end checks   scripts/loadtest.mjs  HTTP load test
```
