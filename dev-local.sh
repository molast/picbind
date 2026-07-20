#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_PID=""

cleanup() {
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

if [[ ! -f "$ROOT_DIR/cloudflare-worker/.dev.vars" ]]; then
  cp \
    "$ROOT_DIR/cloudflare-worker/.dev.vars.example" \
    "$ROOT_DIR/cloudflare-worker/.dev.vars"
fi

pnpm --dir "$ROOT_DIR/cloudflare-worker" dev &
API_PID=$!

pnpm --dir "$ROOT_DIR/web" dev
