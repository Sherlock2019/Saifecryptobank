/* Ops console: live architecture, Grafana-style dashboard, attack lab + AI Sentinel, wallets, chaos/DR, audit. */
const O = { ops: null, series: [], tab: 'arch', sel: 'sentinel', timeline: [], timelineId: null };
const demo = setupDemoButton($('#demoBtn'));
const setHTML = (el, html) => { if (el && el._h !== html) { el.innerHTML = html; el._h = html; } };

/* ------------------------------------------------------------------ architecture model */
const GROUPS = [
  { id: 'region', x: 350, y: 20, w: 570, h: 715, label: 'PRIMARY REGION · ap-southeast-1 (Singapore) · Multi-AZ VPC' },
  { id: 'eks', x: 362, y: 46, w: 546, h: 340, label: 'AMAZON EKS · private subnets · managed m7i.xlarge nodes' },
  { id: 'azA', x: 374, y: 72, w: 258, h: 304, label: 'AZ ap-southeast-1a' },
  { id: 'azB', x: 642, y: 72, w: 258, h: 304, label: 'AZ ap-southeast-1b' },
  { id: 'cicd', x: 940, y: 20, w: 290, h: 145, label: 'CI/CD + INFRASTRUCTURE AS CODE' },
  { id: 'custody', x: 940, y: 180, w: 290, h: 395, label: 'CUSTODY · simulated, no real keys' },
  { id: 'drg', x: 940, y: 590, w: 290, h: 145, label: 'RECOVERY REGION · ap-northeast-1' },
];
const NODES = [
  { id: 'users', x: 15, y: 330, w: 130, h: 52, t: 'Traders / Bots', s: 'web · REST · WebSocket', info: 'users' },
  { id: 'r53', x: 172, y: 150, w: 160, h: 48, t: 'Route 53', s: 'DNS + health checks', info: 'r53' },
  { id: 'cf', x: 172, y: 235, w: 160, h: 48, t: 'CloudFront + WAF', s: 'edge · rate-based rules', info: 'cf' },
  { id: 'alb', x: 172, y: 320, w: 160, h: 48, t: 'Application LB', s: 'HTTP + WebSocket · multi-AZ', info: 'alb' },
  { id: 'cognito', x: 172, y: 405, w: 160, h: 48, t: 'Cognito', s: 'user auth · JWT (mocked)', info: 'cognito' },
  ...['a', 'b'].flatMap((z, i) => {
    const x = i ? 656 : 388;
    return [
      { id: 'api-' + z, x, y: 100, w: 230, h: 48, t: 'Order API', s: 'validate · reserve · commit', info: 'api', az: z.toUpperCase(), svc: 'order-api' },
      { id: 'md-' + z, x, y: 165, w: 230, h: 48, t: 'Market data / WebSocket', s: 'book · trades · tickers', info: 'md', az: z.toUpperCase(), svc: 'marketdata' },
      { id: 'gd-' + z, x, y: 230, w: 230, h: 48, t: 'Guardian workers', s: 'consume outbox events', info: 'gd', az: z.toUpperCase(), svc: 'guardian' },
      { id: 'mt-' + z, x, y: 295, w: 230, h: 60, t: 'Matching engine', s: '', info: 'mt', az: z.toUpperCase(), svc: 'matching' },
    ];
  }),
  { id: 'aurora', x: 362, y: 400, w: 176, h: 60, t: 'Aurora PostgreSQL', s: '', info: 'aurora' },
  { id: 'cache', x: 547, y: 400, w: 176, h: 60, t: 'ElastiCache (Valkey)', s: 'market data · risk reads', info: 'cache' },
  { id: 'sqs', x: 732, y: 400, w: 176, h: 60, t: 'Outbox → SQS', s: 'at-least-once events', info: 'sqs' },
  { id: 'sentinel', x: 362, y: 480, w: 270, h: 60, t: 'AI Sentinel (Guardian)', s: 'rules + shadow model · async', info: 'sentinel' },
  { id: 'policy', x: 642, y: 480, w: 266, h: 60, t: 'Policy service', s: 'pre-approved actions only', info: 'policy' },
  { id: 'obs', x: 362, y: 560, w: 546, h: 52, t: 'Prometheus · Grafana · Alertmanager', s: 'scrapes every service · SLO + risk alerts', info: 'obs' },
  { id: 'sec', x: 362, y: 630, w: 546, h: 52, t: 'IAM least privilege · KMS · Secrets Manager · audit log', s: 'IRSA per service · TLS everywhere', info: 'sec' },
  { id: 'gitlab', x: 952, y: 48, w: 130, h: 44, t: 'GitLab CI', s: 'build · test · scan', info: 'gitlab' },
  { id: 'ecr', x: 1090, y: 48, w: 128, h: 44, t: 'Amazon ECR', s: 'signed images', info: 'ecr' },
  { id: 'argo', x: 952, y: 106, w: 130, h: 44, t: 'Argo CD', s: 'GitOps deploy', info: 'argo' },
  { id: 'cfn', x: 1090, y: 106, w: 128, h: 44, t: 'CloudFormation', s: 'VPC · EKS · Aurora', info: 'cfn' },
  { id: 'wpol', x: 952, y: 208, w: 266, h: 50, t: 'Wallet policy engine', s: 'targets · caps · top-up / sweep', info: 'wpol' },
  { id: 'hot-BTC', x: 952, y: 272, w: 84, h: 62, t: 'BTC hot', s: '', info: 'hot' },
  { id: 'hot-ETH', x: 1043, y: 272, w: 84, h: 62, t: 'ETH hot', s: '', info: 'hot' },
  { id: 'hot-USDC', x: 1134, y: 272, w: 84, h: 62, t: 'USDC hot', s: '', info: 'hot' },
  { id: 'signer', x: 952, y: 352, w: 266, h: 50, t: 'MPC / HSM signer (mock)', s: 'allowlists · 2 approvals · caps', info: 'signer' },
  { id: 'cold', x: 952, y: 420, w: 266, h: 50, t: 'Cold custody', s: 'offline · independent approvals', info: 'cold' },
  { id: 'chain', x: 952, y: 500, w: 266, h: 50, t: 'Blockchain (simulated)', s: 'fake txids · no real broadcast', info: 'chain' },
  { id: 'drsnap', x: 952, y: 618, w: 266, h: 48, t: 'Cross-Region snapshot copies', s: 'Aurora + config backups', info: 'dr' },
  { id: 'drbuild', x: 952, y: 676, w: 266, h: 48, t: 'Rebuild: CFN + Argo CD + reconcile', s: 'activated only during DR', info: 'dr' },
];
const EDGES = [
  ['users', 'r53'], ['r53', 'cf'], ['users', 'cf'], ['cf', 'alb'], ['alb', 'cognito'],
  ['alb', 'api-a'], ['alb', 'md-a'], ['mt-a', 'aurora'], ['mt-b', 'sqs'],
  ['sqs', 'sentinel'], ['sentinel', 'policy'], ['policy', 'wpol'],
  ['wpol', 'hot-BTC'], ['wpol', 'hot-ETH'], ['wpol', 'hot-USDC'], ['hot-BTC', 'signer'], ['hot-ETH', 'signer'], ['hot-USDC', 'signer'],
  ['cold', 'signer'], ['gitlab', 'ecr'], ['ecr', 'argo'], ['argo', 'G:eks'],
  { id: 'api-mt-a', from: 'api-a', to: 'mt-a', d: 'M388 124 H381 V325 H386' },
  { id: 'api-mt-b', from: 'api-b', to: 'mt-b', d: 'M656 124 H649 V325 H654' },
  { id: 'md-cache', from: 'md-a', to: 'cache', d: 'M618 189 H637 V398' },
  { id: 'aurora-sqs', from: 'aurora', to: 'sqs', d: 'M450 460 V470 H820 V462' },
  { id: 'signer-chain', from: 'signer', to: 'chain', d: 'M1218 377 H1226 V525 H1220' },
  { id: 'aurora-dr', from: 'aurora', to: 'drsnap', d: 'M362 430 H355 V728 H936 V642 H950' },
  { id: 'alb-b', from: 'alb', to: 'api-b', d: 'M332 344 H342 V8 H771 V98' },
];
const ATTACK_NODES = {
  'hot-wallet-drain': ['users', 'cf', 'alb', 'api-a', 'api-b', 'sqs', 'sentinel', 'policy', 'wpol', 'hot-BTC'],
  'ato-new-device': ['users', 'cognito', 'alb', 'api-a', 'sqs', 'sentinel', 'policy', 'hot-BTC'],
  'order-flood': ['users', 'r53', 'cf', 'alb', 'api-a', 'api-b', 'sentinel', 'policy', 'sqs'],
  spoofing: ['users', 'alb', 'api-a', 'mt-a', 'aurora', 'sqs', 'sentinel'],
  'wash-trading': ['users', 'alb', 'api-a', 'mt-a', 'aurora', 'sqs', 'sentinel', 'policy'],
  'ledger-tamper': ['aurora', 'sqs', 'sentinel', 'policy', 'wpol', 'hot-BTC', 'signer'],
  'guardian-outage': ['gd-a', 'gd-b', 'sqs', 'sentinel', 'policy', 'hot-BTC'],
  'ai-injection': ['users', 'alb', 'api-a', 'sqs', 'sentinel', 'policy', 'signer', 'cold'],
};
const INFO = {
  users: { t: 'Traders, bots & apps', role: 'Browser UI, REST and WebSocket clients. Market makers run as authorized bots with their own rate limits.', poc: 'Trade page + in-process load bots (BTC/ETH markets).' },
  r53: { t: 'Amazon Route 53', role: 'DNS with health checks; points at CloudFront and fails over to a maintenance page during regional DR.', why: 'Managed, global, health-check-driven failover.', alt: 'Route 53 + Global Accelerator: static anycast IPs and faster regional failover, but extra cost.', poc: 'Represented in the DR drill (fence + failover step).' },
  cf: { t: 'CloudFront + AWS WAF', role: 'TLS termination at the edge, static asset caching, managed rule groups and rate-based rules that drop abusive IPs before they reach the Region.', why: 'Filtering at the edge protects ALB/EKS capacity and latency budgets.', alt: 'WAF on ALB only: simpler, but bad traffic already reaches the Region.', poc: 'Simulated rate rule (100 req / 5 s demo threshold) in the order-flood attack.' },
  alb: { t: 'Application Load Balancer', role: 'Routes HTTP + WebSocket to Order API and market-data pods in both AZs; health checks drain targets in a failed AZ.', why: 'Native WebSocket support and lowest added latency for the 100 ms p99 budget.', alt: 'API Gateway: built-in throttling/keys, but extra cost and latency to test.', poc: 'Modeled as part of per-request hop latency.' },
  cognito: { t: 'Amazon Cognito', role: 'Customer sign-in, MFA, JWTs validated by the Order API (TR-01). Step-up auth for risky withdrawals.', why: 'Managed auth with MFA out of the box.', alt: 'External IdP (Auth0/Okta): richer features, vendor cost.', poc: 'Mocked: fixed trader-1 session; "Verify with MFA (mock)" button for step-up.' },
  api: { t: 'Order API (stateless)', role: 'Authenticate, validate tick/lot/notional/price band, enforce limits, idempotency by clientOrderId, reserve balance atomically and commit before returning ACCEPTED (TR-02/03).', why: 'Stateless pods scale horizontally behind the ALB; ≥1 replica per AZ.', alt: 'ECS services: simpler, less Kubernetes ecosystem.', poc: 'Real code: placeOrder() in server.js.', scale: 'HPA on CPU / RPS / p99; spread across AZs with topology constraints + PDB.' },
  md: { t: 'Market data / WebSocket', role: 'Fans out order-book deltas, trades and tickers. Reads from cache/read models, never the ledger (TR-07).', poc: 'Server-Sent Events stream at /api/stream (300 ms batches).', scale: 'Scale by connection count; add pub/sub fan-out tier.' },
  gd: { t: 'Guardian workers', role: 'Pods that run the AI Sentinel consumers. Stateless; resume from the queue after a crash.', poc: 'guardianTick() every 200 ms; "Guardian outage" scenario crashes them.', scale: 'KEDA / HPA on queue lag.' },
  mt: { t: 'Matching engine', role: 'One active owner per market holds a lease with a monotonically increasing fencing token; a standby in the other AZ takes over. Stale owners are rejected (TR-04).', why: 'Deterministic, sequenced matching without dual ownership.', poc: 'Real price-time matching with self-trade prevention; AZ failover replays queued orders.', scale: 'Shard markets across workers; pin hot markets to dedicated nodes.' },
  aurora: { t: 'Aurora PostgreSQL', role: 'System of record: orders, reservations, trades, double-entry ledger and the transactional outbox, in one ACID transaction (TR-05/06). Writer + reader in different AZs.', why: 'Transactions + fast Multi-AZ failover.', alt: 'RDS PostgreSQL Multi-AZ: cheaper, different failover/scaling model.', poc: 'In-memory integer-unit ledger + per-account ledger totals; failover simulated.', scale: 'Scale writer up, readers out; partition ledger/history by time.' },
  cache: { t: 'ElastiCache (Valkey)', role: 'Hot reads: tickers, book snapshots, risk counters. Not the ledger, so losing it never loses money state.', alt: 'DynamoDB: managed KV with different access patterns.', poc: 'Represented in failover; data served from memory.' },
  sqs: { t: 'Transactional outbox → SQS', role: 'Events are written in the same DB transaction, then relayed at-least-once. Consumers deduplicate by sequence (TR-06).', why: 'Simple, managed, cheap; decouples Guardian from the order path.', alt: 'Amazon MSK (Kafka): replay + ordering at scale, more operational complexity.', poc: 'Outbox array; relay randomly injects duplicates to prove idempotent consumption.' },
  sentinel: { t: 'AI Sentinel (Guardian)', role: 'Consumes committed events asynchronously, never in the execution path. Deterministic rules decide; an ML model scores in shadow mode only. Creates explainable cases for human review.', why: 'Fast detection without adding latency or fragility to order entry.', poc: 'Rules: order velocity, spoofing, wash trading, new-device high value, coordinated ATO, balance-without-ledger, prompt injection, outflow velocity.' },
  policy: { t: 'Policy service', role: 'The only path from the Guardian to any action. Allows a fixed set of pre-approved, reversible restrictions (holds, step-up, compartment pause). Everything else is denied and audited.', why: 'Limits blast radius of a wrong or compromised AI.', poc: 'policyApply() with an explicit allowlist; see the prompt-injection scenario.' },
  obs: { t: 'Prometheus · Grafana · Alertmanager', role: 'p99, errors, saturation, order backlog, queue age, Guardian lag, hot balances vs caps, reconciliation status. Monitoring runs in both AZs.', alt: 'Amazon Managed Prometheus + Managed Grafana: less admin, service charges.', poc: '/metrics endpoint (Prometheus text) + Grafana-styled tab.' },
  sec: { t: 'Security baseline', role: 'IAM roles per service account (IRSA), KMS encryption, Secrets Manager, network isolation, image/dependency scanning, audit trail (TR-08).', poc: 'Audit log tab records every automated and human decision.' },
  gitlab: { t: 'GitLab CI', role: 'Build, unit/integration tests, SAST/dependency/image scans, Helm chart lint.', alt: 'GitHub Actions / CodePipeline.', poc: 'Not part of the local POC (design only).' },
  ecr: { t: 'Amazon ECR', role: 'Private image registry with scan-on-push and immutable tags.', alt: 'GitLab Registry: integrated with GitLab, adds a dependency.', poc: 'Design only.' },
  argo: { t: 'Argo CD', role: 'GitOps: cluster state follows Git; staged rollouts, quick rollback; recreates apps in the DR Region.', poc: 'Represented in the DR drill.' },
  cfn: { t: 'AWS CloudFormation', role: 'VPC, EKS, Aurora, ElastiCache, SQS, IAM as code. The same templates rebuild the stack in the recovery Region.', alt: 'AWS CDK (generates CloudFormation) / Terraform.', poc: 'Represented in the DR drill.' },
  wpol: { t: 'Wallet policy engine', role: 'Per asset/network: target = clamp(forecast + fees + buffer, min, cap). Proposes top-ups and sweeps; never executes without two independent human approvals.', poc: 'walletTick() + approvals in the Hot Wallets tab.' },
  hot: { t: 'Hot-wallet compartment', role: 'Separate keys, limits and caps per asset & network. Loss in a compromise is bounded by the compartment balance; cold custody stays unreachable.', poc: 'Simulated balances; pause/resume; USDC withdrawals consume ETH gas.' },
  signer: { t: 'MPC / HSM signer (mock)', role: 'Signs only if destination is allowlisted, amount within caps, approvals present and the account reconciles. Keys never reach AI, logs or CI.', alt: 'Vetted custody provider vs custom CloudHSM-based custody.', poc: 'Mock signer: policy checks + fake txid.' },
  cold: { t: 'Cold custody', role: 'Bulk of funds offline; independent approvals for any movement to hot.', poc: 'Static simulated balance.' },
  chain: { t: 'Blockchain (simulated)', role: 'Broadcast & confirmations; reconciliation compares chain balances with internal records.', poc: 'Fake txids; chain balance tracked for reconciliation.' },
  dr: { t: 'Regional DR: backup & restore', role: 'Cross-Region snapshot copies; on disaster: fence old primary, rebuild with CloudFormation, restore Aurora, Argo CD sync, reconcile, human approval, resume. RPO = snapshot age (non-zero).', alt: 'Aurora Global Database + pilot light: faster RTO / ~1 s RPO, higher cost.', poc: 'Chaos & DR tab → Run DR drill (timings compressed).' },
};
const SVC_ROWS = [
  ['DNS', 'Route 53', 'Managed DNS / TTL affects failover', 'Route 53 + Global Accelerator', 'Static IPs, faster regional routing / extra cost', 'DR drill step'],
  ['Content delivery', 'CloudFront', 'Edge caching / config & transfer cost', 'Direct S3 or ALB', 'Simpler / no edge caching', 'modeled hop'],
  ['Web protection', 'WAF on CloudFront', 'Filters at the edge / rules need tuning', 'WAF on ALB', 'Regional only / traffic reaches Region first', 'simulated rate rule'],
  ['API entry', 'Application Load Balancer', 'HTTP + WebSocket / API controls need design', 'API Gateway', 'Managed API controls / extra cost & latency', 'modeled hop'],
  ['Customer identity', 'Cognito', 'Managed auth / integration constraints', 'External IdP', 'Flexible / vendor cost', 'mocked session + step-up'],
  ['Containers', 'EKS', 'Kubernetes ecosystem / cluster ops', 'ECS', 'Simpler / less portability', 'simulated pods per AZ'],
  ['Compute', 'EKS managed EC2 nodes (m7i.xlarge)', 'Node control / capacity & patching', 'EKS on Fargate', 'Less node mgmt / less host control', 'simulated nodes'],
  ['Database', 'Aurora PostgreSQL', 'Transactions + failover / cost & perf testing', 'RDS PostgreSQL Multi-AZ', 'Managed PG / different scaling & failover', 'in-memory ledger'],
  ['Cache', 'ElastiCache (Valkey)', 'Fast reads / cache consistency', 'DynamoDB', 'Managed KV / different access patterns', 'in-memory'],
  ['Events', 'SQS + transactional outbox', 'Managed queues / limited replay', 'MSK (Kafka)', 'Streaming + replay / more complexity', 'outbox + dedupe'],
  ['Registry', 'ECR', 'AWS-integrated / storage & replication cost', 'GitLab Registry', 'Integrated / GitLab dependency', 'design only'],
  ['Monitoring', 'Prometheus + Grafana on EKS', 'Full control / team runs the stack', 'AMP + AMG', 'Less admin / service charges', '/metrics + dashboard'],
  ['IaC', 'CloudFormation', 'AWS-native / template maintenance', 'AWS CDK', 'Reusable code / extra tooling', 'design only'],
  ['AZ recovery', 'Multi-AZ EKS + Aurora', 'AZ resilience / spare capacity cost', 'Single AZ', 'Cheaper / AZ loss = outage', 'AZ failure chaos test'],
  ['Regional DR', 'Cross-Region backup & restore', 'Lower cost / slower RTO, non-zero RPO', 'Aurora Global DB + pilot light', 'Faster / higher cost', 'DR drill'],
  ['Wallet custody', 'Vetted custody provider or MPC/HSM', 'Controlled signing / provider evaluation', 'Custom CloudHSM custody', 'More control / more responsibility', 'mock signer'],
];
const SCALE_ROWS = [
  ['Order API', '2 pods (1 per AZ)', 'CPU > 60%, p99 > 60 ms, RPS per pod', 'HPA to N pods; Cluster Autoscaler / Karpenter adds nodes', 'Split read APIs from write path; per-region API tier'],
  ['Matching engine', '1 active + 1 standby per market', 'Per-market CPU / queue depth', 'Shard markets across more workers', 'Dedicated pinned nodes, snapshot + journal recovery'],
  ['Aurora PostgreSQL', 'db.r7g.large writer + reader', 'Writer CPU / commit latency / IOPS', 'Scale writer up; readers for history', 'Partition ledger by time/account; separate history store'],
  ['Events', 'SQS', 'Queue age / consumer lag', 'More consumers (KEDA)', 'MSK when replay + multi-consumer ordering needed'],
  ['Market data', '2 WebSocket pods', 'Connections / msgs per second', 'Scale pods; cache pub/sub fan-out', 'Dedicated fan-out tier, edge distribution'],
  ['AI Sentinel', '2 workers, rules + shadow model', 'Guardian lag > 1 s', 'Scale on lag', 'Promote model from shadow only after measured precision/recall'],
  ['Edge', 'CloudFront + WAF + ALB', 'Auto-scaling managed services', 'Tune WAF rules, Shield Advanced', 'Global Accelerator for static IPs / API latency'],
  ['Region', 'Single Region + backup/restore', 'RTO/RPO requirements tighten', 'Pilot light in DR Region', 'Aurora Global Database, warm standby'],
  ['Cost', '~$1.35k/month baseline (compute + DB + cache, excl. usage)', 'Steady utilisation known', 'Graviton nodes, Savings Plans', 'Spot for stateless / batch (load tests, Guardian backfill)'],
];

