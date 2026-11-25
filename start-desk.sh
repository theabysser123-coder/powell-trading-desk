#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export POWELL_BACKTEST_DIR="/home/nebula/.gemini/antigravity/scratch/powell-backtest"
export OMB_PORT="${OMB_PORT:-8799}"
export OMB_STATIC_DIR="$(pwd)/dist"
echo "Starting Powell v7 AI Trading Desk on http://127.0.0.1:${OMB_PORT} (UI: ${OMB_STATIC_DIR}) ..."
exec node --experimental-strip-types server/index.ts
