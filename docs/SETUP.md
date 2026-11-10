# JOBBY backend setup

Everything here is already applied to the reference project
(`famrqmqlqjzkroixnuld`). Use this as the reproducible runbook for a fresh
project or to rotate credentials.

## 1. Database

Apply migrations in order:

```bash
supabase link --project-ref <ref>
supabase db push          # applies supabase/migrations/*
```

Or paste each file into the SQL editor:

1. `0001_init.sql` — enums, tables, indexes, RLS policies, profile trigger,
   private `resumes` / `attachments` buckets, built-in skill packs.
2. `0002_vault_and_registry.sql` — vault helper functions restricted to
   `service_role`, MCP reference catalogue.

Verify:

```sql
select table_name from information_schema.tables where table_schema = 'public' order by 1;
select count(*) from public.skills where built_in;
```

## 2. Edge functions

```bash
supabase functions deploy agent-chat      --project-ref <ref>
supabase functions deploy provider-gateway --project-ref <ref>
supabase functions deploy jobs            --project-ref <ref>
supabase functions deploy resume          --project-ref <ref>
supabase functions deploy mcp-gateway     --project-ref <ref>
supabase functions deploy browser-gateway --project-ref <ref>
```

Each function is a single self-contained file (no shared local imports) so it can
also be deployed from the dashboard or through an integration by pasting the
file body.

Keep JWT verification **on** — every function additionally calls
`auth.getUser()` and scopes all queries to the verified user id.

## 3. Secrets

Set these as Edge Function secrets (never in the repo, never in chat):

| Secret | Required | Notes |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | for the default provider | Server-wide OpenRouter key. Without it, users must bring their own. |
| `OPENROUTER_DEFAULT_MODEL` | optional | Defaults to `openrouter/auto`. |
| `COMPOSIO_API_KEY` | for hosted MCP accounts | Marketplace falls back to the reference catalogue without it. |
| `BROWSER_WORKER_URL` | for the shared browser | HTTPS origin of `browser-worker/`. |
| `BROWSER_WORKER_TOKEN` | for the shared browser | Random 32+ char string, the same value the worker receives. |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
by the platform.

### Setting them from a terminal

Dashboard → Project Settings → **Edge Functions → Secrets** works with no token.
For the terminal, use the hidden-input helper (values are never echoed, never
written to disk, never in shell history):

```bash
bash scripts/set-secrets.sh            # prompts for each secret, blank = skip
```

It needs a personal access token with *Edge Function Secrets (write)*** from
<https://supabase.com/dashboard/account/tokens>, and it can generate a strong
`BROWSER_WORKER_TOKEN` for you. On a deployed worker host, give the worker the
same token via its own env/secret store, then set `BROWSER_WORKER_URL` here.

Rotate a leaked key at the provider, then update the secret — JOBBY reads it at
runtime, so no redeploy of user data is needed. Rotate `BROWSER_WORKER_TOKEN` on
both sides at the same time.

## 4. Auth

- Email + password with PKCE is wired in `AuthProvider`.
- Add your deployed origins under Authentication → URL Configuration
  (site URL and redirect URLs). Capacitor uses `https://localhost` as its origin.
- The `handle_new_user` trigger creates the profile row automatically.

## 5. Browser worker

```bash
cd browser-worker
npm install
npm run install-browser       # playwright chromium + OS deps
BROWSER_WORKER_TOKEN=... npm start
```

Deploy the Dockerfile to any container host with HTTPS ingress (Fly.io, Render,
Cloud Run, a VPS behind Caddy). Then set `BROWSER_WORKER_URL` and
`BROWSER_WORKER_TOKEN` as function secrets. The worker only accepts https URLs,
blocks private/metadata hosts, and expires idle sessions.

## 6. Verification checklist

```bash
npm run build && npm test
```

Then, signed in:

1. **Agent Manager → AI providers**: add an OpenRouter provider, paste your key,
   press *Test connection* — you should see a model count and latency.
2. **AI Workspace**: send “search for entry-level GRC roles”. Watch tool steps
   appear; approve the first `search_jobs` if you have set it to *ask*.
3. **Job Search**: run a search, open a role, press *Match me* and read the
   matched/missing lists.
4. **CV Studio**: generate a tailored CV; confirm the preview contains only facts
   from your profile.
5. **Applications**: save a role and move it through stages.
6. **Shared Browser**: start a session, navigate, click by selector — the
   screenshot should update and Activity should log each action.
7. **Marketplace**: connect a custom MCP server (or Composio once the key is set)
   and confirm tools appear; a failed handshake must show the provider error.
8. **Audit log**: every step above appears with a run id and status.

If a step cannot pass because a credential is missing, the UI must say so — that
is expected behaviour, not a bug to work around.
