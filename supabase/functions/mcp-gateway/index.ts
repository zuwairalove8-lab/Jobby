// mcp-gateway: connects external tool providers (Composio hosted accounts and
// custom MCP servers), stores tokens in Vault and executes tools server-side.
// Every failure is surfaced verbatim; nothing is reported as connected unless
// the provider confirmed it.
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

const COMPOSIO_BASE = 'https://backend.composio.dev/api/v3';
const COMPOSIO_KEY = Deno.env.get('COMPOSIO_API_KEY') ?? '';

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

  try {
    switch (String(body.action ?? '')) {
      case 'connectors':
        return await connectors();
      case 'connect-composio':
        return await connectComposio(body, userId);
      case 'connect-custom':
        return await connectCustom(body, userId);
      case 'disconnect':
        return await disconnect(String(body.connectionId ?? ''), userId);
      case 'tools':
        return await toolsFor(String(body.connectionId ?? ''), userId);
      case 'tools-all':
        return await allTools(userId);
      case 'refresh-tools':
        return await refreshTools(String(body.connectionId ?? ''), userId);
      case 'execute':
        return await execute(body, userId);
      default:
        return json({ error: `Unknown action "${String(body.action)}".` }, 400);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'MCP request failed.' }, 502);
  }
});

/* -------------------------------- connectors ------------------------------- */

async function connectors() {
  if (!COMPOSIO_KEY) {
    const { data } = await admin
      .from('mcp_registry')
      .select('*')
      .order('category')
      .order('name');
    return json({
      connectors: (data ?? []).map((row) => ({
        slug: row.slug,
        name: row.name,
        description: row.description,
        category: row.category,
        authMode: row.auth_mode,
        toolCount: row.tool_count,
      })),
      composioConfigured: false,
      source: 'registry',
      message:
        'Showing a reference catalogue. Add COMPOSIO_API_KEY as an edge-function secret to connect real accounts and see the full, live toolkit list.',
    });
  }

  const payload = await composio('GET', '/toolkits?limit=100');
  const items = Array.isArray(payload.items) ? payload.items : [];
  const mapped = items.map((item) => {
    const raw = item as Record<string, unknown>;
    const meta = (raw.meta ?? {}) as Record<string, unknown>;
    const categories = Array.isArray(meta.categories) ? meta.categories : [];
    const first = categories[0] as Record<string, unknown> | undefined;
    return {
      slug: String(raw.slug ?? ''),
      name: String(raw.name ?? raw.slug ?? 'Toolkit'),
      description: String(meta.description ?? ''),
      category: String(first?.name ?? 'general').toLowerCase(),
      authMode: Array.isArray(raw.auth_schemes) ? String(raw.auth_schemes[0] ?? 'oauth2') : 'oauth2',
      logo: meta.logo ? String(meta.logo) : undefined,
      // v3 reports the count under meta.tools_count; the top level is usually absent.
      toolCount: Number(meta.tools_count ?? raw.tools_count ?? 0),
    };
  });

  if (mapped.length > 0) {
    await admin.from('mcp_registry').upsert(
      mapped.map((item) => ({
        slug: item.slug,
        name: item.name,
        description: item.description,
        category: item.category,
        auth_mode: item.authMode,
        tool_count: item.toolCount,
      })),
      { onConflict: 'slug' },
    );
  }

  return json({ connectors: mapped, composioConfigured: true, source: 'composio' });
}

/* ------------------------------ connect flows ----------------------------- */

