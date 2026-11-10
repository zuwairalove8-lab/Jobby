/**
 * JOBBY shared browser worker.
 *
 * A deliberately small HTTP service around one Chromium instance. The
 * browser-gateway edge function calls it with a shared bearer token; the browser
 * itself is never exposed to the client. Sessions are isolated browser contexts
 * with an idle timeout.
 *
 * Run: BROWSER_WORKER_TOKEN=... npm start
 */
import express from 'express';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT ?? 8787);
const TOKEN = process.env.BROWSER_WORKER_TOKEN ?? '';
const IDLE_MS = Number(process.env.SESSION_IDLE_MS ?? 10 * 60 * 1000);
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS ?? 8);
const NAV_TIMEOUT = Number(process.env.NAV_TIMEOUT_MS ?? 30_000);

if (!TOKEN || TOKEN.length < 16) {
  console.error('BROWSER_WORKER_TOKEN must be set to a random string of at least 16 characters.');
  process.exit(1);
}

const privateHost = (hostname) => {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'metadata.google.internal') {
    return true;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  if (host.startsWith('[') || host.includes(':')) return true; // IPv6 literals
  return false;
};

const assertSafeUrl = (value) => {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error('That URL is not valid.');
  }
  if (url.protocol !== 'https:') throw new Error('Only https:// URLs are allowed.');
  if (privateHost(url.hostname) || !url.hostname.includes('.')) {
    throw new Error('Private or internal hosts are not allowed.');
  }
  return url.toString();
};

const app = express();
app.use(express.json({ limit: '256kb' }));

app.use((req, res, next) => {
  const auth = req.headers.authorization ?? '';
  if (auth !== `Bearer ${TOKEN}`) {
    res.status(401).json({ error: 'Unauthorised.' });
    return;
  }
  next();
});

// LOW_MEMORY=1 is for 512 MB free instances (Render free, small VPS). A single
// Chromium process with a capped JS heap fits; it is slower and one page at a time.
const lowMemory = process.env.LOW_MEMORY === '1';

const browserPromise = chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-extensions',
    ...(lowMemory
      ? ['--single-process', '--no-zygote', '--js-flags=--max-old-space-size=192']
      : []),
  ],
});

/** @type {Map<string, {context: any, page: any, lastUsed: number, timer: any}>} */
const sessions = new Map();

const touch = (id) => {
  const entry = sessions.get(id);
  if (!entry) return null;
  entry.lastUsed = Date.now();
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => void destroy(id), IDLE_MS);
  return entry;
};

const destroy = async (id) => {
  const entry = sessions.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  sessions.delete(id);
  await entry.context.close().catch(() => {});
};

const screenshot = async (page) => {
  const buffer = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
};

const describe = async (page) => ({ url: page.url(), screenshot: await screenshot(page) });

const guard = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Browser action failed.';
    res.status(400).json({ ok: false, error: message, message });
  }
};

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, sessions: sessions.size, uptimeSeconds: Math.round(process.uptime()) });
});

app.post(
  '/sessions',
  guard(async (req, res) => {
    if (sessions.size >= MAX_SESSIONS) throw new Error('The worker is at session capacity. Try again shortly.');
    const startUrl = assertSafeUrl(req.body?.url ?? 'https://example.com');
    const browser = await browserPromise;
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 JOBBY/1.0',
      locale: 'en-US',
    });
    const page = await context.newPage();
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

    const id = crypto.randomUUID();
    const timer = setTimeout(() => void destroy(id), IDLE_MS);
    sessions.set(id, { context, page, lastUsed: Date.now(), timer });

    res.json({ sessionId: id, ...(await describe(page)) });
  }),
);

app.post(
  '/sessions/:id/navigate',
  guard(async (req, res) => {
    const entry = touch(req.params.id);
    if (!entry) throw new Error('Session not found or expired.');
    const url = assertSafeUrl(req.body?.url);
    await entry.page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    res.json({ ok: true, ...(await describe(entry.page)) });
  }),
);

app.post(
  '/sessions/:id/actions',
  guard(async (req, res) => {
    const entry = touch(req.params.id);
    if (!entry) throw new Error('Session not found or expired.');
    const { kind, selector, text, direction } = req.body ?? {};
    const page = entry.page;

    switch (kind) {
      case 'click': {
        if (!selector) throw new Error('A CSS selector is required.');
        await page.locator(String(selector)).first().click({ timeout: 10_000 });
        await page.waitForTimeout(600);
        break;
      }
      case 'type': {
        if (!selector) throw new Error('A CSS selector is required.');
        await page.locator(String(selector)).first().fill(String(text ?? ''), { timeout: 10_000 });
        break;
      }
      case 'scroll': {
        await page.mouse.wheel(0, direction === 'up' ? -700 : 700);
        await page.waitForTimeout(300);
        break;
      }
      case 'back': {
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
        break;
      }
      case 'forward': {
        await page.goForward({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
        break;
      }
      default:
        throw new Error(`Unsupported action "${kind}".`);
    }

    res.json({ ok: true, message: `Completed ${kind}.`, ...(await describe(page)) });
  }),
);

app.post(
  '/sessions/:id/screenshot',
  guard(async (req, res) => {
    const entry = touch(req.params.id);
    if (!entry) throw new Error('Session not found or expired.');
    res.json({ ok: true, ...(await describe(entry.page)) });
  }),
);

app.delete(
  '/sessions/:id',
  guard(async (req, res) => {
    await destroy(req.params.id);
    res.json({ ok: true });
  }),
);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`JOBBY browser worker listening on :${PORT}`);
});

const shutdown = async () => {
  for (const id of [...sessions.keys()]) await destroy(id);
  const browser = await browserPromise.catch(() => null);
  await browser?.close().catch(() => {});
  server.close(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
