#!/usr/bin/env bash
# Deploy the JOBBY browser worker to a free Hugging Face Docker Space.
#
# Why HF Spaces: it is the only free host we can drive end-to-end over an API
# without a credit card — it builds our Dockerfile, runs Playwright's own base
# image, gives 2 vCPU / 16 GB RAM and a public HTTPS URL. Free Spaces sleep after
# inactivity, so the first request after a quiet spell can take ~30s.
#
# Requirements (both come from Project settings → Secrets, never from chat):
#   HF_TOKEN               a Hugging Face token with WRITE scope
#   BROWSER_WORKER_TOKEN   the same token Supabase already holds (falls back to $Worker)
#
# Usage:
#   bash scripts/deploy-hf-space.sh
#
# Prints the public URL on success. Nothing secret is echoed or written to disk
# beyond the throwaway clone in /tmp (which uses an in-memory auth header).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER_DIR="$ROOT/browser-worker"
SPACE_NAME="${SPACE_NAME:-jobby-browser-worker}"

for bin in curl jq git; do
  command -v "$bin" >/dev/null 2>&1 || { echo "Missing required command: $bin" >&2; exit 1; }
done

if [[ -z "${HF_TOKEN:-}" ]]; then
  cat >&2 <<'MSG'
HF_TOKEN is not set.

Create a Write token at https://huggingface.co/settings/tokens, then add it as a
Freebuff project secret named HF_TOKEN (Project settings → Secrets) and re-run.
MSG
  exit 1
fi

WORKER_TOKEN="${BROWSER_WORKER_TOKEN:-${Worker:-}}"
if [[ ${#WORKER_TOKEN} -lt 16 ]]; then
  echo "BROWSER_WORKER_TOKEN (or \$Worker) is missing or shorter than 16 chars." >&2
  exit 1
fi

auth=(-H "Authorization: Bearer ${HF_TOKEN}")
api="https://huggingface.co/api"

USER_NAME=$(curl -sS "${auth[@]}" "$api/whoami-v2" | jq -r '.name // empty')
if [[ -z "$USER_NAME" ]]; then
  echo "HF_TOKEN was rejected (whoami returned no user). Check the token scope." >&2
  exit 1
fi
echo "Hugging Face account: $USER_NAME"

# 1. Create the Space (409 = already exists, which is fine on re-runs).
echo "→ creating space ${USER_NAME}/${SPACE_NAME} (docker)"
curl -sS -o /tmp/hf-create.json -w '  http=%{http_code}\n' \
  -X POST "$api/repos/create" "${auth[@]}" -H 'Content-Type: application/json' \
  -d "{\"name\":\"${SPACE_NAME}\",\"type\":\"space\",\"sdk\":\"docker\",\"private\":false}" || true
jq -r '.error // "  ok"' /tmp/hf-create.json 2>/dev/null | head -2

# 2. Clone, add the worker files, push. The token travels in a header, never in
#    the remote URL, so it is not persisted into .git/config.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
space_url="https://huggingface.co/spaces/${USER_NAME}/${SPACE_NAME}"
echo "→ syncing files"
git -c "http.${space_url}.extraHeader=Authorization: Bearer ${HF_TOKEN}" \
    clone --depth 1 "$space_url" "$work/space" >/dev/null 2>&1 || {
  # Empty/new space: clone fails, so initialise it instead.
  mkdir -p "$work/space" && git -C "$work/space" init -q
  git -C "$work/space" remote add origin "$space_url"
}

cp "$WORKER_DIR/Dockerfile" "$WORKER_DIR/server.mjs" "$WORKER_DIR/package.json" "$work/space/"

cat > "$work/space/README.md" <<EOF
---
title: JOBBY Browser Worker
emoji: 🌐
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 8787
pinned: false
---

Playwright worker for JOBBY's shared remote browser. Bearer-token protected; it
only accepts https URLs and blocks private hosts. Not a public browsing proxy.
EOF

git -C "$work/space" add -A
git -C "$work/space" -c user.email="worker@jobby.local" -c user.name="JOBBY" \
  commit -q -m "JOBBY browser worker" || echo "  (no file changes)"
git -C "$work/space" -c "http.${space_url}.extraHeader=Authorization: Bearer ${HF_TOKEN}" \
  push -q origin HEAD:main 2>&1 | tail -3 || true

# 3. Space secret: same bearer token Supabase uses. Sent over HTTPS only.
echo "→ setting BROWSER_WORKER_TOKEN on the space"
printf '%s' "$WORKER_TOKEN" | jq -Rs '{key: "BROWSER_WORKER_TOKEN", value: .}' \
  | curl -sS -o /tmp/hf-secret.json -w '  http=%{http_code}\n' \
      -X POST "$api/spaces/${USER_NAME}/${SPACE_NAME}/secrets" "${auth[@]}" \
      -H 'Content-Type: application/json' --data-binary @-

# 4. Wait for the build to report RUNNING.
echo "→ waiting for the space to build (first build pulls a 1.5 GB Playwright image)"
stage=""
for _ in $(seq 1 60); do
  stage=$(curl -sS "${auth[@]}" "$api/spaces/${USER_NAME}/${SPACE_NAME}/runtime" | jq -r '.stage // "UNKNOWN"' 2>/dev/null || echo UNKNOWN)
  case "$stage" in
    RUNNING) break ;;
    BUILD_ERROR|RUNTIME_ERROR|CONFIG_ERROR) echo "  build stage: $stage — check the Space logs." >&2; break ;;
  esac
  sleep 10
done
echo "  final stage: ${stage:-unknown}"

host=$(printf '%s' "$USER_NAME" | tr '[:upper:]' '[:lower:]' | tr '_' '-')
space_host=$(printf '%s' "$SPACE_NAME" | tr '[:upper:]' '[:lower:]' | tr '_' '-')
echo
echo "Public URL: https://${host}-${space_host}.hf.space"
echo "Set it in Supabase as BROWSER_WORKER_URL (no trailing slash)."
