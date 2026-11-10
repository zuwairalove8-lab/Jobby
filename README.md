# JOBBY

An autonomous AI job assistant: it searches live job feeds, scores your fit with
transparent evidence, drafts truthful CVs and cover letters, tracks applications,
drives a shared remote browser, and runs tools from connected MCP accounts — and
it asks before it acts.

JOBBY ships as a responsive web app, an installable PWA, and an Android app via
Capacitor 8 (package `com.jobby.app`). The Android app bundles the built web app
locally; it never redirects to a hosted site.

---

## What is actually implemented

| Area | Behaviour |
| --- | --- |
| **AI agent** | Streaming chat (`agent-chat`) with a real tool-calling loop, per-tool permissions, and pause-for-approval before sensitive actions. |
| **Providers** | OpenRouter is the server default when `OPENROUTER_API_KEY` is set. Every user can add their own OpenRouter / OpenAI-compatible / Kilo provider with a key encrypted in Supabase Vault. |
| **Skills** | Built-in instruction packs (truth-only applications, evidence-first matching, submission gate, tone) plus per-user custom skills, all injected into the agent's system prompt. |
| **Job search** | Live, keyless feeds: Remotive, Arbeitnow and Himalayas. Results are normalised, persisted, and returned with per-source availability so an outage is visible, never hidden. |
| **Match scoring** | Deterministic 60/20/20 model (required skills, preferred skills, eligibility) mirrored in `src/lib/match.ts` and `supabase/functions/jobs`. Every point is traceable to a matched or missing requirement. |
| **CV Studio** | Structured editor, uploaded documents in private storage, print/PDF export, AI tailoring and cover letters that may only use recorded facts. |
| **Applications** | Eight-stage tracker with notes, CV linkage, and one-click stage changes. Nothing is ever submitted automatically. |
| **Shared browser** | A self-hosted Playwright worker (`browser-worker/`) proxied by `browser-gateway`, with URL-bar navigation, selector actions, screenshots and an audit trail. Reports "not configured" honestly when absent. |
| **MCP marketplace** | Composio hosted accounts (OAuth) and custom MCP servers over HTTPS, with tool discovery, per-tool enable/disable and vault-stored tokens. |
| **Audit trail** | Every tool execution — allowed, denied, failed or approved — is written to `tool_execution_logs` and shown in Agent Manager. |
| **PWA / Android** | Manifest + service worker, generated icon set, Capacitor Android project, GitHub Actions debug APK. |

---

## Architecture

```
┌──────────────────────────┐        ┌──────────────────────────────┐
│ React 19 + Vite (PWA)    │        │ Supabase                     │
│ Capacitor 8 Android      │◀──────▶│  Postgres + RLS              │
└───────────┬──────────────┘        │  Auth (PKCE)                 │
            │  supabase-js          │  Storage (private buckets)   │
            │                       │  Vault (provider keys)       │
            ▼                       └───────────┬──────────────────┘
┌────────────────────────────────────────────── ▼ ─────────────────┐
│ Edge functions (Deno)                                            │
│  agent-chat      streaming loop, tools, approvals                │
│  provider-gateway  status, tests, vault-backed BYOK              │
│  jobs            feed search + match scorer                      │
│  resume          truthful CV + cover letter generation           │
│  mcp-gateway     Composio + custom MCP servers                   │
│  browser-gateway  proxy + session state                          │
└───────────────────────────┬──────────────────────────────────────┘
                            │ bearer token
                            ▼
                 ┌────────────────────────────┐
                 │ browser-worker (Playwright)│
                 │  container, own host       │
                 └────────────────────────────┘
```

Security model:

- The browser only ever holds the **publishable** Supabase key; Postgres RLS is the
  authorization boundary for every table.
- Edge functions verify the caller's JWT with `auth.getUser()` and then act with
  the service role on that user's behalf.
- Provider keys and MCP tokens live in **Supabase Vault**; only `SECURITY DEFINER`
  helpers executable by `service_role` can read them.
- `provider_secrets` and `mcp_connection_secrets` have RLS enabled and **no**
  policies, so clients cannot read vault pointers.
- Application submission always requires explicit approval, whatever the stored
  permission level says.

---

## Quick start

```bash
npm ci
cp .env.example .env      # add your Supabase URL + publishable key
npm run dev               # http://localhost:3000
```

```bash
npm run typecheck         # tsc --noEmit
npm test                  # vitest
npm run build             # typecheck + production bundle
npm run icons             # regenerate PWA + Android icons
```

### Environment

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `.env`, repo secret for CI | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `.env`, repo secret for CI | Publishable key (RLS-protected) |
| `VITE_BROWSER_WORKER_URL` | optional | Shown in the UI so the browser tab knows a worker exists |
| `VITE_APP_ORIGIN` | optional | Canonical origin, used for OAuth callbacks |

Server-side secrets (Supabase → Edge Functions → Secrets) are documented in
[`docs/SETUP.md`](docs/SETUP.md).

---

## Repository layout

```
src/
  components/    design system, shell, markdown, error boundary
  context/       auth + toast providers
  lib/           env, supabase client, match scoring, SSE parser, URL guard, tools
  modules/       ai-chat (stream hook, composer, message UI, speech)
  pages/         dashboard, workspace, browser, jobs, CV studio, applications,
                 marketplace, agent manager, settings, login
  services/      typed data access (db) and edge-function calls (api)
supabase/
  migrations/    schema, RLS, vault helpers, seeds
  functions/     agent-chat, provider-gateway, jobs, resume, mcp-gateway, browser-gateway
browser-worker/  Playwright service (Express + Dockerfile)
android/         Capacitor Android project
.github/         Android APK workflow
tools/           dependency-free icon generator
docs/            setup, Android, API notes
```

---

## Android

See [`docs/ANDROID.md`](docs/ANDROID.md). The short version: push to `main` (or
run the workflow manually) and download the `jobby-debug-apk` artifact. Signed
release builds require your own keystore and are documented separately — the
workflow intentionally produces an unsigned debug APK.

---

## Honest limitations

- **Live AI and MCP calls require credentials.** Without `OPENROUTER_API_KEY` (or
  a user's own provider key) the agent returns a clear configuration error
  instead of a fake reply. Without `COMPOSIO_API_KEY`, the marketplace shows a
  reference catalogue and refuses to pretend accounts are connected.
- **The shared browser needs a deployed worker.** Edge functions cannot host a
  browser; deploy `browser-worker/` and set its URL/token. The UI says so.
- **Job feeds are public and rate-limited.** Source failures are surfaced per
  feed; JOBBY never substitutes invented listings.
- **No auto-submission.** JOBBY can open an application page and prepare
  everything, but the final submit is yours.
- **Android builds do not run in this workspace** (no JDK/Android SDK); the
  workflow is the supported path and compiles the committed Gradle project.
