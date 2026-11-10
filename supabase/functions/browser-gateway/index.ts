// browser-gateway: proxies the shared Playwright worker and records session state.
// With no worker configured it reports that honestly instead of faking a browser.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const WORKER_URL = (Deno.env.get('BROWSER_WORKER_URL') ?? '').replace(/\/+$/, '');
const WORKER_TOKEN = Deno.env.get('BROWSER_WORKER_TOKEN') ?? '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'Missing bearer token.' }, 401);
  const { data: userData, error: userError } = await admin.auth.getUser(auth.slice(7));
  if (userError || !userData.user) return json({ error: 'Not signed in.' }, 401);
  const userId = userData.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const action = String(body.action ?? '');

  try {
    if (action === 'status' || action === 'session') {
      const session = await activeSession(userId);
      if (!WORKER_URL) {
        return json({
          session: session
            ? { ...session, status: 'error' }
            : null,
          workerConfigured: false,
          message:
            'No browser worker is configured. Deploy browser-worker/ and set BROWSER_WORKER_URL and BROWSER_WORKER_TOKEN as edge-function secrets.',
        });
      }
      return json({ session, workerConfigured: true });
    }

    if (!WORKER_URL) {
      return json(
        {
          error:
            'Browser worker not configured. Set BROWSER_WORKER_URL and BROWSER_WORKER_TOKEN to enable the shared browser.',
        },
        503,
      );
    }

    if (action === 'create') {
      const startUrl = typeof body.startUrl === 'string' ? body.startUrl : undefined;
      if (startUrl && !/^https:\/\//i.test(startUrl)) {
        return json({ error: 'The starting URL must use https://.' }, 400);
      }
      const existing = await activeSession(userId);
      const openRemote = () => callWorker('/sessions', { url: startUrl ?? 'https://example.com' });

      // Let the worker replace what is open: a worker that reuses its browser can
      // keep the warm tab, and one that cannot reports capacity below.
      let remote: WorkerResponse;
      try {
        remote = await openRemote();
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (!existing?.remote_session_id || !/capacity/i.test(message)) throw error;
        await closeRemote(existing.remote_session_id).catch(() => undefined);
        remote = await openRemote();
      }

      if (existing) {
        await admin
          .from('browser_sessions')
          .update({ status: 'stopped' })
          .eq('id', existing.id);
      }
      const { data: session, error } = await admin
        .from('browser_sessions')
        .insert({
          user_id: userId,
          remote_session_id: remote.sessionId,
          current_url: remote.url ?? startUrl ?? null,
          status: 'active',
          provider: 'playwright',
        })
        .select('*')
        .single();
      if (error) throw new Error(error.message);

      await admin.from('tool_execution_logs').insert({
        user_id: userId,
        tool_name: 'browser_session',
        action: 'create',
        status: 'succeeded',
        detail: { url: remote.url ?? startUrl ?? null },
      });

      return json({
        session,
        message: `Session started on ${remote.url ?? startUrl ?? 'the worker default page'}.`,
      });
    }

    const session = await activeSession(userId);
    if (!session?.remote_session_id) {
      return json({ error: 'Start a browser session first.' }, 409);
    }
    const remoteId = session.remote_session_id;

    if (action === 'navigate') {
      const url = String(body.url ?? '');
      if (!/^https:\/\//i.test(url)) return json({ error: 'Only https:// URLs are allowed.' }, 400);
      const remote = await callWorker(`/sessions/${remoteId}/navigate`, { url });
      const updated = await patchSession(session.id, {
        current_url: remote.url ?? url,
        status: 'active',
      });
      await log(userId, 'browser_navigate', { url });
      return json({ session: updated, screenshot: remote.screenshot ?? null });
    }

    if (action === 'act') {
      const kind = String(body.kind ?? '');
      if (!['click', 'type', 'scroll', 'back', 'forward'].includes(kind)) {
        return json({ error: `Unsupported action "${kind}".` }, 400);
      }
      const payload: Record<string, unknown> = { kind };
      if (body.selector !== undefined) payload.selector = String(body.selector).slice(0, 400);
      if (body.text !== undefined) payload.text = String(body.text).slice(0, 2000);
      if (body.direction !== undefined) payload.direction = String(body.direction);

      const remote = await callWorker(`/sessions/${remoteId}/actions`, payload);
      const updated = await patchSession(session.id, {
        current_url: remote.url ?? session.current_url,
        status: 'active',
      });
      await log(userId, `browser_${kind}`, {
        selector: payload.selector ?? null,
        ok: remote.ok !== false,
      });
      return json({
        ok: remote.ok !== false,
        message: remote.message ?? 'Action completed.',
        screenshot: remote.screenshot ?? null,
        url: updated.current_url ?? undefined,
      });
    }

    if (action === 'screenshot') {
      const remote = await callWorker(`/sessions/${remoteId}/screenshot`, {});
      const updated = await patchSession(session.id, {
        current_url: remote.url ?? session.current_url,
      });
      return json({ screenshot: remote.screenshot ?? null, url: updated.current_url ?? undefined });
    }

    if (action === 'stop') {
      await closeRemote(remoteId).catch(() => undefined);
      await admin
        .from('browser_sessions')
        .update({ status: 'stopped', remote_session_id: null })
        .eq('id', session.id);
      await log(userId, 'browser_session', { action: 'stop' });
      return json({ ok: true });
    }

    return json({ error: `Unknown action "${action}".` }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Browser request failed.';
    return json({ error: message }, 502);
  }
});

async function activeSession(userId: string) {
  const { data } = await admin
    .from('browser_sessions')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['starting', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function patchSession(id: string, patch: Record<string, unknown>) {
  const { data } = await admin
    .from('browser_sessions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  return data;
}

async function log(userId: string, toolName: string, detail: Record<string, unknown>) {
  await admin.from('tool_execution_logs').insert({
    user_id: userId,
    tool_name: toolName,
    action: 'browser',
    status: 'succeeded',
    detail,
  });
}

interface WorkerResponse {
  sessionId?: string;
  url?: string;
  screenshot?: string | null;
  ok?: boolean;
  message?: string;
}

async function callWorker(path: string, body: Record<string, unknown>): Promise<WorkerResponse> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WORKER_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let payload: WorkerResponse & { error?: string } = {};
  try {
    payload = text ? (JSON.parse(text) as WorkerResponse & { error?: string }) : {};
  } catch {
    payload = {};
  }
  if (!res.ok) {
    // The worker sends a user-facing `message` alongside the raw `error`.
    throw new Error(payload.message ?? payload.error ?? `Browser worker responded ${res.status}.`);
  }
  return payload;
}

async function closeRemote(remoteId: string): Promise<void> {
  await fetch(`${WORKER_URL}/sessions/${remoteId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${WORKER_TOKEN}` },
  });
}