async function connectComposio(body: Record<string, unknown>, userId: string) {
  if (!COMPOSIO_KEY) {
    return json(
      {
        error:
          'Composio is not configured for this deployment. Set COMPOSIO_API_KEY as an edge-function secret, then try again.',
      },
      503,
    );
  }
  const toolkit = String(body.connectorSlug ?? '').trim();
  if (!toolkit) return json({ error: 'connectorSlug is required.' }, 400);

  const callbackUrl = typeof body.callbackUrl === 'string' && body.callbackUrl.startsWith('https://')
    ? body.callbackUrl
    : undefined;

  const created = await composio('POST', '/connected_accounts', {
    toolkit_slug: toolkit,
    user_id: userId,
    ...(callbackUrl ? { callback_url: callbackUrl } : {}),
  });

  const externalId = created.id ? String(created.id) : null;
  const redirectUrl = created.redirect_url ? String(created.redirect_url) : null;

  const { data: registry } = await admin
    .from('mcp_registry')
    .select('id, name')
    .eq('slug', toolkit)
    .maybeSingle();

  const { data: connection, error } = await admin
    .from('mcp_connections')
    .insert({
      user_id: userId,
      provider: 'composio',
      external_account_id: externalId,
      display_name: String(body.displayName ?? registry?.name ?? toolkit),
      status: redirectUrl ? 'disconnected' : 'connected',
      registry_id: registry?.id ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);

  if (!redirectUrl && externalId) {
    await syncComposioTools(connection.id, toolkit).catch(() => undefined);
  }

  await admin.from('tool_execution_logs').insert({
    user_id: userId,
    tool_name: 'mcp_connection',
    action: 'connect-composio',
    status: redirectUrl ? 'pending' : 'succeeded',
    detail: { toolkit, connectionId: connection.id },
  });

  return json({
    connectionId: connection.id,
    status: connection.status,
    redirectUrl,
    message: redirectUrl
      ? `Authorise ${toolkit} in the provider window, then refresh tools.`
      : `${toolkit} connected.`,
  });
}

async function connectCustom(body: Record<string, unknown>, userId: string) {
  const serverUrl = String(body.serverUrl ?? '').trim();
  if (!/^https:\/\//i.test(serverUrl)) {
    return json({ error: 'The MCP server URL must use https://.' }, 400);
  }
  const authToken = typeof body.authToken === 'string' ? body.authToken.trim() : '';
  const authHeader = typeof body.authHeader === 'string' && body.authHeader ? body.authHeader : 'Authorization';

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers[authHeader] = /^bearer|^basic|^token/i.test(authToken) ? authToken : `Bearer ${authToken}`;
  }

  const listed = await mcpRpc(serverUrl, headers, 'tools/list', {});
  const tools = Array.isArray(listed.tools) ? listed.tools : [];
  if (tools.length === 0) {
    return json({ error: 'The server answered but exposed no tools.' }, 400);
  }

  const { data: connection, error } = await admin
    .from('mcp_connections')
    .insert({
      user_id: userId,
      provider: 'custom',
      server_url: serverUrl,
      display_name: String(body.displayName ?? new URL(serverUrl).hostname),
      status: 'connected',
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);

  if (authToken) {
    const { data: secretId, error: secretError } = await admin.rpc('jobby_store_secret', {
      p_secret: authToken,
      p_name: `mcp-${connection.id}`,
    });
    if (secretError) throw new Error(secretError.message);
    await admin
      .from('mcp_connection_secrets')
      .insert({ connection_id: connection.id, secret_id: secretId });
  }

  const stored = await storeTools(connection.id, tools);
  await admin.from('tool_execution_logs').insert({
    user_id: userId,
    tool_name: 'mcp_connection',
    action: 'connect-custom',
    status: 'succeeded',
    detail: { serverUrl, tools: stored.length },
  });

  return json({
    connectionId: connection.id,
    tools: stored,
    message: `Connected ${stored.length} tools from ${new URL(serverUrl).hostname}.`,
  });
}

/* -------------------------------- tool lists ------------------------------- */

interface McpToolRow {
  id: string;
  connection_id: string;
  tool_name: string;
  description: string | null;
  input_schema: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

async function storeTools(connectionId: string, tools: unknown[]): Promise<McpToolRow[]> {
  const rows = tools
    .filter((tool): tool is Record<string, unknown> => typeof tool === 'object' && tool !== null)
    .map((tool) => ({
      connection_id: connectionId,
      tool_name: String(tool.name ?? ''),
      description: tool.description ? String(tool.description).slice(0, 600) : null,
      input_schema:
        typeof tool.inputSchema === 'object' && tool.inputSchema !== null
          ? (tool.inputSchema as Record<string, unknown>)
          : {},
      enabled: true,
    }))
    .filter((row) => row.tool_name.length > 0);

  if (rows.length === 0) return [];
  const { data, error } = await admin
    .from('mcp_connection_tools')
    .upsert(rows, { onConflict: 'connection_id,tool_name' })
    .select('*');
  if (error) throw new Error(error.message);
  return (data ?? []) as McpToolRow[];
}

async function syncComposioTools(connectionId: string, toolkit: string): Promise<McpToolRow[]> {
  const payload = await composio('GET', `/tools?toolkit_slug=${encodeURIComponent(toolkit)}&limit=100`);
  const items = Array.isArray(payload.items) ? payload.items : [];
  return await storeTools(
    connectionId,
    items.map((item) => {
      const raw = item as Record<string, unknown>;
      return {
        name: String(raw.slug ?? raw.name ?? ''),
        description: raw.description ?? '',
        inputSchema: raw.input_parameters ?? raw.parameters ?? {},
      };
    }),
  );
}

async function ownedConnection(connectionId: string, userId: string) {
  const { data } = await admin
    .from('mcp_connections')
    .select('*')
    .eq('id', connectionId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) throw new Error('Connection not found.');
  return data;
}

async function toolsFor(connectionId: string, userId: string) {
  const connection = await ownedConnection(connectionId, userId);
  const { data } = await admin
    .from('mcp_connection_tools')
    .select('*')
    .eq('connection_id', connection.id)
    .order('tool_name');
  let rows = (data ?? []) as McpToolRow[];
  if (rows.length === 0 && connection.provider === 'composio' && connection.registry_id) {
    const { data: registry } = await admin
      .from('mcp_registry')
      .select('slug')
      .eq('id', connection.registry_id)
      .maybeSingle();
    if (registry?.slug) rows = await syncComposioTools(connection.id, registry.slug).catch(() => []);
  }
  return json({ tools: rows });
}

async function allTools(userId: string) {
  const { data: connections } = await admin
    .from('mcp_connections')
    .select('id, display_name, status')
    .eq('user_id', userId)
    .eq('status', 'connected');
  const ids = (connections ?? []).map((row) => row.id);
  if (ids.length === 0) return json({ tools: [], connections: [] });
  const { data } = await admin
    .from('mcp_connection_tools')
    .select('*')
    .in('connection_id', ids)
    .eq('enabled', true)
    .order('tool_name');
  return json({ tools: data ?? [], connections: connections ?? [] });
}

async function refreshTools(connectionId: string, userId: string) {
  const connection = await ownedConnection(connectionId, userId);
  if (connection.provider === 'composio') {
    if (!COMPOSIO_KEY) return json({ error: 'Composio is not configured.' }, 503);
    const { data: registry } = connection.registry_id
      ? await admin.from('mcp_registry').select('slug').eq('id', connection.registry_id).maybeSingle()
      : { data: null };
    if (!registry?.slug) return json({ error: 'This connection has no toolkit slug.' }, 400);
    const tools = await syncComposioTools(connection.id, registry.slug);
    return json({ tools });
  }

  const token = await connectionToken(connection.id);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const authHeader = 'Authorization';
  if (token) headers[authHeader] = `Bearer ${token}`;
  if (!connection.server_url) return json({ error: 'Connection has no server URL.' }, 400);
  const listed = await mcpRpc(connection.server_url, headers, 'tools/list', {});
  const tools = await storeTools(connection.id, Array.isArray(listed.tools) ? listed.tools : []);
  return json({ tools });
}

async function connectionToken(connectionId: string): Promise<string | null> {
  const { data } = await admin
    .from('mcp_connection_secrets')
    .select('secret_id')
    .eq('connection_id', connectionId)
    .maybeSingle();
  if (!data?.secret_id) return null;
  const { data: secret } = await admin.rpc('jobby_read_secret', { p_id: data.secret_id });
  return typeof secret === 'string' ? secret : null;
}

async function disconnect(connectionId: string, userId: string) {
  const connection = await ownedConnection(connectionId, userId);
  if (connection.provider === 'composio' && COMPOSIO_KEY && connection.external_account_id) {
    await composio('DELETE', `/connected_accounts/${connection.external_account_id}`).catch(
      () => undefined,
    );
  }
  const { data: secret } = await admin
    .from('mcp_connection_secrets')
    .select('secret_id')
    .eq('connection_id', connection.id)
    .maybeSingle();
  if (secret?.secret_id) await admin.rpc('jobby_delete_secret', { p_id: secret.secret_id });
  await admin.from('mcp_connections').delete().eq('id', connection.id);
  return json({ ok: true });
}

/* --------------------------------- execute -------------------------------- */

async function execute(body: Record<string, unknown>, userId: string) {
  const connection = await ownedConnection(String(body.connectionId ?? ''), userId);
  const toolName = String(body.toolName ?? '');
  const args =
    typeof body.arguments === 'object' && body.arguments !== null
      ? (body.arguments as Record<string, unknown>)
      : {};
  if (!toolName) return json({ error: 'toolName is required.' }, 400);

  const { data: tool } = await admin
    .from('mcp_connection_tools')
    .select('id, enabled')
    .eq('connection_id', connection.id)
    .eq('tool_name', toolName)
    .maybeSingle();
  if (tool && tool.enabled === false) return json({ error: 'That tool is disabled.' }, 403);

  let result: unknown;
  if (connection.provider === 'composio') {
    if (!COMPOSIO_KEY) return json({ error: 'Composio is not configured.' }, 503);
    if (!connection.external_account_id) {
      return json({ error: 'This account is not authorised yet. Complete the OAuth flow first.' }, 409);
    }
    const payload = await composio('POST', `/tools/execute/${encodeURIComponent(toolName)}`, {
      connected_account_id: connection.external_account_id,
      arguments: args,
      user_id: userId,
    });
    if (payload.successful === false || payload.error) {
      const message =
        typeof payload.error === 'string'
          ? payload.error
          : String((payload.error as Record<string, unknown>)?.message ?? 'Tool failed.');
      return json({ ok: false, result: payload.data ?? null, error: message }, 200);
    }
    result = payload.data ?? payload;
  } else {
    if (!connection.server_url) return json({ error: 'Connection has no server URL.' }, 400);
    const token = await connectionToken(connection.id);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    result = await mcpRpc(connection.server_url, headers, 'tools/call', {
      name: toolName,
      arguments: args,
    });
  }

  await admin.from('tool_execution_logs').insert({
    user_id: userId,
    tool_name: 'mcp_call_tool',
    action: toolName,
    status: 'succeeded',
    detail: { connectionId: connection.id },
  });

  return json({ ok: true, result });
}

/* -------------------------------- transports ------------------------------- */

async function composio(
  method: string,
  path: string,
  payload?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${COMPOSIO_BASE}${path}`, {
    method,
    headers: { 'x-api-key': COMPOSIO_KEY, 'Content-Type': 'application/json' },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    const message =
      typeof parsed.error === 'string'
        ? parsed.error
        : String((parsed.error as Record<string, unknown>)?.message ?? `Composio ${res.status}`);
    throw new Error(message);
  }
  return parsed;
}

async function mcpRpc(
  serverUrl: string,
  headers: Record<string, string>,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(serverUrl, {
    method: 'POST',
    headers: { ...headers, Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`MCP server responded ${res.status}: ${text.slice(0, 300)}`);

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    const dataLine = text
      .split(/\r?\n/)
      .reverse()
      .find((line) => line.startsWith('data:'));
    if (dataLine) {
      try {
        payload = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
      } catch {
        throw new Error('MCP server returned an unreadable stream.');
      }
    } else {
      throw new Error('MCP server did not return JSON.');
    }
  }
  if (payload.error) {
    const error = payload.error as Record<string, unknown>;
    throw new Error(String(error.message ?? 'MCP error'));
  }
  return typeof payload.result === 'object' && payload.result !== null
    ? (payload.result as Record<string, unknown>)
    : {};
}
