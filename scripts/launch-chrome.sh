#!/bin/bash
# Launches a test browser with the extension loaded.
#
# WHY Chrome for Testing and not regular Google Chrome: branded Chrome removed
# support for --load-extension (Chrome 137+), so the extension silently never
# loads there. Chrome for Testing (bundled with Playwright) keeps the flag.
# --use-mock-keychain avoids the macOS keychain password prompt.
set -e
cd "$(dirname "$0")/.."
EXT="$PWD/apps/extension/.output/chrome-mv3"
PROFILE="$PWD/.chrome-profile-cft"
BIN=$(ls -d "$HOME/Library/Caches/ms-playwright/chromium-"*/chrome-mac*/"Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" 2>/dev/null | tail -1)

if [ -z "$BIN" ]; then
  echo "Chrome for Testing not found — installing via Playwright…"
  pnpm exec playwright install chromium
  BIN=$(ls -d "$HOME/Library/Caches/ms-playwright/chromium-"*/chrome-mac*/"Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" | tail -1)
fi

if [ ! -d "$EXT" ]; then
  echo "Extension not built yet — building…"
  pnpm --filter extension build
fi

nohup "$BIN" \
  --user-data-dir="$PROFILE" \
  --load-extension="$EXT" \
  --use-mock-keychain \
  --password-store=basic \
  --no-first-run \
  --no-default-browser-check \
  --new-window "http://127.0.0.1:8787/harness" > /dev/null 2>&1 &

echo "Test browser launched with the extension loaded."
echo "Test page: http://127.0.0.1:8787/harness"
