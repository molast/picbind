#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "PicBind local tasks"
echo "  1) Desktop development"
echo "  2) Desktop production build"
echo "  3) Web development only"
echo "  0) Exit"
printf "Select a task [1]: "
read -r TASK_CHOICE

case "${TASK_CHOICE:-1}" in
  1)
    exec node "$ROOT_DIR/dev-local.mjs" desktop
    ;;
  2)
    exec pnpm --dir "$ROOT_DIR/desktop" run build
    ;;
  3)
    exec node "$ROOT_DIR/dev-local.mjs" web
    ;;
  0)
    exit 0
    ;;
  *)
    echo "Invalid selection: $TASK_CHOICE" >&2
    exit 2
    ;;
esac
