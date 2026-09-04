#!/bin/bash
# Launches a test browser with the extension loaded, ready to walk through.
#
# WHY Chrome for Testing and not regular Google Chrome: branded Chrome removed
# support for --load-extension (Chrome 137+), so the extension silently never
# loads there. Chrome for Testing (bundled with Playwright) keeps the flag.
# --use-mock-keychain avoids the macOS keychain password prompt.
#
# The profile persists, so a Google sign-in survives between runs — it is the
# same profile the automated Docs suite uses.
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
  pnpm build
fi

# Chrome persists the extension's MV3 service worker inside the profile, so a
# rebuilt background.js does NOT take effect: the content script is the new
# build and the worker is last week's, and the two disagree in ways that look
# exactly like a product bug. That has cost this project a whole session once
# and four probe runs another time. Cookies live elsewhere, so the Google
# sign-in survives this.
rm -rf "$PROFILE/Default/Service Worker"

# A plain page to try the transport controls on before touching a real
# document. Static, so no backend is needed for it.
PORT=8788
if ! curl -s -o /dev/null "http://127.0.0.1:$PORT/harness.html"; then
  (cd test-pages && nohup python3 -m http.server "$PORT" --bind 127.0.0.1 > /dev/null 2>&1 &)
  sleep 1
fi

nohup "$BIN" \
  --user-data-dir="$PROFILE" \
  --load-extension="$EXT" \
  --use-mock-keychain \
  --password-store=basic \
  --no-first-run \
  --no-default-browser-check \
  --window-size=1512,982 \
  --new-window \
  "http://127.0.0.1:$PORT/harness.html" \
  "https://docs.google.com/document/u/0/create" > /dev/null 2>&1 &

cat <<'MSG'

Test browser launched, extension loaded, service-worker cache cleared.

  Tab 1  a plain test page (textarea, a React-style trap field, a rich editor)
  Tab 2  a new Google Doc — sign in to Google here if it asks

Sign in to the assistant with:  tester@example.com / awa-test-2026
Open the panel with the round button on the right edge, or Alt+Shift+A.

To stop the little page server afterwards:  pkill -f "http.server 8788"
MSG
