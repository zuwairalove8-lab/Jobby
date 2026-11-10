# JOBBY browser worker

The service `browser-gateway` calls server-to-server with a bearer token to drive
one shared remote browser. The browser is never exposed to the client.

Two interchangeable implementations speak the same HTTP contract, so switching
between them is only a `BROWSER_WORKER_URL` change:

| | `cloudflare/` (in use) | `server.mjs` (container) |
| --- | --- | --- |
| Browser | Cloudflare Browser Run (managed Chromium) | Chromium in the container |
| Runtime | Worker + one Durable Object | Node/Express |
| Cold start | none | ~60 s after idle sleep on free hosts |
| Cost | free: 10 browser-minutes/day | free host 512 MB / 750 hrs |
| Best for | real use | local development, self-hosting |

## Cloudflare (current deployment)

A Worker cannot run Chromium itself, so `cloudflare/src/index.js` delegates to
Browser Run and keeps the container API shape.

| | |
| --- | --- |
| URL | `https://jobby-browser-worker.redx87518.workers.dev` |
| Worker | `jobby-browser-worker` (account `redx87518`) |
| Bindings | `BROWSER` (Browser Run), `SESSIONS` (Durable Object `BrowserSessions`) |
| Secret | `BROWSER_WORKER_TOKEN` (`wrangler secret put`) |
| Vars | `KEEP_ALIVE_MS=300000`, `NAV_TIMEOUT_MS=45000` |
| Health | `GET /healthz` (public, no token) |

```bash
cd browser-worker/cloudflare
npm install
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npx wrangler deploy
printf '%s' "$BROWSER_WORKER_TOKEN" | npx wrangler secret put BROWSER_WORKER_TOKEN
```

Points that matter in this implementation:

- **A Durable Object owns the connection.** Browser Run tabs belong to the
  connection that created them: reconnecting without a live handle gives a blank
  page. The DO keeps one live connection and its page, so the tab survives
  between requests. It stores the session ID and last URL, so waking after
  eviction reconnects and restores the page.
- **History is tracked in the DO.** Browser Run's CDP proxy reports no navigation
  history, so `page.goBack()` always returns null. The DO keeps its own stack,
  which is the session's real history because every navigation goes through it.
- **A stray call never spends quota.** Only `POST /sessions` may acquire a
  browser; a screenshot or action after stop returns `409 Start a browser
  session first` instead of silently launching a new browser.
- **Starting again reuses the live tab** rather than closing and re-acquiring,
  which would burn both browser time and the new-browser rate limit.
- **Idle tabs close after 120 s** (`IDLE_CLOSE_MS`), because browser time is
  metered.

### Free-plan limits

The Workers Free plan includes **10 browser-minutes per day**, about 3–4
concurrent browsers, and roughly **one new browser every 20 seconds**. New
browsers are retried up to three times, 8 s apart, so a burst of starts does not
surface as a raw 429. When the daily allowance is spent, Browser Run returns 429
and the worker reports "The Cloudflare browser allowance for today is used up."
A Workers Paid plan ($5/mo) covers 10 browser-hours per month.

## Container worker

```bash
cd browser-worker
npm install
npm run install-browser        # downloads Chromium + OS deps
BROWSER_WORKER_TOKEN=dev-token-at-least-16-chars npm start
# → listening on :8787
```

```bash
docker build -t jobby-browser-worker .
docker run -p 8787:8787 -e BROWSER_WORKER_TOKEN=... jobby-browser-worker
```

Any container host with HTTPS ingress works (Fly.io, Render, Cloud Run, a VPS
behind Caddy). Set `BROWSER_WORKER_URL` to that HTTPS origin and keep the token
in a secret store only.

The previous Render deployment is `jobby-browser-worker.onrender.com`
(`srv-dbpb0smtlv9c73f2pqsg`, free, Frankfurt). It is no longer referenced by
`BROWSER_WORKER_URL`.

On that host the 512 MB / 0.1 CPU instance runs one session at a time, drops
`--single-process` (it crashed renderers), and starts Chromium on the first
request rather than at boot. Render sleeps an idle service after 15 minutes: the
first request afterwards pays roughly a minute of cold start. `/healthz` must
stay public there too — a global bearer check in front of it makes Render's
health probe fail and every deploy stalls before going live.

## Environment

Container worker:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Listen port |
| `BROWSER_WORKER_TOKEN` | — | Required shared secret (16+ chars) |
| `SESSION_IDLE_MS` | `600000` | Idle session expiry |
| `MAX_SESSIONS` | `8` | Concurrent contexts |
| `LOW_MEMORY` | `0` | `1` trims Chromium for a ~512 MB instance |
| `NAV_TIMEOUT_MS` | `30000` | Page navigation timeout |

Cloudflare worker: `BROWSER_WORKER_TOKEN` (secret), `KEEP_ALIVE_MS` (300000),
`NAV_TIMEOUT_MS` (45000). Idle close is 120 s in `src/index.js`.

## API

All routes require `Authorization: Bearer $BROWSER_WORKER_TOKEN` except
`/healthz`.

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| `GET` | `/healthz` | — | `{ ok, sessions }` |
| `POST` | `/sessions` | `{ url }` | `{ sessionId, url, screenshot }` |
| `POST` | `/sessions/:id/navigate` | `{ url }` | `{ ok, url, screenshot }` |
| `POST` | `/sessions/:id/actions` | `{ kind, selector?, text?, direction? }` | `{ ok, message, url, screenshot }` |
| `POST` | `/sessions/:id/screenshot` | — | `{ ok, url, screenshot }` |
| `DELETE` | `/sessions/:id` | — | `{ ok }` |

`kind` is one of `click`, `type`, `scroll`, `back`, `forward`. Screenshots are
JPEG data URLs so they can be streamed straight to the client without extra
storage.

## Safety

- HTTPS only; the container worker also rejects `localhost`, private ranges,
  link-local/metadata hosts and IP literals before navigation.
- One context per session, destroyed on idle timeout or explicit stop.
- Bearer tokens are compared in constant time in the Cloudflare worker.
- Sandboxed Chromium in the container (`--no-sandbox` is required there; run the
  worker in its own namespace/container so that does not weaken your host).

## Verify

```bash
BROWSER_WORKER_URL=https://jobby-browser-worker.redx87518.workers.dev \
  bash ../scripts/verify-browser-worker.sh
```

Checks `/healthz`, a direct session, a rejected token (401), and a session
created through the deployed `browser-gateway` as a signed-in user.
