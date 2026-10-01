#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v node >/dev/null; then
  echo 'Node.js is missing. Install Node.js 24 or newer.' >&2
  exit 1
fi
if [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 24 ]; then
  echo 'Job Applier needs Node.js 24 or newer.' >&2
  exit 1
fi
if [ ! -f node_modules/playwright/package.json ]; then
  echo 'Run ./setup.sh first to install the app and browser.' >&2
  exit 1
fi
exec node src/server.mjs
