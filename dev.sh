#!/usr/bin/env bash
# Launch the Ghost Grid backend and frontend together.
#
#   ./dev.sh          # both services
#   ./dev.sh backend  # backend only
#   ./dev.sh frontend # frontend only
#
# Backend : http://127.0.0.1:3001   (Fastify API)
# Frontend: http://localhost:5173   (Vite, proxies /gg -> backend)
# Ctrl+C stops every service this script started.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT/ghostgrid-backend"
FRONTEND_DIR="$ROOT/ghostgrid-frontend/frontend"

BACKEND_URL="http://127.0.0.1:3001"
FRONTEND_URL="http://localhost:5173"
FRONTEND_PORT=5173

pids=()
cleanup() {
  echo
  echo "Stopping services..."
  for pid in "${pids[@]:-}"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

is_up() { curl -fsS -m 2 -o /dev/null "$1" 2>/dev/null; }

start_backend() {
  if is_up "$BACKEND_URL/health"; then
    echo "Backend already running at $BACKEND_URL (skipping)."
    return
  fi
  echo "Starting backend -> $BACKEND_URL"
  ( cd "$BACKEND_DIR" && npm run start ) &
  pids+=("$!")
}

start_frontend() {
  if is_up "$FRONTEND_URL"; then
    echo "Frontend already running at $FRONTEND_URL (skipping)."
    return
  fi
  echo "Starting frontend -> $FRONTEND_URL"
  ( cd "$FRONTEND_DIR" && npm run dev -- --port "$FRONTEND_PORT" --strictPort ) &
  pids+=("$!")
}

target="${1:-all}"
case "$target" in
  backend)  start_backend ;;
  frontend) start_frontend ;;
  all)      start_backend; start_frontend ;;
  *) echo "Usage: $0 [backend|frontend|all]" >&2; exit 2 ;;
esac

if [[ ${#pids[@]} -eq 0 ]]; then
  echo "Nothing to start; both services are already up."
  trap - INT TERM EXIT
  exit 0
fi

echo
echo "Ghost Grid is starting. Frontend: $FRONTEND_URL"
echo "Press Ctrl+C to stop."
wait