/* ------------------------------------------------------------------ architecture render */
const nodeById = Object.fromEntries(NODES.map((n) => [n.id, n]));
const groupById = Object.fromEntries(GROUPS.map((g) => [g.id, g]));
function anchor(a, b) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }; const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  if (b.x >= a.x + a.w) return [a.x + a.w, ac.y, b.x, bc.y];
  if (b.x + b.w <= a.x) return [a.x, ac.y, b.x + b.w, bc.y];
  if (b.y >= a.y + a.h) return [ac.x, a.y + a.h, Math.min(Math.max(ac.x, b.x + 10), b.x + b.w - 10), b.y];
  return [ac.x, a.y, Math.min(Math.max(ac.x, b.x + 10), b.x + b.w - 10), b.y + b.h];
}
function buildArch() {
  const svg = $('#archSvg');
  let h = '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="#6b7686"/></marker></defs>';
  for (const g of GROUPS) h += `<rect class="grp" id="g-${g.id}" x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="10"/><text class="glabel" x="${g.x + 10}" y="${g.y + 15}">${g.label}</text>`;
  for (const e of EDGES) {
    let id; let d;
    if (Array.isArray(e)) {
      const a = nodeById[e[0]]; const b = e[1].startsWith('G:') ? groupById[e[1].slice(2)] : nodeById[e[1]];
      const [x1, y1, x2, y2] = anchor(a, b); id = e[0] + '__' + e[1]; d = `M${x1} ${y1} L${x2} ${y2}`;
    } else { id = e.id; d = e.d; }
    h += `<path class="edge flow" id="e-${id}" d="${d}"/>`;
  }
  for (const n of NODES) {
    h += `<g class="nd ok" id="n-${n.id}" data-id="${n.id}"><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6"/>
      <text x="${n.x + n.w / 2}" y="${n.y + (n.h > 52 ? 22 : 20)}" text-anchor="middle">${esc(n.t)}</text>
      <text class="s" id="s-${n.id}" x="${n.x + n.w / 2}" y="${n.y + (n.h > 52 ? 40 : 36)}" text-anchor="middle">${esc(n.s)}</text>
      ${n.h > 52 ? `<text class="s" id="s2-${n.id}" x="${n.x + n.w / 2}" y="${n.y + 54}" text-anchor="middle"></text>` : ''}</g>`;
  }
  svg.innerHTML = h;
  svg.onclick = (e) => { const g = e.target.closest('.nd'); if (g) { O.sel = g.dataset.id; renderDetail(); paintArch(); } };
  $('#svcTable').innerHTML = '<tr><th>Function</th><th>Selected</th><th>Benefit / trade-off</th><th>Alternative</th><th>Benefit / trade-off</th><th>In this POC</th></tr>' + SVC_ROWS.map((r) => `<tr><td class="muted">${r[0]}</td><td><b>${r[1]}</b></td><td>${r[2]}</td><td>${r[3]}</td><td class="muted">${r[4]}</td><td><span class="chip">${r[5]}</span></td></tr>`).join('');
  $('#scaleTable').innerHTML = '<tr><th>Component</th><th>Start</th><th>Scale trigger</th><th>Next step</th><th>Beyond</th></tr>' + SCALE_ROWS.map((r) => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td class="muted">${r[2]}</td><td>${r[3]}</td><td class="muted">${r[4]}</td></tr>`).join('');
  renderDetail();
}
function setSub(id, txt, line = 1) { const el = $(`#${line === 2 ? 's2' : 's'}-${id}`); if (el && el.textContent !== txt) el.textContent = txt; }
function paintArch() {
  const o = O.ops; if (!o) return; const I = o.infra; const st = {};
  const pod = (svc, az) => I.pods.find((p) => p.svc === svc && p.home === az && !p.replacement);
  for (const n of NODES) st[n.id] = 'ok';
  for (const n of NODES.filter((x) => x.az)) {
    const p = pod(n.svc, n.az); if (!I.azs[n.az].up || (p && p.status !== 'Running')) st[n.id] = 'down';
  }
  for (const z of ['A', 'B']) {
    const roles = I.matching.map((m) => (m.owner.az === z ? `ACTIVE ${m.market.replace('USDT', '')} · token ${m.owner.token}` : m.standby.az === z ? `standby ${m.market.replace('USDT', '')}` : null)).filter(Boolean);
    setSub('mt-' + z.toLowerCase(), roles[0] || (I.azs[z].up ? 'idle' : 'AZ DOWN')); setSub('mt-' + z.toLowerCase(), roles[1] || '', 2);
    if (I.matching.some((m) => m.failover)) st['mt-' + z.toLowerCase()] = st['mt-' + z.toLowerCase()] === 'down' ? 'down' : 'warn';
  }
  setSub('aurora', `writer AZ-${I.aurora.writer} · reader ${I.aurora.reader.length > 1 ? I.aurora.reader : 'AZ-' + I.aurora.reader}`); setSub('aurora', I.aurora.state === 'available' ? I.aurora.cls : 'FAILING OVER…', 2);
  if (I.aurora.state !== 'available') st.aurora = 'warn';
  if (I.cache.state !== 'available') st.cache = 'warn';
  if (!I.azs.A.up || !I.azs.B.up) st.alb = 'warn';
  if (o.guardian.outage) { st.sentinel = 'down'; st['gd-a'] = 'down'; st['gd-b'] = 'down'; }
  setSub('sqs', `depth ${o.last.outbox ?? 0} · dup dropped ${o.guardian.dupDropped}`);
  if ((o.last.outbox || 0) > 2000) st.sqs = 'warn';
  setSub('sentinel', o.guardian.outage ? 'OUTAGE → fail-closed fallback' : `${o.guardian.openCases} open cases · lag ${o.guardian.lagMs} ms`);
  if (o.guardian.openCases && st.sentinel === 'ok') st.sentinel = 'hot';
  const recentDeny = o.audit.find((a) => a.decision === 'DENIED' && Date.now() - a.ts < 15000);
  setSub('policy', recentDeny ? `DENIED ${recentDeny.action}` : 'pre-approved actions only'); if (recentDeny) st.policy = 'hot';
  if (o.waf.blockedIps.length) { st.cf = 'hot'; setSub('cf', `blocking ${o.waf.blockedIps.length} IP · ${o.waf.blockedTotal} dropped`); } else setSub('cf', 'edge · rate-based rules');
  for (const w of o.wallets) { setSub('hot-' + w.asset, `${fmtQ(w.hot)}/${fmtQ(w.cap)}`); setSub('hot-' + w.asset, w.paused ? 'PAUSED' : fmt((w.hot / w.cap) * 100, 0) + '% of cap', 2); if (w.paused) st['hot-' + w.asset] = 'warn'; }
  if (o.wallets.some((w) => w.paused)) st.wpol = 'warn';
  if (I.dr.running) { st.drsnap = 'hot'; st.drbuild = 'hot'; }
  setSub('obs', `scrapes every service · ${computeAlerts().filter((a) => a.firing).length} alerts firing`);
  const act = o.attack.active ? ATTACK_NODES[o.attack.active.id] || [] : [];
  for (const id of act) if (st[id] === 'ok') st[id] = 'hot';
  for (const n of NODES) { const el = $('#n-' + n.id); const cls = 'nd ' + st[n.id] + (O.sel === n.id ? ' sel' : ''); if (el.getAttribute('class') !== cls) el.setAttribute('class', cls); }
  for (const z of ['A', 'B']) $('#g-az' + z).setAttribute('class', 'grp' + (I.azs[z].up ? '' : ' az-down'));
  for (const e of EDGES) {
    const [f, t, id] = Array.isArray(e) ? [e[0], e[1], e[0] + '__' + e[1]] : [e.from, e.to, e.id];
    const hot = act.includes(f) && (act.includes(t) || t.startsWith('G:'));
    const down = st[f] === 'down' || st[t] === 'down';
    const el = $('#e-' + id); const cls = 'edge ' + (hot ? 'hot' : down ? '' : 'flow'); if (el.getAttribute('class') !== cls) el.setAttribute('class', cls);
  }
}
function renderDetail() {
  const n = nodeById[O.sel]; const i = INFO[n.info] || {};
  $('#archDetail').innerHTML = `<h4>${esc(i.t || n.t)}</h4>${n.az ? `<span class="chip">AZ-${n.az}</span>` : ''}
    <div class="k">Role</div><p>${esc(i.role || '')}</p>
    ${i.why ? `<div class="k">Why this service</div><p>${esc(i.why)}</p>` : ''}
    ${i.alt ? `<div class="k">Alternative considered</div><p class="muted">${esc(i.alt)}</p>` : ''}
    ${i.scale ? `<div class="k">Scaling</div><p>${esc(i.scale)}</p>` : ''}
    <div class="k">In this POC</div><p><span class="chip p">${esc(i.poc || 'design only')}</span></p>`;
}

/* ------------------------------------------------------------------ grafana-style dashboard */
const PANELS = [
  { id: 'sRps', type: 'stat', span: 2, h: 92, title: 'Requests / s' }, { id: 'sP99', type: 'stat', span: 2, h: 92, title: 'p99 latency' },
  { id: 'sErr', type: 'stat', span: 2, h: 92, title: 'Error rate (5xx)' }, { id: 'sLag', type: 'stat', span: 2, h: 92, title: 'Guardian lag' },
  { id: 'sCases', type: 'stat', span: 2, h: 92, title: 'Open Sentinel cases' }, { id: 'sRecon', type: 'stat', span: 2, h: 92, title: 'Ledger reconciliation' },
  { id: 'cThr', span: 6, h: 230, title: 'Throughput', legend: [['req/s', '#73bf69'], ['orders/s', '#5794f2'], ['trades/s', '#fade2a']] },
  { id: 'cLat', span: 6, h: 230, title: 'API latency (ms)', legend: [['p50', '#73bf69'], ['p95', '#fade2a'], ['p99', '#f2495c'], ['SLO 100 ms', '#f2495c']] },
  { id: 'cErr', span: 4, h: 210, title: 'Errors · rejects · WAF drops (/s)', legend: [['5xx', '#f2495c'], ['4xx guardrails', '#ff9830'], ['WAF', '#b877d9']] },
  { id: 'cGd', span: 4, h: 210, title: 'Guardian lag (ms) · outbox depth', legend: [['lag ms', '#b877d9'], ['outbox depth', '#5794f2']] },
  { id: 'cHot', span: 4, h: 210, title: 'Hot wallet utilisation (% of cap)', legend: [['BTC', '#ff9830'], ['ETH', '#8ab8ff'], ['USDC', '#73bf69']] },
  { id: 'cPods', span: 4, h: 200, title: 'Ready pods per AZ', legend: [['AZ-a', '#5794f2'], ['AZ-b', '#73bf69']] },
  { id: 'cCpu', span: 4, h: 200, title: 'Node CPU % per AZ (modeled)', legend: [['AZ-a', '#5794f2'], ['AZ-b', '#73bf69']] },
  { id: 'alerts', type: 'list', span: 4, h: 200, title: 'Alertmanager' },
];
function buildGrafana() {
  $('#gf').innerHTML = PANELS.map((p) => `<div class="gp ${p.type || ''}" style="grid-column:span ${p.span};height:${p.h}px"><div class="gt"><span>${p.title}</span><span class="dim" id="${p.id}-r"></span></div>
    <div class="gb" id="${p.id}-b" ${p.type === 'list' ? 'style="overflow:auto;display:block"' : ''}>${p.type ? '' : `<canvas id="${p.id}"></canvas>`}</div>
    ${p.legend ? `<div class="lg">${p.legend.map(([l, c]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>` : ''}</div>`).join('');
}
function computeAlerts() {
  const s = O.series; const last = s[s.length - 1] || {}; const o = O.ops; if (!o) return [];
  const last3 = s.slice(-3);
  return [
    { name: 'TradingApiP99High', desc: 'p99 > 100 ms for 3 samples', firing: last3.length === 3 && last3.every((x) => x.p99 > 100) },
    { name: 'ApiErrorRate', desc: '5xx > 1% of requests', firing: last.rps > 0 && last.errors / last.rps > 0.01 },
    { name: 'GuardianLagHigh', desc: 'Guardian lag > 3 s or outage', firing: o.guardian.outage || o.guardian.lagMs > 3000 },
    { name: 'LedgerReconciliationFailed', desc: 'balances ≠ ledger', firing: !o.recon.ok || o.recon.accounts.length > 0 },
    { name: 'HotWalletCompartmentPaused', desc: o.wallets.filter((w) => w.paused).map((w) => w.asset).join(', ') || 'any compartment paused', firing: o.wallets.some((w) => w.paused) },
    { name: 'AvailabilityZoneDown', desc: 'nodes NotReady in an AZ', firing: !o.infra.azs.A.up || !o.infra.azs.B.up },
    { name: 'SentinelCriticalCase', desc: 'open critical case awaiting review', firing: o.cases.some((c) => c.status === 'OPEN' && c.severity === 'critical') },
    { name: 'WafRateRuleBlocking', desc: 'edge is dropping traffic', firing: s.slice(-10).some((x) => x.waf > 0) },
  ];
}
function renderGrafana() {
  const s = O.series; const last = s[s.length - 1]; if (!last || !O.ops) return;
  const ser = (k, c, f) => ({ data: s.map((x) => ({ t: x.t, v: f ? f(x) : x[k] })), color: c });
  const span = 5 * 60 * 1000;
  const stat = (id, v, color) => { const el = $('#' + id + '-b'); setHTML(el, `<span style="color:${color}">${v}</span>`); };
  stat('sRps', fmt(last.rps, 0), last.rps >= 500 ? '#73bf69' : '#ccccdc');
  stat('sP99', fmt(last.p99, 1) + ' ms', last.p99 > 100 ? '#f2495c' : last.p99 > 70 ? '#ff9830' : '#73bf69');
  stat('sErr', fmt(last.rps ? (last.errors / last.rps) * 100 : 0, 2) + '%', last.errors ? '#f2495c' : '#73bf69');
  stat('sLag', O.ops.guardian.outage ? 'OUTAGE' : fmt(last.guardianLag, 0) + ' ms', O.ops.guardian.outage || last.guardianLag > 3000 ? '#f2495c' : '#73bf69');
  stat('sCases', last.casesOpen, last.casesOpen ? '#ff9830' : '#73bf69');
  stat('sRecon', O.ops.recon.ok && !O.ops.recon.accounts.length ? 'OK' : 'MISMATCH', O.ops.recon.ok && !O.ops.recon.accounts.length ? '#73bf69' : '#f2495c');
  drawLines($('#cThr'), [ser('rps', '#73bf69'), ser('orders', '#5794f2'), ser('trades', '#fade2a')], { span, thresholds: [{ v: 500, color: '#73bf69', label: 'target 500' }] });
  drawLines($('#cLat'), [ser('p50', '#73bf69'), ser('p95', '#fade2a'), ser('p99', '#f2495c')], { span, thresholds: [{ v: 100, color: '#f2495c', label: 'SLO 100 ms' }] });
  drawLines($('#cErr'), [ser('errors', '#f2495c'), ser('rejects', '#ff9830'), ser('waf', '#b877d9')], { span });
  drawLines($('#cGd'), [ser('guardianLag', '#b877d9'), ser('outbox', '#5794f2')], { span, thresholds: [{ v: 3000, color: '#f2495c', label: 'fail-closed 3 s' }] });
  drawLines($('#cHot'), [ser(0, '#ff9830', (x) => x.hotPct.BTC), ser(0, '#8ab8ff', (x) => x.hotPct.ETH), ser(0, '#73bf69', (x) => x.hotPct.USDC)], { span, min: 0, max: 100, thresholds: [{ v: 100, color: '#f2495c', label: 'cap' }] });
  drawLines($('#cPods'), [ser(0, '#5794f2', (x) => x.podsReady.A), ser(0, '#73bf69', (x) => x.podsReady.B)], { span, min: 0, max: 16 });
  drawLines($('#cCpu'), [ser(0, '#5794f2', (x) => x.cpu.A), ser(0, '#73bf69', (x) => x.cpu.B)], { span, min: 0, max: 100, thresholds: [{ v: 70, color: '#ff9830', label: 'scale-out 70%' }] });
  $('#cLat-r').textContent = `p99 ${fmt(last.p99, 1)} ms`; $('#cThr-r').textContent = `${last.rps} req/s`;
  setHTML($('#alerts-b'), computeAlerts().sort((a, b) => b.firing - a.firing).map((a) => `<div class="alert-row"><span class="st ${a.firing ? 'firing' : 'ok'}">${a.firing ? 'FIRING' : 'OK'}</span><div><b>${a.name}</b><div class="dim">${esc(a.desc)}</div></div></div>`).join(''));
}

/* ------------------------------------------------------------------ status strip */
function renderStrip() {
  const o = O.ops; const l = o.last || {}; const exp = o.wallets.reduce((s, w) => s + w.exposureUsd, 0); const cold = o.wallets.reduce((s, w) => s + w.coldUsd, 0);
  setHTML($('#strip'), [
    ['Throughput', `${l.rps ?? 0} req/s`], ['p99 latency', `<span class="${l.p99 > 100 ? 'down' : 'up'}">${fmt(l.p99, 1)} ms</span>`],
    ['Guardian lag', o.guardian.outage ? '<span class="down">OUTAGE</span>' : `${o.guardian.lagMs} ms`], ['Open cases', o.guardian.openCases],
    ['Ledger recon', o.recon.ok && !o.recon.accounts.length ? '<span class="up">OK</span>' : '<span class="down">MISMATCH</span>'],
    ['Hot exposure', `${usdK(exp)} <span class="muted" style="font-size:11px">of ${usdK(exp + cold)}</span>`],
    ['Trades total', fmt(o.totals.trades, 0)], ['Scenario', o.attack.active ? `<span style="color:var(--purple)">${esc(o.attack.active.name)}</span>` : '<span class="muted">idle</span>'],
  ].map(([l2, v]) => `<div><div class="l">${l2}</div><div class="v">${v}</div></div>`).join(''));
  const g = o.guardian; const p = $('#guardPill'); const crit = o.cases.some((c) => c.status === 'OPEN' && c.severity === 'critical');
  p.className = 'pill ' + (g.outage || crit ? 'bad' : g.openCases ? 'warn' : '');
  p.lastElementChild.textContent = g.outage ? 'AI Sentinel · OUTAGE' : `AI Sentinel · ${g.openCases ? g.openCases + ' open' : 'watching'}`;
}

/* ------------------------------------------------------------------ attack lab */
function renderScenarios() {
  const o = O.ops; const busy = !!o.attack.active;
  setHTML($('#scnList'), o.attacks.map((a) => `<div class="scn"><div class="nm"><span>${esc(a.name)}</span><button class="btn sm ${busy ? '' : 'y'}" data-run="${a.id}" ${busy ? 'disabled' : ''}>${o.attack.active && o.attack.active.id === a.id ? 'Running…' : 'Run'}</button></div>
    <div class="ls">${esc(a.lesson)}</div><div class="chips"><span class="chip">${esc(a.cat)}</span>${a.defenses.map((d) => `<span class="chip g">${esc(d)}</span>`).join('')}</div></div>`).join(''));
}
function evHTML(e) { return `<div class="ev ${e.actor}"><span class="ts">${tstr(e.ts)}</span><span class="ac">${e.actor === 'guardian' ? 'AI Sentinel' : e.actor}</span><span>${esc(e.text)}</span></div>`; }
function renderTimeline(title, events, outcome) {
  $('#tlHead').textContent = title; O.timeline = events.slice();
  $('#timeline').innerHTML = events.length ? events.map(evHTML).join('') : '<div class="empty">Run a scenario to watch the attacker, guardrails, WAF, AI Sentinel and the policy service interact.</div>';
  $('#tlOutcome').innerHTML = outcome ? `<div class="outcome"><b>Outcome.</b> ${esc(outcome)}</div>` : '';
}
function renderCases() {
  const o = O.ops; const g = o.guardian;
  setHTML($('#sentMeta'), `Events processed <b class="num">${fmt(g.processed, 0)}</b> · duplicate deliveries dropped <b class="num">${g.dupDropped}</b> · lag <b class="num">${g.lagMs} ms</b><br>${g.policyVersion} · ${g.modelVersion} <span class="chip">shadow mode: scores only, never acts</span>`);
  setHTML($('#cases'), o.cases.length ? o.cases.map((c) => `<div class="case ${c.status === 'OPEN' ? '' : 'closed'}"><div class="hd"><span class="sev ${c.severity}">${c.severity}</span><b>${c.id}</b><span class="muted">${tstr(c.ts)}</span><span class="chip ${c.status === 'OPEN' ? 'a' : c.status === 'CONFIRMED' ? 'r' : 'g'}">${c.status}</span></div>
    <div style="font-weight:600;margin-top:4px">${esc(c.title)}</div><div class="sm">${esc(c.summary)}</div>
    <ul>${(c.explanation || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="chips">${c.applied.filter((a) => a.action !== 'ALERT').map((a) => `<span class="chip p">${a.action} → ${esc(a.target)}</span>`).join('')}</div>
    <div class="note" style="margin-top:6px">Shadow-model risk score ${c.shadowScore} <div class="score"><div style="width:${c.shadowScore * 100}%"></div></div></div>
    ${c.status === 'OPEN' ? `<div style="display:flex;gap:6px;margin-top:8px"><button class="btn sm r" data-case="${c.id}" data-d="confirm">Confirm malicious</button><button class="btn sm" data-case="${c.id}" data-d="dismiss">Dismiss · lift restrictions</button></div>` : ''}</div>`).join('') : '<div class="empty">No cases yet</div>');
  setHTML($('#wdTable'), o.withdrawals.length ? `<table class="t"><tr><th>Time</th><th>Account</th><th>Asset</th><th class="n">Amount</th><th>Destination</th><th>Status</th><th class="n">Risk</th><th>Signals</th><th>Trail</th></tr>${o.withdrawals.map((w) => `<tr><td class="muted">${tstr(w.ts)}</td><td>${w.acct}</td><td>${w.asset}</td><td class="n">${fmtQ(w.amount)}</td><td class="dim">${esc(w.address)}</td><td><span class="chip ${w.status === 'CONFIRMED' || w.status === 'BROADCAST' ? 'g' : w.status === 'CANCELED' ? 'r' : 'a'}">${w.status}</span></td><td class="n">${w.risk ? w.risk.score : '–'}</td><td>${w.risk ? ['newDevice', 'newIp', 'destNew', 'coordinated', 'injection', 'ledgerMismatch'].filter((k) => w.risk[k]).map((k) => `<span class="chip a">${k}</span>`).join(' ') : ''}</td><td class="muted" style="font-size:11.5px">${w.reasons.map(esc).join(' → ')}</td></tr>`).join('')}</table>` : '<div class="empty">No withdrawals yet</div>');
}

/* ------------------------------------------------------------------ wallets */
function renderWallets() {
  const o = O.ops;
  setHTML($('#wcards'), o.wallets.map((w) => {
    const sc = (v) => Math.min(100, (v / w.cap) * 100);
    return `<div class="card"><h3>${w.asset} <span class="muted" style="font-weight:400">on ${esc(w.network)}</span><span style="margin-left:auto" class="chip ${w.paused ? 'r' : 'g'}">${w.paused ? 'PAUSED' : 'ACTIVE'}</span></h3><div class="body">
      ${w.paused ? `<div class="warnbox">Paused by ${esc(w.pauseReason)}. Withdrawals stop until reconciliation passes and a human resumes it. <button class="btn sm" data-resume="${w.asset}" style="margin-top:6px">Resume (custody)</button></div>` : ''}
      <div class="wbar"><div class="hot" style="width:${sc(w.hot)}%"></div><div class="pend" style="left:${sc(w.hot)}%;width:${sc(w.pending)}%"></div><div class="tgt" style="left:${sc(w.target)}%"></div></div>
      <div class="kv"><span>Hot balance</span><span>${fmtQ(w.hot)} ${w.asset}</span><span>Pending top-up</span><span>${fmtQ(w.pending)}</span>
      <span>Forecast (1h) + fees + 25% buffer</span><span>${fmtQ(w.forecast)} + ${fmtQ(w.fees)} + ${fmtQ(w.forecast * w.buffer)}</span>
      <span>Target (min ${fmtQ(w.min)}, cap ${fmtQ(w.cap)})</span><span style="color:var(--green)">${fmtQ(w.target)}</span>
      <span>Suggested top-up</span><span style="color:var(--yellow)">${fmtQ(w.topUp)}</span><span>Per-tx cap</span><span>${fmtQ(w.perTxCap)}</span>
      <span>Exposure if compromised</span><span class="down">${usdK(w.exposureUsd)}</span><span>Cold custody (unreachable)</span><span>${fmtQ(w.cold)} · ${usdK(w.coldUsd)}</span>
      <span>Chain vs internal record</span><span class="${w.chainOk ? 'up' : 'down'}">${w.chainOk ? 'reconciled' : 'MISMATCH'}</span>${w.gasAsset ? `<span>Gas paid in</span><span>${w.gasAsset}</span>` : ''}</div>
    </div></div>`;
  }).join(''));
  setHTML($('#approvals'), o.approvals.length ? `<table class="t"><tr><th>Time</th><th>Type</th><th>Asset</th><th class="n">Amount</th><th>From → To</th><th>Reason</th><th>Approvals</th><th>Status</th><th>Approve as</th></tr>${o.approvals.map((a) => `<tr><td class="muted">${tstr(a.ts)}</td><td><b>${a.type}</b></td><td>${a.asset}</td><td class="n">${fmtQ(a.amount)}</td><td class="dim">${esc(a.from)} → ${esc(a.to)}</td><td class="muted">${esc(a.reason)}</td><td>${a.approvals.map((x) => `<span class="chip g">${x.role}</span>`).join(' ')} <span class="dim">${a.approvals.length}/${a.required}</span></td><td><span class="chip ${a.status === 'COMPLETED' ? 'g' : a.status === 'REJECTED' ? 'r' : 'b'}">${a.status}</span>${a.note ? `<div class="dim" style="font-size:11px">${esc(a.note)}</div>` : ''}</td><td>${a.status === 'PENDING' ? ['ops', 'custody', 'risk'].map((r) => `<button class="btn sm" data-ap="${a.id}" data-role="${r}" ${a.approvals.some((x) => x.role === r) ? 'disabled' : ''}>${r}</button>`).join(' ') : ''}</td></tr>`).join('')}</table>` : '<div class="empty">No proposals yet. The policy proposes a top-up when hot + pending falls below 90% of target.</div>');
}
function calc() {
  const v = (id) => +$(id).value || 0; const target = Math.min(v('#cCap'), v('#cFc') + v('#cFee') + v('#cBuf'));
  $('#cTarget').textContent = fmt(target, 4); $('#cTop').textContent = fmt(Math.max(0, target - v('#cHot') - v('#cPend')), 4);
}

/* ------------------------------------------------------------------ chaos */
function renderChaos() {
  const o = O.ops; const I = o.infra;
  if (document.activeElement !== $('#rps')) { $('#rps').value = o.load.rps; } $('#rpsV').textContent = o.load.rps + ' rps';
  setHTML($('#leases'), `<table class="t"><tr><th>Market</th><th>Active owner</th><th>Fencing token</th><th>Standby</th><th>Queued</th></tr>${I.matching.map((m) => `<tr><td><b>${m.market}</b></td><td>${m.owner.pod} <span class="chip">AZ-${m.owner.az}</span>${m.failover ? ' <span class="chip a">failing over</span>' : ''}</td><td class="n">${m.owner.token}</td><td class="muted">${m.standby.pod}</td><td class="n">${m.queued}</td></tr>`).join('')}</table><p class="note">A stale owner writing with an old token is rejected, so an AZ failure can't produce duplicate trades.</p>`);
  setHTML($('#datatier'), `<div class="kv"><span>Aurora PostgreSQL</span><span>${I.aurora.cls}</span><span>Writer</span><span>AZ-${I.aurora.writer}</span><span>Reader</span><span>${I.aurora.reader.length > 1 ? I.aurora.reader : 'AZ-' + I.aurora.reader}</span><span>State</span><span class="${I.aurora.state === 'available' ? 'up' : 'down'}">${I.aurora.state}</span>
    <span>ElastiCache</span><span>${I.cache.cls}</span><span>Primary / replica</span><span>AZ-${I.cache.primary} / ${I.cache.replica.length > 1 ? I.cache.replica : 'AZ-' + I.cache.replica}</span>
    <span>Last AZ recovery</span><span>${I.lastRecovery ? (I.lastRecovery.rtoMs / 1000).toFixed(1) + ' s (AZ-' + I.lastRecovery.az + ')' : '–'}</span></div>`);
  setHTML($('#azs'), ['A', 'B'].map((z) => `<div class="az ${I.azs[z].up ? '' : 'down'}"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><b>${I.azs[z].name}</b><span class="chip ${I.azs[z].up ? 'g' : 'r'}">${I.azs[z].up ? 'UP' : 'DOWN'}</span>
    <span style="margin-left:auto"></span>${I.azs[z].up ? `<button class="btn sm r" data-azfail="${z}">☠ Fail AZ</button>` : `<button class="btn sm g" data-azrestore="${z}">Restore AZ</button>`}</div>
    <div class="note">Nodes: ${I.nodes.filter((n) => n.az === z).map((n) => `<span class="chip ${n.status === 'Ready' ? 'g' : 'r'}">${n.name} · ${n.type}</span>`).join(' ')}</div>
    <div style="margin-top:8px">${I.pods.filter((p) => p.az === z || (p.home === z && p.status === 'Terminated')).map((p) => `<span class="pod ${p.status}" title="${p.status}">${p.name}${p.replacement ? ' ↻' : ''}</span>`).join('')}</div></div>`).join(''));
  const dr = I.dr;
  setHTML($('#dr'), (dr.steps.length ? dr.steps.map((s) => `<div class="drstep"><span class="i">${s.status === 'done' ? '✅' : '⏳'}</span><div><b>${esc(s.title)}</b><div class="muted">${esc(s.detail)}</div></div></div>`).join('') : '<p class="note">Simulates losing ap-southeast-1: fence the old primary, rebuild with CloudFormation in ap-northeast-1, restore the latest cross-Region Aurora snapshot, Argo CD sync, reconcile, then human approval before trading resumes.</p>')
    + (dr.result ? `<div class="okbox" style="margin-top:8px">Simulated RTO ${(dr.result.rtoMs / 1000).toFixed(1)} s · RPO ${dr.result.rpoS} s. ${esc(dr.result.note)}</div>` : ''));
  $('#drBtn').disabled = dr.running;
  setHTML($('#infraLog'), I.events.map((e) => `<div class="${e.sev}">${tstr(e.ts)} ${esc(e.text)}</div>`).join('') || '<div class="dim">No infrastructure events yet.</div>');
}

/* ------------------------------------------------------------------ audit */
function renderAudit() {
  const q = $('#auditQ').value.toLowerCase(); const rows = O.ops.audit.filter((a) => !q || JSON.stringify(a).toLowerCase().includes(q));
  setHTML($('#auditTbl'), `<table class="t"><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Decision</th><th>Policy</th><th>Case</th><th>Correlation</th><th>Reason</th></tr>${rows.map((a) => `<tr><td class="muted">${tstr(a.ts)}</td><td>${esc(a.actor)}</td><td><b>${esc(a.action)}</b></td><td class="dim">${esc(a.target)}</td><td><span class="chip ${a.decision === 'DENIED' ? 'r' : a.decision === 'APPLIED' || a.decision === 'APPROVED' ? 'g' : 'b'}">${a.decision}</span></td><td class="dim">${a.policyVersion}</td><td>${a.caseId || ''}</td><td class="dim">${a.corr}</td><td class="muted" style="max-width:420px">${esc(a.reason)}</td></tr>`).join('')}</table>`);
}

/* ------------------------------------------------------------------ wiring */
function renderTab() {
  if (!O.ops) return; renderStrip();
  if (O.tab === 'arch') paintArch();
  if (O.tab === 'grafana') renderGrafana();
  if (O.tab === 'attack') { renderScenarios(); renderCases(); }
  if (O.tab === 'wallets') renderWallets();
  if (O.tab === 'chaos') renderChaos();
  if (O.tab === 'audit') renderAudit();
}
function setTab(t) {
  O.tab = t; $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.p === t));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'p-' + t)); history.replaceState(null, '', '#' + t); renderTab();
}
$('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) setTab(b.dataset.p); };
document.body.addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return; let r;
  if (t.dataset.run) { r = await api('POST', `/api/attacks/${t.dataset.run}/run`); if (!r.ok) toast(esc(r.message || r.reason), 'bad'); }
  if (t.dataset.case) { r = await api('POST', `/api/cases/${t.dataset.case}/resolve`, { decision: t.dataset.d }); toast(r.ok ? `${t.dataset.case} ${t.dataset.d === 'confirm' ? 'confirmed: held funds returned to account balances, restrictions kept' : 'dismissed: restrictions lifted, withdrawals re-screened'}` : esc(r.message || r.reason), r.ok ? 'good' : 'bad', 6000); }
  if (t.dataset.ap) { r = await api('POST', `/api/approvals/${t.dataset.ap}/approve`, { role: t.dataset.role }); toast(r.ok ? `Approved as ${t.dataset.role} (${r.approval.approvals.length}/${r.approval.required})` : esc(r.message || r.reason), r.ok ? 'good' : 'bad'); }
  if (t.dataset.resume) { r = await api('POST', `/api/wallets/${t.dataset.resume}/resume`); toast(r.ok ? `${t.dataset.resume} compartment resumed` : esc(r.message || r.reason), r.ok ? 'good' : 'bad'); }
  if (t.dataset.azfail) { r = await api('POST', '/api/chaos/az-fail', { az: t.dataset.azfail }); if (!r.ok) toast(esc(r.message), 'bad'); }
  if (t.dataset.azrestore) { r = await api('POST', '/api/chaos/az-restore', { az: t.dataset.azrestore }); if (!r.ok) toast(esc(r.message), 'bad'); }
  if (t.dataset.rps) { await api('POST', '/api/load', { rps: +t.dataset.rps }); }
  if (r || t.dataset.rps) refreshOps();
});
$('#rps').onchange = () => api('POST', '/api/load', { rps: +$('#rps').value });
$('#rps').oninput = () => { $('#rpsV').textContent = $('#rps').value + ' rps'; };
$('#drBtn').onclick = async () => { const r = await api('POST', '/api/chaos/dr-drill'); if (!r.ok) toast(esc(r.message), 'bad'); };
$('#resetBtn').onclick = async () => { if (confirm('Reset the whole simulation (balances, cases, wallets, metrics)?')) await api('POST', '/api/reset'); };
$('#auditQ').oninput = renderAudit;
$$('.calc input').forEach((i) => { i.oninput = calc; });
window.addEventListener('resize', () => { if (O.tab === 'grafana') renderGrafana(); });
async function refreshOps() { const o = await api('GET', '/api/ops'); if (o.wallets) { O.ops = o; renderTab(); } }

