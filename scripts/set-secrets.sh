#!/usr/bin/env bash
# Sets JOBBY's edge-function secrets on Supabase.
#
# Nothing you type is echoed, written to disk, or kept in shell history:
# every value is read with `read -s` and sent straight to the Management API.
#
# Usage:
#   bash scripts/set-secrets.sh [project-ref]
#   SECRETS_FILE=.env.secrets bash scripts/set-secrets.sh
#
# With SECRETS_FILE, any of these present as NAME=value are used and you are
# not prompted for them:
#   OPENROUTER_API_KEY  COMPOSIO_API_KEY  BROWSER_WORKER_URL  BROWSER_WORKER_TOKEN
#
# Needs a Supabase personal access token with "Edge Function Secrets" write
# access: https://supabase.com/dashboard/account/tokens
set -euo pipefail

REF="${1:-famrqmqlqjzkroixnuld}"
API="https://api.supabase.com/v1/projects/${REF}/secrets"

for bin in curl jq openssl; do
  command -v "$bin" >/dev/null 2>&1 || { echo "Missing required command: $bin" >&2; exit 1; }
done

echo "JOBBY → project ${REF}"
if [[ -n "${SECRETS_FILE:-}" ]]; then
  if [[ -f "$SECRETS_FILE" ]]; then
    echo "Reading values from $SECRETS_FILE (lines must be NAME=value)."
  else
    echo "! SECRETS_FILE=$SECRETS_FILE does not exist — falling back to prompts." >&2
  fi
fi
echo "Paste each value at its prompt (nothing is shown). Press Enter on a blank"
echo "value to leave that secret untouched."
echo

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  printf 'Supabase personal access token: '
  read -rs SUPABASE_ACCESS_TOKEN
  printf '\n'
fi
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "No access token supplied — aborting." >&2
  exit 1
fi

payload='[]'
add() { # name value
  payload=$(printf '%s' "$payload" | jq --arg n "$1" --arg v "$2" '. + [{name: $n, value: $v}]')
  echo "  queued: $1"
}

file_value() { # name
  [[ -n "${SECRETS_FILE:-}" && -f "${SECRETS_FILE:-}" ]] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$SECRETS_FILE" \
    | head -n1 \
    | sed -e 's/[[:space:]]*$//' -e "s/^[\"']//" -e "s/[\"']$//"
}

ask() { # outvar label
  local out="$1" label="$2" value=''
  value=$(file_value "$1")
  if [[ -n "$value" ]]; then
    echo "$label: using value from $SECRETS_FILE"
    printf -v "$out" '%s' "$value"
    return 0
  fi
  printf '%s: ' "$label"
  read -rs value
  printf '\n'
  printf -v "$out" '%s' "$value"
}

# --- AI provider (server default; users can still bring their own key) --------
ask OPENROUTER_API_KEY 'OPENROUTER_API_KEY (sk-or-..., blank to skip)'
if [[ -n "$OPENROUTER_API_KEY" ]]; then add OPENROUTER_API_KEY "$OPENROUTER_API_KEY"; fi

# --- Composio hosted MCP accounts -------------------------------------------
ask COMPOSIO_API_KEY 'COMPOSIO_API_KEY (blank to skip)'
if [[ -n "$COMPOSIO_API_KEY" ]]; then add COMPOSIO_API_KEY "$COMPOSIO_API_KEY"; fi

# --- Shared remote browser ---------------------------------------------------
ask BROWSER_WORKER_URL 'BROWSER_WORKER_URL (https://host, blank to skip)'
if [[ -n "$BROWSER_WORKER_URL" ]]; then
  case "$BROWSER_WORKER_URL" in
    https://*) add BROWSER_WORKER_URL "${BROWSER_WORKER_URL%/}" ;;
    *) echo "  ! ignored: BROWSER_WORKER_URL must start with https://" >&2 ;;
  esac
fi

GENERATED_TOKEN=''
ask BROWSER_WORKER_TOKEN 'BROWSER_WORKER_TOKEN (blank = generate one now)'
if [[ -z "$BROWSER_WORKER_TOKEN" ]]; then
  BROWSER_WORKER_TOKEN=$(openssl rand -hex 32)
  GENERATED_TOKEN="$BROWSER_WORKER_TOKEN"
fi
add BROWSER_WORKER_TOKEN "$BROWSER_WORKER_TOKEN"

if [[ "$(printf '%s' "$payload" | jq 'length')" -eq 0 ]]; then
  echo "Nothing to set — no values entered."
  exit 0
fi

echo
echo "Sending to Supabase…"
tmp=$(mktemp)
status=$(curl -sS -o "$tmp" -w '%{http_code}' -X POST "$API" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data-binary "$payload") || status='000'

case "$status" in
  200|201) echo "✓ secrets saved" ;;
  401) echo "✗ 401: the access token is invalid or expired." >&2 ;;
  403) echo "✗ 403: the token lacks Edge Function Secrets (write) permission." >&2 ;;
  429) echo "✗ 429: rate limited — wait a minute and retry." >&2 ;;
  *)   echo "✗ unexpected HTTP ${status}" >&2 ;;
esac

if [[ "$status" != "200" && "$status" != "201" ]]; then
  echo "Server said:" >&2
  head -c 2000 "$tmp" >&2 || true
  echo >&2
  rm -f "$tmp"
  exit 1
fi
rm -f "$tmp"

echo
echo "Secrets now on the project (names only):"
curl -sS "$API" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  | jq -r 'sort_by(.name) | .[] | "  - \(.name)"' || true

if [[ -n "$GENERATED_TOKEN" ]]; then
  cat <<EOF

Generated BROWSER_WORKER_TOKEN — copy it now, it is not shown again:

  ${GENERATED_TOKEN}

Give the browser worker the same value where it runs, e.g.:

  docker run -p 8787:8787 -e BROWSER_WORKER_TOKEN=<the token above> jobby-browser-worker

Keep it in the host's secret store, never in a file in this repo.
EOF
fi

unset SUPABASE_ACCESS_TOKEN OPENROUTER_API_KEY COMPOSIO_API_KEY BROWSER_WORKER_URL BROWSER_WORKER_TOKEN payload 2>/dev/null || true
echo
echo "Done. Restart is not needed — edge functions read secrets at invocation time."
