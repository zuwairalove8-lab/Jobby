/**
 * JOBBY browser worker on Cloudflare.
 *
 * A Worker cannot run Chromium itself, so this speaks the same HTTP contract as
 * the container worker in ../server.mjs but delegates the browser to Cloudflare
 * Browser Run (managed Chromium).
 *
 * Browser Run tabs belong to the connection that created them: reconnecting
 * without a live handle yields a blank page. A Durable Object therefore owns one
 * long-lived connection and its page, so the tab survives between requests the
 * way the app expects. The DO stores the session ID and last URL so a wake-up
 * after eviction reconnects and restores where the user was.
 *
 * Contract (bearer authed, except /healthz):
 *   GET    /healthz
 *   POST   /sessions               { url? }        -> { sessionId, url, screenshot }
 *   POST   /sessions/:id/navigate  { url }         -> { ok, url, screenshot }
 *   POST   /sessions/:id/actions   { kind, ... }   -> { ok, message, url, screenshot }
 *   POST   /sessions/:id/screenshot                -> { ok, url, screenshot }
 *   DELETE /sessions/:id                           -> { ok }
 */

import { acquire, connect, limits as browserLimits, sessions as listSessions } from '@cloudflare/playwright';

const DEFAULT_NAV_TIMEOUT = 45_000;
const DEFAULT_KEEP_ALIVE = 300_000;
const IDLE_CLOSE_MS = 120_000;
const VIEWPORT = { width: 1280, height: 800 };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const number = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Only https, and never a non-http scheme smuggled into the URL. */
const assertSafeUrl = (raw) => {
  const value = String(raw ?? '').trim();
  if (!value) throw new Error('A URL is required.');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`"${value.slice(0, 120)}" is not a valid URL.`);
  }
  if (parsed.protocol !== 'https:') throw new Error('Only https:// URLs are allowed.');
  return parsed.toString();
};

const authorised = async (request, env) => {
  const expected = env.BROWSER_WORKER_TOKEN ?? '';
  if (expected.length < 16) return false;
  const header = request.headers.get('authorization') ?? '';
  const received = header.replace(/^Bearer\s+/i, '').trim();
  if (received.length !== expected.length) return false;
  // Constant-time compare: a timing oracle on the shared token is cheap to close.
  const a = new TextEncoder().encode(received);
  const b = new TextEncoder().encode(expected);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
};

const screenshotOf = async (page) => {
  const buffer = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
};

const describe = async (page) => ({ url: page.url(), screenshot: await screenshotOf(page) });

const health = async (env) => {
  const payload = { ok: true, provider: 'cloudflare-browser-run' };
  try {
    payload.sessions = (await listSessions(env.BROWSER)).length;
  } catch {
    payload.sessions = null;
  }
  try {
    const current = await browserLimits(env.BROWSER);
    payload.limits = {
      maxConcurrentSessions: current.maxConcurrentSessions,
      allowedBrowserAcquisitions: current.allowedBrowserAcquisitions,
    };
  } catch {
    /* limits are informational only */
  }
  return json(payload);
};

