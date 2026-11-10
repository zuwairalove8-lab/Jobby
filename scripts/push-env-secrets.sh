#!/usr/bin/env bash
# Push secrets that already live in this workspace's environment
# (Freebuff → Project settings → Secrets) into Supabase edge-function secrets.
#
# Values are read from the environment and travel only inside the HTTP request
# body: they are never echoed, printed, or written to disk.
#
# Requires SUPABASE_ACCESS_TOKEN — a personal access token with
# "Edge Function Secrets (write)" — also added under Project settings → Secrets.
#
# Usage:
#   bash scripts/push-env-secrets.sh
#   SUPABASE_PROJECT_REF=<ref> bash scripts/push-env-secrets.sh
set -euo pipefail

REF="${SUPABASE_PROJECT_REF:-famrqmqlqjzkroixnuld}"
API="https://api.supabase.com/v1/projects/${REF}/secrets"

for bin in curl jq; do
  command -v "$bin" >/dev/null 2>&1 || { echo "Missing required command: $bin" >&2; exit 1; }
done

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  cat >&2 <<'MSG'
SUPABASE_ACCESS_TOKEN is not set.

Create a token at https://supabase.com/dashboard/account/tokens with
"Edge Function Secrets" read-write, then add it as a Freebuff project secret
named SUPABASE_ACCESS_TOKEN (Project settings → Secrets) and re-run this script.
MSG
  exit 1
fi

payload='[]'
add() { # env-name secret-name
  local src="$1" dst="$2" value
  value="${!src:-}"
  [[ -n "$value" ]] || return 0
  payload=$(printf '%s' "$payload" | jq --arg n "$dst" --arg v "$value" \
    '. + [{name: $n, value: $v}]')
  echo "  will set $dst  (from \$$src, ${#value} chars)"
}

echo "JOBBY → Supabase project ${REF}"
add Composio COMPOSIO_API_KEY
add Worker BROWSER_WORKER_TOKEN
add Composio_API_KEY COMPOSIO_API_KEY
add BROWSER_WORKER_TOKEN BROWSER_WORKER_TOKEN
add OPENROUTER_API_KEY OPENROUTER_API_KEY
add BROWSER_WORKER_URL BROWSER_WORKER_URL

if [[ "$(printf '%s' "$payload" | jq 'length')" -eq 0 ]]; then
  echo "No source variables found — nothing to do." >&2
  exit 1
fi

echo "Sending…"
tmp=$(mktemp)
status=$(curl -sS -o "$tmp" -w '%{http_code}' -X POST "$API" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data-binary "$payload") || status='000'

case "$status" in
  200|201) echo "✓ Supabase secrets updated" ;;
  401) echo "✗ 401: access token invalid or expired." >&2 ;;
  403) echo "✗ 403: token lacks Edge Function Secrets (write)." >&2 ;;
  429) echo "✗ 429: rate limited, retry shortly." >&2 ;;
  *)   echo "✗ unexpected HTTP ${status}" >&2 ;;
esac

if [[ "$status" != "200" && "$status" != "201" ]]; then
  head -c 1500 "$tmp" >&2 || true
  echo >&2
  rm -f "$tmp"
  exit 1
fi
rm -f "$tmp"

echo
echo "Secrets now on the project (names only):"
curl -sS "$API" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  | jq -r 'sort_by(.name) | .[] | "  - \(.name)"' || true

echo
echo "Edge functions read secrets at invocation time — no redeploy needed."
