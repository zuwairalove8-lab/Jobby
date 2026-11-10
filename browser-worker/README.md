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

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Listen port |
| `BROWSER_WORKER_TOKEN` | — | Required shared secret (16+ chars) |
| `SESSION_IDLE_MS` | `600000` | Idle session expiry |
| `MAX_SESSIONS` | `8` | Concurrent contexts |
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
