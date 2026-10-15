#!/usr/bin/env bash
# End-to-end smoke test of herdr-mcp's read-only tools against your real herdr.
# Requires herdr on PATH with a running server, and `npm install` in this repo.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[ -f build/index.js ] || npm run build
exec node scripts/smoke.mjs "$@"
