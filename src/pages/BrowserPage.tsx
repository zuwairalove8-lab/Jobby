import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  Loader2,
  Lock,
  MousePointerClick,
  Play,
  RefreshCw,
  Send,
  Square,
  Type as TypeIcon,
} from 'lucide-react';
import { Page } from '../components/layout';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  InfoNote,
  SectionHeading,
} from '../components/ui';
import {
  browserAction,
  browserNavigate,
  browserScreenshot,
  createBrowserSession,
  getBrowserSessionStatus,
  stopBrowserSession,
} from '../services/api';
import { useToast } from '../context/ToastProvider';
import type { BrowserSession } from '../types';
import { isBrowserWorkerConfigured } from '../lib/env';
import { timeAgo } from '../lib/format';

interface ActivityEntry {
  id: number;
  label: string;
  at: string;
  status: 'ok' | 'error';
}

export function BrowserPage() {
  const toast = useToast();
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [workerConfigured, setWorkerConfigured] = useState(isBrowserWorkerConfigured);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selector, setSelector] = useState('');
  const [typeText, setTypeText] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const counter = useRef(0);

  const log = useCallback((label: string, status: 'ok' | 'error' = 'ok') => {
    counter.current += 1;
    setActivity((prev) => [
      { id: counter.current, label, at: new Date().toISOString(), status },
      ...prev.slice(0, 19),
    ]);
  }, []);

  const refreshScreenshot = useCallback(async () => {
    try {
      const result = await browserScreenshot();
      if (result.screenshot) setScreenshot(result.screenshot);
      if (result.url) setUrl(result.url);
    } catch {
      /* polling failure is non-fatal; the next tick retries */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getBrowserSessionStatus()
      .then((status) => {
        if (cancelled) return;
        setWorkerConfigured(status.workerConfigured);
        setSession(status.session);
        setStatusMessage(status.message ?? null);
        if (status.session?.current_url) setUrl(status.session.current_url);
        if (status.session) void refreshScreenshot();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not read browser status.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshScreenshot]);

  // Screenshot polling keeps the view close to live without pretending to be a
  // video stream. Stopped while the agent is acting.
  useEffect(() => {
    if (!session || !autoRefresh || busy) return;
    const interval = window.setInterval(() => void refreshScreenshot(), 6000);
    return () => window.clearInterval(interval);
  }, [session, autoRefresh, busy, refreshScreenshot]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await createBrowserSession({ startUrl: url || undefined });
      setSession(result.session);
      if (result.session.current_url) setUrl(result.session.current_url);
      log('Session started');
      toast(result.message ?? 'Browser session started.', 'success');
      await refreshScreenshot();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not start a session.';
      setError(message);
      log('Session start failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const navigate = async (target?: string) => {
    const destination = (target ?? url).trim();
    if (!destination || !session) return;
    setBusy(true);
    setError(null);
    try {
      const result = await browserNavigate(destination);
      setSession(result.session);
      setUrl(result.session.current_url ?? destination);
      if (result.screenshot) setScreenshot(result.screenshot);
      log(`Navigated to ${destination}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Navigation failed.';
      setError(message);
      log(`Navigate failed: ${message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const act = async (
    kind: 'click' | 'type' | 'scroll' | 'back' | 'forward',
    payload?: { selector?: string; text?: string; direction?: 'up' | 'down' },
  ) => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const result = await browserAction({ kind, ...payload });
      if (result.screenshot) setScreenshot(result.screenshot);
      if (result.url) setUrl(result.url);
      log(
        kind === 'click'
          ? `Clicked ${payload?.selector}`
          : kind === 'type'
            ? `Typed into ${payload?.selector}`
            : kind === 'scroll'
              ? `Scrolled ${payload?.direction ?? 'down'}`
              : `${kind === 'back' ? 'Went back' : 'Went forward'}`,
        result.ok ? 'ok' : 'error',
      );
      if (!result.ok) setError(result.message);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Browser action failed.';
      setError(message);
      log(`${kind} failed`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await stopBrowserSession();
      setSession(null);
      setScreenshot(null);
      log('Session stopped');
      toast('Browser session stopped.', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not stop the session.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Page title="Shared Browser">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={15} className="animate-spin text-cyan" /> Checking the browser worker…
        </div>
      </Page>
    );
  }

  if (!workerConfigured) {
    return (
      <Page title="Shared Browser" description="One remote browser session, shared by you and the agent.">
        <EmptyState
          icon={<Globe size={22} />}
          title="No browser worker is configured"
          description="JOBBY controls a remote Playwright browser through a separate long-running service — it cannot run inside an Edge Function. The worker is included in this repository under browser-worker/. Deploy it, then set VITE_BROWSER_WORKER_URL."
          action={
            <div className="mt-1 w-full max-w-lg space-y-2 text-left">
              <InfoNote>
                <span className="text-ink">Local test:</span> run{' '}
                <code className="text-cyan">cd browser-worker &amp;&amp; npm install &amp;&amp; npm start</code>{' '}
                then set{' '}
                <code className="text-cyan">VITE_BROWSER_WORKER_URL=http://localhost:8787</code>.
                Deployed, it must be an HTTPS URL with a bearer token.
              </InfoNote>
              {statusMessage && <InfoNote>{statusMessage}</InfoNote>}
              <p className="text-[11px] leading-relaxed text-muted">
                This screen will never pretend a session is running: with no worker, there is no
                browser.
              </p>
            </div>
          }
        />
      </Page>
    );
  }

  return (
    <Page
      title="Shared Browser"
      description="The agent and you operate the same remote Playwright session. Screenshots refresh automatically."
      actions={
        session ? (
          <>
            <Badge tone="good">{session.status}</Badge>
            <Button size="sm" variant="danger" onClick={() => void stop()} loading={busy}>
              <Square size={13} /> Stop
            </Button>
          </>
        ) : (
          <Button variant="primary" size="sm" onClick={() => void start()} loading={busy}>
            <Play size={13} /> Start session
          </Button>
        )
      }
    >
      {statusMessage && (
        <div className="mb-4">
          <InfoNote>{statusMessage}</InfoNote>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {!session ? (
        <Card className="p-5">
          <SectionHeading
            title="Start a session"
            subtitle="Optional: give the browser a starting URL."
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com"
              className="flex-1"
            />
            <Button variant="primary" onClick={() => void start()} loading={busy}>
              Start browser
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <div className="min-w-0">
            {/* URL bar */}
            <div className="mb-2 flex items-center gap-1.5 rounded-xl border border-line bg-surface/80 p-1.5">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void act('back')}
                aria-label="Back"
                disabled={busy}
              >
                <ArrowLeft size={14} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void act('forward')}
                aria-label="Forward"
                disabled={busy}
              >
                <ArrowRight size={14} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void navigate()}
                aria-label="Reload"
                disabled={busy}
              >
                <RefreshCw size={13} />
              </Button>
              <form
                className="flex min-w-0 flex-1 items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void navigate();
                }}
              >
                <div className="relative min-w-0 flex-1">
                  <Lock
                    size={11}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-good/70"
                  />
                  <input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    className="w-full rounded-lg border border-transparent bg-bg/60 py-1.5 pl-6 pr-2 text-xs text-ink focus:border-cyan/40 focus:outline-none"
                    placeholder="https://…"
                    aria-label="Browser address"
                  />
                </div>
                <Button size="icon" variant="secondary" type="submit" aria-label="Go" disabled={busy}>
                  <Send size={13} />
                </Button>
              </form>
            </div>

            {/* Viewport */}
            <div className="relative overflow-hidden rounded-xl border border-line bg-black/60">
              {screenshot ? (
                <img
                  src={screenshot}
                  alt="Remote browser viewport"
                  className="max-h-[62vh] w-full object-contain"
                />
              ) : (
                <div className="grid h-72 place-items-center text-xs text-muted">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 size={18} className="animate-spin text-cyan" />
                    Capturing the first frame…
                  </div>
                </div>
              )}
              {busy && (
                <div className="absolute right-2 top-2 rounded-full border border-cyan/40 bg-bg/90 px-2 py-1 text-[10px] text-cyan">
                  agent acting…
                </div>
              )}
            </div>

            <div className="mt-2 flex items-center justify-between px-1 text-[10px] text-muted">
              <span>Session {session.remote_session_id?.slice(0, 8) ?? '—'} · screenshot view</span>
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(event) => setAutoRefresh(event.target.checked)}
                  className="h-3 w-3 accent-[#00d4ff]"
                />
                auto-refresh 6s
              </label>
            </div>
          </div>

          {/* Controls */}
          <div className="space-y-3">
            <Card className="p-3.5">
              <SectionHeading title="Direct control" />
              <div className="space-y-2.5">
                <Field label="CSS selector">
                  <Input
                    value={selector}
                    onChange={(event) => setSelector(event.target.value)}
                    placeholder="#apply-button"
                  />
                </Field>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="flex-1"
                    disabled={!selector.trim() || busy}
                    onClick={() => void act('click', { selector: selector.trim() })}
                  >
                    <MousePointerClick size={12} /> Click
                  </Button>
                </div>
                <Field label="Text to type">
                  <Input
                    value={typeText}
                    onChange={(event) => setTypeText(event.target.value)}
                    placeholder="Full name"
                  />
                </Field>
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  disabled={!selector.trim() || !typeText || busy}
                  onClick={() =>
                    void act('type', { selector: selector.trim(), text: typeText })
                  }
                >
                  <TypeIcon size={12} /> Type into element
                </Button>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1"
                    onClick={() => void act('scroll', { direction: 'up' })}
                    disabled={busy}
                  >
                    Scroll up
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1"
                    onClick={() => void act('scroll', { direction: 'down' })}
                    disabled={busy}
                  >
                    Scroll down
                  </Button>
                </div>
              </div>
            </Card>

            <Card className="p-3.5">
              <SectionHeading title="Activity" />
              {activity.length === 0 ? (
                <p className="text-[11px] text-muted">No actions yet in this session.</p>
              ) : (
                <ul className="space-y-1.5">
                  {activity.map((entry) => (
                    <li key={entry.id} className="flex items-start gap-2 text-[11px]">
                      <span
                        className={
                          entry.status === 'ok'
                            ? 'mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-good'
                            : 'mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-bad'
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ink/85">{entry.label}</span>
                        <span className="text-[10px] text-muted/60">{timeAgo(entry.at)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <InfoNote>
              Agent browser actions run through the permission layer. Navigation, clicks and typing
              default to “ask”, so nothing happens in a live application form without your approval.
            </InfoNote>
          </div>
        </div>
      )}
    </Page>
  );
}
