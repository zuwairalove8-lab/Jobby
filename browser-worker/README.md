# JOBBY browser worker

A small Express service that owns one Chromium instance and hands out isolated
browser contexts. `browser-gateway` calls it server-to-server with a bearer
token; the browser is never exposed to the client.

## Run locally

```bash
cd browser-worker
npm install
npm run install-browser        # downloads Chromium + OS deps
BROWSER_WORKER_TOKEN=dev-token-at-least-16-chars npm start
# → listening on :8787
```

Then set the same values as Supabase function secrets:

```
BROWSER_WORKER_URL=http://localhost:8787    # HTTPS in production
BROWSER_WORKER_TOKEN=dev-token-at-least-16-chars
```

Edge functions cannot reach your laptop, so for a hosted preview use a public
HTTPS deployment.

## Deploy

```bash
docker build -t jobby-browser-worker .
docker run -p 8787:8787 -e BROWSER_WORKER_TOKEN=... jobby-browser-worker
```

Any container host with HTTPS ingress works (Fly.io, Render, Cloud Run, a VPS
behind Caddy). Set `BROWSER_WORKER_URL` to that HTTPS origin and keep the token
in a secret store only.

### Live deployment (Render, free plan)

| | |
| --- | --- |
| URL | `https://jobby-browser-worker.onrender.com` |
| Service | `jobby-browser-worker` (`srv-dbpb0smtlv9c73f2pqsg`, Frankfurt, Docker, free) |
| Source | branch `deploy/browser-worker`, `render.yaml` in this folder |
| Vars | `BROWSER_WORKER_TOKEN`, `LOW_MEMORY=1`, `MAX_SESSIONS=1`, `SESSION_IDLE_MS=300000`, `NAV_TIMEOUT_MS=45000` |
| Health | `GET /healthz` (public, no token) |

The free instance has 512 MB and 0.1 CPU, so the worker runs one session at a
time, drops `--single-process` (it crashed renderers), and starts Chromium on
the first request rather than at boot. Render sleeps an idle service after 15
minutes: the first request afterwards pays roughly a minute of cold start, so
the first "Start session" in the app can take that long.

Pushes to `deploy/browser-worker` auto-deploy. `/healthz` must stay public — a
global bearer check in front of it makes Render's health probe fail and every
deploy stalls before going live.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Listen port |
| `BROWSER_WORKER_TOKEN` | — | Required shared secret (16+ chars) |
| `SESSION_IDLE_MS` | `600000` | Idle session expiry |
| `MAX_SESSIONS` | `8` | Concurrent contexts |
| `LOW_MEMORY` | `0` | `1` trims Chromium for a ~512 MB instance |
| `NAV_TIMEOUT_MS` | `30000` | Page navigation timeout |
| `NAV_TIMEOUT_MS` | `30000` | Navigation timeout |

## API

All routes require `Authorization: Bearer $BROWSER_WORKER_TOKEN`.

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| `GET` | `/healthz` | — | `{ ok, sessions, uptimeSeconds }` |
| `POST` | `/sessions` | `{ url }` | `{ sessionId, url, screenshot }` |
| `POST` | `/sessions/:id/navigate` | `{ url }` | `{ ok, url, screenshot }` |
| `POST` | `/sessions/:id/actions` | `{ kind, selector?, text?, direction? }` | `{ ok, message, url, screenshot }` |
| `POST` | `/sessions/:id/screenshot` | — | `{ ok, url, screenshot }` |
| `DELETE` | `/sessions/:id` | — | `{ ok }` |

Screenshots are JPEG data URLs so they can be streamed straight to the client
without extra storage.

## Safety

- HTTPS only; `localhost`, private ranges, link-local/metadata hosts and IP
  literals are rejected before navigation.
- One context per session, destroyed on idle timeout or explicit stop.
- Sandboxed Chromium (`--no-sandbox` is required in containers; run the worker in
  its own namespace/container so that does not weaken your host).
