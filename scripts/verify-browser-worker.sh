#!/usr/bin/env bash
# Verify the deployed browser worker: first directly, then through the deployed
# browser-gateway edge function as a real signed-in user.
#
# Usage:
#   BROWSER_WORKER_URL=https://xxx.hf.space bash scripts/verify-browser-worker.sh
#
# Reads BROWSER_WORKER_TOKEN (falls back to $Worker) and the project's publishable
# key from .env. Prints status codes and provider messages only.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="https://famrqmqlqjzkroixnuld.supabase.co"
URL="${BROWSER_WORKER_URL:-}"
TOKEN="${BROWSER_WORKER_TOKEN:-${Worker:-}}"

if [[ -z "$URL" ]]; then echo "BROWSER_WORKER_URL is not set." >&2; exit 1; fi
URL="${URL%/}"
if [[ "$URL" != https://* ]]; then echo "BROWSER_WORKER_URL must start with https://" >&2; exit 1; fi
if [[ ${#TOKEN} -lt 16 ]]; then echo "BROWSER_WORKER_TOKEN is missing." >&2; exit 1; fi

echo "1) worker /healthz"
curl -sS --max-time 90 -o /tmp/bw-health.json -w '   http=%{http_code}\n' \
  -H "Authorization: Bearer ${TOKEN}" "${URL}/healthz" || true
head -c 300 /tmp/bw-health.json 2>/dev/null; echo

echo "2) worker session on example.com (direct)"
curl -sS --max-time 120 -o /tmp/bw-session.json -w '   http=%{http_code}\n' \
  -X POST "${URL}/sessions" -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' -d '{"url":"https://example.com"}' || true
jq -r '{sessionId:(.sessionId//"none"), url:(.url//""), shotBytes:((.screenshot//"")|length), error:(.error//empty)}' /tmp/bw-session.json 2>/dev/null || head -c 300 /tmp/bw-session.json

echo "3) worker rejects a wrong token (must be 401)"
curl -sS --max-time 30 -o /dev/null -w '   http=%{http_code}\n' \
  -H "Authorization: Bearer not-the-real-token" "${URL}/healthz" || true

echo "4) browser-gateway through Supabase (signed in as the probe user)"
KEY=$(grep '^VITE_SUPABASE_ANON_KEY=' "$ROOT/.env" | cut -d= -f2)
EMAIL=$(cat /tmp/probe_email 2>/dev/null || true)
PW=$(cat /tmp/probe_pw 2>/dev/null || true)
if [[ -n "$EMAIL" && -n "$PW" ]]; then
  TOK=$(curl -sS -X POST "$BASE/auth/v1/token?grant_type=password" \
    -H "apikey: $KEY" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | jq -r '.access_token // empty')
  if [[ -n "$TOK" ]]; then
    for body in '{"action":"session"}' '{"action":"create","startUrl":"https://example.com"}'; do
      echo "   gateway $body"
      curl -sS --max-time 120 -o /tmp/bw-gw.json -w '   http=%{http_code}\n' \
        -X POST "$BASE/functions/v1/browser-gateway" -H "apikey: $KEY" \
        -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d "$body" || true
      head -c 400 /tmp/bw-gw.json; echo
    done
  else
    echo "   could not sign in as the probe user (it may have been deleted)"
  fi
else
  echo "   no probe credentials on disk — skipping the gateway hop"
fi
