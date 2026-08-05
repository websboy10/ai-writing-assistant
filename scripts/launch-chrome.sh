#!/bin/bash
# Launches real Google Chrome with the built extension loaded, using a
# dedicated profile so your main Chrome profile is untouched.
set -e
cd "$(dirname "$0")/.."
EXT="$PWD/apps/extension/.output/chrome-mv3"
PROFILE="$PWD/.chrome-profile"

if [ ! -d "$EXT" ]; then
  echo "Extension not built yet — running build…"
  pnpm --filter extension build
fi

open -na "Google Chrome" --args \
  --user-data-dir="$PROFILE" \
  --load-extension="$EXT" \
  --no-first-run \
  --no-default-browser-check \
  "http://127.0.0.1:8787/harness" 2>/dev/null || \
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$PROFILE" \
  --load-extension="$EXT" \
  --no-first-run \
  --no-default-browser-check \
  "http://127.0.0.1:8787/harness" &

echo "Chrome launched with the extension loaded."
echo "Test page: http://127.0.0.1:8787/harness (needs 'pnpm harness' running)"
