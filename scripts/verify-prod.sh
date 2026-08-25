#!/usr/bin/env bash
# The production proof: the extension exactly as a user would install it,
# talking to the deployed backend, driving a real Google Doc.
#
# Everything else in scripts/ runs against the backend on this Mac. That is the
# right default while fixing things — the server log is right there — but it
# proves nothing about what is deployed. This is the run that does.
#
# Two things it does that are easy to forget by hand, and both have cost a
# whole afternoon before:
#
#   1. Clears the profile's cached service worker. Chrome serves an unpacked
#      extension's background worker out of the profile even when the content
#      script is re-read from disk, so you get today's UI talking to
#      yesterday's backend URL and a green suite that proves nothing.
#      (~/.claude memory: extension-stale-service-worker)
#   2. Builds and runs with the SAME backend URL, so verify-docs' own guard —
#      which fails the run if any API call goes anywhere else — is actually
#      checking what you think it is.
set -euo pipefail

cd "$(dirname "$0")/.."
PROD="${AWA_PROD_URL:-https://ai-skriveassistent-api.vercel.app}"

echo "→ production backend: $PROD"
code=$(curl -s -o /dev/null -w '%{http_code}' "$PROD/api/health")
[ "$code" = "200" ] || { echo "backend unhealthy (HTTP $code)"; exit 1; }
echo "  health: 200"

echo "→ clearing the cached service worker in the test profile"
rm -rf .chrome-profile-cft/Default/"Service Worker"

echo "→ building the extension against production"
VITE_BACKEND_URL="$PROD" pnpm --filter extension build >/dev/null
echo "  built"

echo "→ the paywall and quota cannot be picked open"
AWA_BACKEND="$PROD" node scripts/verify-rls.mjs

echo "→ the panel, end to end"
VITE_BACKEND_URL="$PROD" node scripts/verify-ui.mjs

echo "→ Google Docs, end to end"
VITE_BACKEND_URL="$PROD" node scripts/verify-docs.mjs

echo
echo "production verified against $PROD"
