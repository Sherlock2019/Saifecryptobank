#!/usr/bin/env bash
# SAIFE Trade POC launcher — local machine or AWS EC2 (Amazon Linux 2023 / Ubuntu).
#
#   ./start.sh               start in the background, wait until healthy, print URLs
#   ./start.sh --install     also install Node.js 20 if missing (EC2 first run; needs sudo)
#   ./start.sh --public      listen on all interfaces (EC2). Restrict the Security Group to your IP!
#   ./start.sh --tls         serve HTTPS with a self-signed certificate (generated in .run/tls)
#   ./start.sh --fg          run in the foreground (Ctrl+C to stop)
#   ./start.sh --stop | --status | --logs
#   PORT=3511 ./start.sh     use another port (default 3510)
#
# Simulation only: mock data, no real funds or keys. The mobile app (/mobile) has MFA login;
# the trading UI and ops console have no authentication.
set -euo pipefail
cd "$(dirname "$0")"

INSTALL=0; PUBLIC=0; FG=0; TLS=0; ACTION=up
for a in "$@"; do
  case "$a" in
    --install) INSTALL=1 ;;
    --public) PUBLIC=1 ;;
    --tls) TLS=1 ;;
    --fg) FG=1 ;;
    --stop) ACTION=stop ;;
    --status) ACTION=status ;;
    --logs) ACTION=logs ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a" >&2; exit 2 ;;
  esac
done

PORT="${PORT:-3510}"
RUN_DIR="$PWD/.run"; PID_FILE="$RUN_DIR/server.pid"; LOG_FILE="$RUN_DIR/server.log"
mkdir -p "$RUN_DIR"
log() { printf '\033[1;33m[saife]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[saife]\033[0m %s\n' "$*" >&2; exit 1; }
running_pid() { [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null && cat "$PID_FILE"; }
port_busy() {
  if command -v ss >/dev/null 2>&1; then ss -ltn 2>/dev/null | grep -q ":${PORT} "
  else (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; fi
}

# --- actions that don't need Node -------------------------------------------------------
case "$ACTION" in
  stop)
    if pid=$(running_pid); then kill "$pid"; rm -f "$PID_FILE"; log "Stopped (pid $pid)."; else log "Not running."; fi
    exit 0 ;;
  status)
    if pid=$(running_pid); then log "Running (pid $pid) on port $PORT"; curl -sk -m 2 "https://127.0.0.1:${PORT}/healthz" 2>/dev/null || curl -s -m 2 "http://127.0.0.1:${PORT}/healthz"; echo; else log "Not running."; fi
    exit 0 ;;
  logs) touch "$LOG_FILE"; exec tail -n 100 -f "$LOG_FILE" ;;
esac

# --- EC2 detection (IMDSv2) -------------------------------------------------------------
EC2=0; PUBLIC_HOST=""
if TOKEN=$(curl -s -m 1 -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null) && [ -n "$TOKEN" ]; then
  EC2=1
  PUBLIC_HOST=$(curl -s -m 2 -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4 || true)
fi

# --- Node.js ----------------------------------------------------------------------------
node_ok() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; }
install_node() {
  log "Installing Node.js 20…"
  . /etc/os-release
  if [[ "${ID:-}" == "amzn" ]]; then
    sudo dnf install -y nodejs20 git || sudo dnf install -y nodejs git
    command -v node >/dev/null 2>&1 || { [ -x /usr/bin/node-20 ] && sudo ln -sf /usr/bin/node-20 /usr/local/bin/node; }
  elif [[ "${ID:-}" == "ubuntu" || "${ID:-}" == "debian" ]]; then
    sudo apt-get update -y && sudo apt-get install -y ca-certificates curl git
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    die "Unsupported OS (${ID:-unknown}). Install Node.js 18+ manually."
  fi
}
if ! node_ok; then
  [ "$INSTALL" = 1 ] || die "Node.js 18+ is required. Re-run with --install (EC2) or install Node from nodejs.org."
  install_node
  node_ok || die "Node.js installation failed."
fi

