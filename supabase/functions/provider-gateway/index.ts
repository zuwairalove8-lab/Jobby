// provider-gateway: server-side provider status, connection tests and encrypted
// BYOK credential storage. Keys never travel back to the browser.
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

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DEFAULT_ENDPOINTS: Record<string, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  kilo: 'https://api.kilo.ai/api/gateway',
  openai_compatible: '',
};

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
    if (action === 'status') {
      return json({
        serverDefaults: {
          openrouter: Boolean(Deno.env.get('OPENROUTER_API_KEY')),
          composio: Boolean(Deno.env.get('COMPOSIO_API_KEY')),
          browserWorker: Boolean(Deno.env.get('BROWSER_WORKER_URL')),
        },
        vault: true,
      });
    }

    if (action === 'test' || action === 'models') {
      const kind = String(body.kind ?? 'openrouter');
      let endpoint = String(body.endpoint ?? '').trim() || DEFAULT_ENDPOINTS[kind] || '';
      if (!endpoint) return json({ ok: false, message: 'A base URL is required for this provider.' });
      if (!/^https:\/\//i.test(endpoint)) {
        return json({ ok: false, message: 'Base URL must use https://.' });
      }
      endpoint = endpoint.replace(/\/+$/, '');

      let key = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
      const providerId = typeof body.providerId === 'string' ? body.providerId : '';
      if (!key && providerId) key = (await readProviderKey(userId, providerId)) ?? '';
      if (!key && kind === 'openrouter') key = Deno.env.get('OPENROUTER_API_KEY') ?? '';
      if (!key) return json({ ok: false, message: 'No API key available to test this provider.' });

      const started = Date.now();
      const res = await fetch(`${endpoint}/models`, {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      });
      const latencyMs = Date.now() - started;
      const text = await res.text();
      if (!res.ok) {
        return json({
          ok: false,
          latencyMs,
          message: `Provider returned ${res.status}: ${text.slice(0, 300)}`,
        });
      }
      let models: string[] = [];
      try {
        const parsed = JSON.parse(text) as { data?: Array<{ id?: string }> };
        models = (parsed.data ?? [])
          .map((m) => m.id)
          .filter((id): id is string => typeof id === 'string')
          .slice(0, 200);
      } catch {
        return json({ ok: false, latencyMs, message: 'Provider did not return JSON model list.' });
      }
      return json({
        ok: true,
        latencyMs,
        models,
        message: `Reachable in ${latencyMs}ms · ${models.length} models visible.`,
      });
    }

    if (action === 'save-secret') {
      const providerId = String(body.providerId ?? '');
      const apiKey = String(body.apiKey ?? '').trim();
      if (!providerId) return json({ error: 'providerId is required.' }, 400);
      if (apiKey.length < 8) return json({ error: 'That API key looks too short.' }, 400);

      const { data: provider } = await admin
        .from('ai_providers')
        .select('id')
        .eq('id', providerId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!provider) return json({ error: 'Provider not found.' }, 404);

      const { data: existing } = await admin
        .from('provider_secrets')
        .select('secret_id')
        .eq('provider_id', providerId)
        .maybeSingle();

      let secretId: string;
      if (existing?.secret_id) {
        const { data, error } = await admin.rpc('jobby_update_secret', {
          p_id: existing.secret_id,
          p_secret: apiKey,
        });
        if (error) throw new Error(error.message);
        secretId = String(data);
      } else {
        const { data, error } = await admin.rpc('jobby_store_secret', {
          p_secret: apiKey,
          p_name: `provider-${providerId}`,
        });
        if (error) throw new Error(error.message);
        secretId = String(data);
        const { error: insertError } = await admin
          .from('provider_secrets')
          .insert({ provider_id: providerId, secret_id: secretId });
        if (insertError) throw new Error(insertError.message);
      }

      await admin.from('ai_providers').update({ has_credential: true }).eq('id', providerId);
      await admin.from('tool_execution_logs').insert({
        user_id: userId,
        tool_name: 'provider_credentials',
        action: 'save',
        status: 'succeeded',
        detail: { providerId },
      });
      return json({ ok: true, hasCredential: true, secretRef: secretId.slice(0, 8) });
    }

    if (action === 'delete-secret') {
      const providerId = String(body.providerId ?? '');
      const { data: existing } = await admin
        .from('provider_secrets')
        .select('secret_id')
        .eq('provider_id', providerId)
        .maybeSingle();
      const { data: owned } = await admin
        .from('ai_providers')
        .select('id')
        .eq('id', providerId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!owned) return json({ error: 'Provider not found.' }, 404);
      if (existing?.secret_id) {
        await admin.rpc('jobby_delete_secret', { p_id: existing.secret_id });
        await admin.from('provider_secrets').delete().eq('provider_id', providerId);
      }
      await admin.from('ai_providers').update({ has_credential: false }).eq('id', providerId);
      return json({ ok: true });
    }

    return json({ error: `Unknown action "${action}".` }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Provider request failed.' }, 500);
  }
});

async function readProviderKey(userId: string, providerId: string): Promise<string | null> {
  const { data: provider } = await admin
    .from('ai_providers')
    .select('id')
    .eq('id', providerId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!provider) return null;
  const { data: secret } = await admin
    .from('provider_secrets')
    .select('secret_id')
    .eq('provider_id', providerId)
    .maybeSingle();
  if (!secret?.secret_id) return null;
  const { data, error } = await admin.rpc('jobby_read_secret', { p_id: secret.secret_id });
  if (error) return null;
  return typeof data === 'string' ? data : null;
}
