#!/usr/bin/env bash
# SAIFE Trade POC launcher — local machine or AWS EC2 (Amazon Linux 2023 / Ubuntu).
#
#   ./start.sh               start in the background, wait until healthy, print URLs
#   ./start.sh --install     also install Node.js 20 if missing (EC2 first run; needs sudo)
#   ./start.sh --public      listen on all interfaces (EC2). Restrict the Security Group to your IP!
#   ./start.sh --fg          run in the foreground (Ctrl+C to stop)
#   ./start.sh --stop | --status | --logs
#   PORT=3511 ./start.sh     use another port (default 3510)
#
# Simulation only: mock data, no real funds or keys, no authentication on the UI.
set -euo pipefail
cd "$(dirname "$0")"

INSTALL=0; PUBLIC=0; FG=0; ACTION=up
for a in "$@"; do
  case "$a" in
    --install) INSTALL=1 ;;
    --public) PUBLIC=1 ;;
    --fg) FG=1 ;;
    --stop) ACTION=stop ;;
    --status) ACTION=status ;;
    --logs) ACTION=logs ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
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
    if pid=$(running_pid); then log "Running (pid $pid) on port $PORT"; curl -s -m 2 "http://127.0.0.1:${PORT}/healthz" && echo; else log "Not running."; fi
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
if [ "$EC2" = 1 ] && [ "$PUBLIC" = 0 ]; then
  log "EC2 detected but binding to 127.0.0.1. Use --public to reach it from your browser, or an SSH tunnel:"
  log "  ssh -L ${PORT}:127.0.0.1:${PORT} ec2-user@${PUBLIC_HOST:-<ec2-ip>}"
fi

if [ "$FG" = 1 ]; then
  log "Starting in foreground on http://${HOST}:${PORT} (Ctrl+C to stop)"
  exec env PORT="$PORT" HOST="$HOST" node server.js
fi

log "Starting in background (log: $LOG_FILE)…"
nohup env PORT="$PORT" HOST="$HOST" node server.js >"$LOG_FILE" 2>&1 </dev/null &
echo $! >"$PID_FILE"
for _ in $(seq 1 30); do
  if curl -s -m 1 "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then break; fi
  kill -0 "$(cat "$PID_FILE")" 2>/dev/null || { cat "$LOG_FILE"; die "Server exited during startup."; }
  sleep 0.5
done
curl -s -m 1 "http://127.0.0.1:${PORT}/healthz" >/dev/null || die "Server did not become healthy; see $LOG_FILE"

BASE="http://127.0.0.1:${PORT}"
[ "$PUBLIC" = 1 ] && [ -n "$PUBLIC_HOST" ] && BASE="http://${PUBLIC_HOST}:${PORT}"
log "Healthy (pid $(cat "$PID_FILE"))."
log "  Trading UI   : ${BASE}/"
log "  Ops Console  : ${BASE}/ops.html"
log "  Metrics      : ${BASE}/metrics"
if [ "$PUBLIC" = 1 ]; then
  log "Public mode: open TCP ${PORT} in the instance Security Group to YOUR IP only (the UI has no login)."
fi
log "Stop with ./start.sh --stop · logs with ./start.sh --logs"