# --- start ------------------------------------------------------------------------------
if pid=$(running_pid); then die "Already running (pid $pid). Use ./start.sh --stop first."; fi
port_busy && die "Port ${PORT} is already in use. Stop that process or run: PORT=3511 ./start.sh"
HOST=127.0.0.1; [ "$PUBLIC" = 1 ] && HOST=0.0.0.0
SSH_USER=ec2-user; [ -f /etc/os-release ] && grep -q '^ID=ubuntu' /etc/os-release && SSH_USER=ubuntu
if [ "$EC2" = 1 ] && [ "$PUBLIC" = 0 ]; then
  log "EC2 detected but binding to 127.0.0.1. Use --public (add --tls for HTTPS) to reach it from your browser, or an SSH tunnel:"
  log "  ssh -L ${PORT}:127.0.0.1:${PORT} ${SSH_USER}@${PUBLIC_HOST:-<ec2-ip>}"
fi

# --- TLS (self-signed; the browser will warn once) -------------------------------------
SCHEME=http; TLS_ENV=()
if [ "$TLS" = 1 ]; then
  command -v openssl >/dev/null 2>&1 || die "--tls needs openssl (sudo apt-get install -y openssl / sudo dnf install -y openssl)."
  TLS_DIR="$RUN_DIR/tls"; mkdir -p "$TLS_DIR"; chmod 700 "$TLS_DIR"
  SAN="IP:127.0.0.1,DNS:localhost"; [ -n "$PUBLIC_HOST" ] && SAN="IP:${PUBLIC_HOST},${SAN}"
  if [ ! -f "$TLS_DIR/cert.pem" ] || [ "$(cat "$TLS_DIR/san" 2>/dev/null)" != "$SAN" ]; then
    log "Generating a self-signed certificate for ${SAN}…"
    openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 30 -subj "/CN=saife-poc" \
      -addext "subjectAltName=${SAN}" -keyout "$TLS_DIR/key.pem" -out "$TLS_DIR/cert.pem" >/dev/null 2>&1 \
      || die "Certificate generation failed (needs OpenSSL 1.1.1+)."
    chmod 600 "$TLS_DIR/key.pem"; echo "$SAN" >"$TLS_DIR/san"
  fi
  SCHEME=https; TLS_ENV=(TLS_CERT="$TLS_DIR/cert.pem" TLS_KEY="$TLS_DIR/key.pem")
fi
health() { curl -sk -m 1 "${SCHEME}://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; }

if [ "$FG" = 1 ]; then
  log "Starting in foreground on ${SCHEME}://${HOST}:${PORT} (Ctrl+C to stop)"
  exec env PORT="$PORT" HOST="$HOST" "${TLS_ENV[@]}" node server.js
fi

log "Starting in background (log: $LOG_FILE)…"
nohup env PORT="$PORT" HOST="$HOST" "${TLS_ENV[@]}" node server.js >"$LOG_FILE" 2>&1 </dev/null &
echo $! >"$PID_FILE"
for _ in $(seq 1 30); do
  if health; then break; fi
  kill -0 "$(cat "$PID_FILE")" 2>/dev/null || { cat "$LOG_FILE"; die "Server exited during startup."; }
  sleep 0.5
done
health || die "Server did not become healthy; see $LOG_FILE"

BASE="${SCHEME}://127.0.0.1:${PORT}"
[ "$PUBLIC" = 1 ] && [ -n "$PUBLIC_HOST" ] && BASE="${SCHEME}://${PUBLIC_HOST}:${PORT}"
log "Healthy (pid $(cat "$PID_FILE"))."
log "  Mobile app   : ${BASE}/mobile   (open on your phone; demo login: demo / SaifeDemo!2026 unless MOBILE_DEMO_PASSWORD is set)"
log "  Trading UI   : ${BASE}/"
log "  Ops Console  : ${BASE}/ops.html"
log "  Metrics      : ${BASE}/metrics"
if [ "$PUBLIC" = 1 ]; then
  log "Public mode: in the EC2 Security Group, allow inbound TCP ${PORT} from YOUR IP only (trading UI and ops console have no login)."
  [ "$TLS" = 1 ] || log "Traffic is unencrypted. Add --tls for HTTPS (self-signed: accept the browser warning once)."
  [ "$TLS" = 1 ] && log "Self-signed certificate: the browser warns once; choose Advanced → Proceed."
fi
log "Stop with ./start.sh --stop · logs with ./start.sh --logs"
