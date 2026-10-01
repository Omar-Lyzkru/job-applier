#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
umask 077
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo 'Install Node.js 24 or newer, then run ./setup.sh again.' >&2
  exit 1
fi
if [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 24 ]; then
  echo 'Job Applier needs Node.js 24 or newer.' >&2
  exit 1
fi
mkdir -p data
npm ci --no-audit --no-fund --cache ./data/npm-cache
npm run browser:install
echo 'Setup complete. Run ./start.sh, then open http://127.0.0.1:3210.'