export class BrowserSessions {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.browser = null;
    this.page = null;
    this.active = false;
    this.history = [];
    this.index = -1;
  }

  async load() {
    const stored = await this.state.storage.get(['sessionId', 'lastUrl', 'active', 'history', 'index']);
    this.sessionId = stored.get('sessionId') ?? null;
    this.lastUrl = stored.get('lastUrl') ?? null;
    this.active = stored.get('active') === true;
    this.history = stored.get('history') ?? [];
    this.index = stored.get('index') ?? -1;
    return this;
  }

  /**
   * Reuse the live page, reconnect to the stored session, or acquire a new one.
   * Browser time is metered and new browsers are rate limited, so only an
   * explicit start may acquire: a stray screenshot after stop must never spawn
   * a fresh browser.
   */
  async open({ allowAcquire = false } = {}) {
    if (this.page && !this.page.isClosed()) return this.page;
    if (!this.active && !allowAcquire) throw new Error('No active browser session.');

    if (this.sessionId) {
      try {
        this.browser = await connect(this.env.BROWSER, this.sessionId);
      } catch {
        // Session was closed on Cloudflare's side (idle timeout, quota, crash).
        this.sessionId = null;
        this.browser = null;
      }
    }

    if (!this.browser) {
      const acquired = await this.acquire();
      this.sessionId = acquired.sessionId;
      this.browser = await connect(this.env.BROWSER, this.sessionId);
      this.active = true;
      await this.state.storage.put({ sessionId: this.sessionId, active: true });
      this.page = null;
    }

    const contexts = this.browser.contexts();
    const context =
      contexts[0] ??
      (await this.browser.newContext({
        viewport: VIEWPORT,
        locale: 'en-US',
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 JOBBY/1.0',
      }));
    const pages = context.pages();
    this.page = pages[0] ?? (await context.newPage());

    // A fresh tab after eviction restores the page the user was last on.
    if (this.lastUrl && this.page.url() === 'about:blank') {
      await this.page
        .goto(this.lastUrl, { waitUntil: 'domcontentloaded', timeout: number(this.env.NAV_TIMEOUT_MS, DEFAULT_NAV_TIMEOUT) })
        .catch(() => undefined);
    }
    return this.page;
  }

  /**
   * The free plan allows roughly one new browser per 20 seconds, so a burst of
   * starts must not surface as a raw 429 to the user.
   */
  async acquire(attempts = 3) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await acquire(this.env.BROWSER, {
          keep_alive: number(this.env.KEEP_ALIVE_MS, DEFAULT_KEEP_ALIVE),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/429|rate limit/i.test(message) || attempt >= attempts) throw error;
        await sleep(8_000);
      }
    }
  }

  async touch(page) {
    this.lastUrl = page.url();
    await this.state.storage.put('lastUrl', this.lastUrl);
    // Browsing time is metered, so an abandoned tab is closed rather than left running.
    await this.state.storage.setAlarm(Date.now() + IDLE_CLOSE_MS);
  }

  /**
   * Browser Run's CDP proxy reports no navigation history, so page.goBack()
   * always yields null. Keep the tab's history here: the worker performs every
   * navigation, so this stack is the session's real history.
   */
  async record(page) {
    const url = page.url();
    if (url && url !== 'about:blank' && this.history[this.index] !== url) {
      this.history = this.history.slice(0, this.index + 1);
      this.history.push(url);
      if (this.history.length > 50) this.history = this.history.slice(-50);
      this.index = this.history.length - 1;
      await this.state.storage.put({ history: this.history, index: this.index });
    }
    await this.touch(page);
  }

  async historyMove(kind, page) {
    const target = kind === 'back' ? this.index - 1 : this.index + 1;
    if (target < 0) throw new Error('There is no page to go back to.');
    if (target >= this.history.length) throw new Error('There is no page to go forward to.');

    const url = this.history[target];
    await page
      .goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: number(this.env.NAV_TIMEOUT_MS, DEFAULT_NAV_TIMEOUT),
      })
      .catch(() => undefined);
    this.index = target;
    await this.state.storage.put('index', this.index);
    await this.record(page);
    return url;
  }

  async close() {
    await this.state.storage
      .delete(['sessionId', 'lastUrl', 'active', 'history', 'index'])
      .catch(() => undefined);
    await this.state.storage.deleteAlarm().catch(() => undefined);
    const sessionId = this.sessionId;
    this.sessionId = null;
    this.lastUrl = null;
    this.active = false;
    this.page = null;
    this.history = [];
    this.index = -1;
    if (this.browser) {
      // close() ends the underlying session for a connect() handle only when the
      // session is explicitly closed, so use the binding's explicit close too.
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
    if (sessionId) await this.env.BROWSER.closeSession?.(sessionId).catch?.(() => undefined);
  }

  async alarm() {
    await this.close();
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    try {
      if (path === '/sessions') {
        if (method !== 'POST') return json({ error: 'Use POST to start a session.' }, 405);
        const body = await request.json().catch(() => ({}));
        const startUrl = assertSafeUrl(body?.url ?? 'https://example.com');

        // One shared browser: a live session is reused rather than closed and
        // re-acquired, which would spend browser time and the new-browser quota.
        let page = null;
        try {
          page = await this.open();
        } catch {
          page = null;
        }
        if (!page) {
          await this.close();
          page = await this.open({ allowAcquire: true });
        }
        this.history = [];
        this.index = -1;
        await this.state.storage.put({ history: this.history, index: this.index });
        await page.goto(startUrl, {
          waitUntil: 'domcontentloaded',
          timeout: number(this.env.NAV_TIMEOUT_MS, DEFAULT_NAV_TIMEOUT),
        });
        const payload = await describe(page);
        await this.record(page);
        return json({ sessionId: this.sessionId, ...payload });
      }

      const match = path.match(/^\/sessions\/([A-Za-z0-9_-]+)(?:\/([a-z]+))?$/);
      if (!match) return json({ error: `Unknown route ${method} ${path}.` }, 404);
      const action = match[2];

      if (!action) {
        if (method !== 'DELETE') return json({ error: 'Use DELETE to end a session.' }, 405);
        await this.close();
        return json({ ok: true });
      }

      if (method !== 'POST') return json({ error: 'Use POST for browser actions.' }, 405);

      if (action === 'navigate') {
        const body = await request.json().catch(() => ({}));
        const target = assertSafeUrl(body?.url);
        const page = await this.open();
        await page.goto(target, {
          waitUntil: 'domcontentloaded',
          timeout: number(this.env.NAV_TIMEOUT_MS, DEFAULT_NAV_TIMEOUT),
        });
        const payload = await describe(page);
        await this.record(page);
        return json({ ok: true, ...payload });
      }

      if (action === 'actions') {
        const body = await request.json().catch(() => ({}));
        const kind = String(body?.kind ?? '');
        const page = await this.open();
        if (kind === 'back' || kind === 'forward') await this.historyMove(kind, page);
        else await act(page, body, this.env);
        const payload = await describe(page);
        await this.record(page);
        return json({ ok: true, message: `Completed ${kind}.`, url: payload.url, screenshot: payload.screenshot });
      }

      if (action === 'screenshot') {
        const page = await this.open();
        const payload = await describe(page);
        await this.touch(page);
        return json({ ok: true, ...payload });
      }

      return json({ error: `Unknown action "${action}".` }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Browser action failed.';

      if (/No active browser session/i.test(message)) {
        return json({ ok: false, error: message, message: 'Start a browser session first.' }, 409);
      }
      if (/\b429\b|rate limit/i.test(message)) {
        const quota = /browser time|daily|limit exceeded for today/i.test(message);
        return json(
          {
            ok: false,
            error: message,
            message: quota
              ? 'The Cloudflare browser allowance for today is used up.'
              : 'Cloudflare is briefly at its new-browser limit. Try again in about 20 seconds.',
          },
          429,
        );
      }
      const gone = /session is (already )?closed|Unable to connect to browser|Target (page|closed)/i.test(message);
      return json(
        { ok: false, error: message, message: gone ? 'Session not found or expired.' : message },
        502,
      );
    }
  }
}

const act = async (page, body, env) => {
  const kind = String(body?.kind ?? '');
  const selector = body?.selector == null ? '' : String(body.selector).slice(0, 400);
  const text = body?.text == null ? '' : String(body.text).slice(0, 2000);

  switch (kind) {
    case 'click': {
      if (!selector) throw new Error('A CSS selector is required.');
      await page.locator(selector).first().click({ timeout: 10_000 });
      await page.waitForTimeout(600);
      break;
    }
    case 'type': {
      if (!selector) throw new Error('A CSS selector is required.');
      await page.locator(selector).first().fill(text, { timeout: 10_000 });
      break;
    }
    case 'scroll': {
      await page.mouse.wheel(0, body?.direction === 'up' ? -700 : 700);
      await page.waitForTimeout(300);
      break;
    }
    default:
      throw new Error(`Unsupported action "${kind}".`);
  }
  return kind;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // Public so health checks and the verify script can reach it.
    if (path === '/healthz') return health(env);

    if (!(await authorised(request, env))) return json({ error: 'Unauthorised.' }, 401);

    // Every session call goes through one Durable Object: it owns the browser
    // connection, so requests are serialised and share a single live tab.
    const stub = env.SESSIONS.get(env.SESSIONS.idFromName('shared-browser'));
    return stub.fetch(request);
  },
};