async function load() {
  const s = await api('GET', '/api/state');
  O.ops = s.ops; O.series = s.series || []; demo.set(s.ops.demo.running);
  const a = s.ops.attack;
  if (a.active) renderTimeline('Live timeline · ' + a.active.name, a.active.timeline);
  else if (a.last) renderTimeline('Last run · ' + a.last.name, a.last.timeline, a.last.outcome);
  else renderTimeline('Live timeline', []);
  renderTab();
}
buildArch(); buildGrafana(); calc();
connectStream({
  metrics(m) { O.series.push(m); if (O.series.length > 300) O.series.shift(); if (O.tab === 'grafana' && O.ops) renderGrafana(); },
  ops(o) { O.ops = o; renderTab(); },
  attackStart(a) { renderTimeline('Live timeline · ' + a.name, []); if (O.tab !== 'attack' && O.tab !== 'arch') toast(`Scenario started: <b>${esc(a.name)}</b> <a href="#attack" onclick="setTab('attack')">watch →</a>`, 'warn'); },
  attack(e) { const tl = $('#timeline'); if (!O.timeline.length) tl.innerHTML = ''; O.timeline.push(e); tl.insertAdjacentHTML('beforeend', evHTML(e)); tl.scrollTop = tl.scrollHeight; },
  attackEnd(a) { $('#tlOutcome').innerHTML = `<div class="outcome"><b>Outcome.</b> ${esc(a.outcome)}</div>`; },
  alert(a) { toast(`<b>AI Sentinel · ${esc(a.severity.toUpperCase())}</b> ${esc(a.title)}`, 'ai', 6000); },
  narration(n) { showNarration(n, 'ops'); if (n.page === 'ops' && n.step >= 6 && n.step <= 7 && O.tab !== 'attack') setTab('attack'); if (n.step === 8 && O.tab !== 'grafana') setTab('grafana'); },
  demoEnd() { demo.set(false); },
  reset() { O.series = []; load(); },
});
const initial = location.hash.slice(1); if (['arch', 'grafana', 'attack', 'wallets', 'chaos', 'audit'].includes(initial)) setTab(initial);
load();
