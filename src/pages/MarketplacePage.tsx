import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Blocks,
  Cable,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Play,
  Plug,
  RefreshCw,
  ShieldCheck,
  Unplug,
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
  Modal,
  SectionHeading,
  Skeleton,
  Switch,
  Tabs,
  Textarea,
} from '../components/ui';
import {
  connectComposio,
  connectCustomServer,
  disconnectMcp,
  executeMcpTool,
  listConnectors,
  listConnectionTools,
  refreshMcpTools,
  type Connector,
} from '../services/api';
import { listMcpConnections, listMcpTools, setMcpToolEnabled } from '../services/db';
import { useAuth } from '../context/AuthProvider';
import { useToast } from '../context/ToastProvider';
import type { McpConnection, McpTool } from '../types';
import { cn } from '../lib/cn';
import { timeAgo } from '../lib/format';

type Tab = 'discover' | 'connected' | 'custom';

const CATEGORY_ORDER = ['email', 'documents', 'calendar', 'communication', 'development', 'job search', 'browser', 'custom'];

export function MarketplacePage() {
  const { user } = useAuth();
  const toast = useToast();
  const userId = user?.id ?? '';

  const [tab, setTab] = useState<Tab>('discover');
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [composioConfigured, setComposioConfigured] = useState<boolean | null>(null);
  const [connectorMessage, setConnectorMessage] = useState<string | null>(null);
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [custom, setCustom] = useState({
    serverUrl: '',
    displayName: '',
    authHeader: 'Authorization',
    authToken: '',
  });

  const [runTarget, setRunTarget] = useState<{ connection: McpConnection; tool: McpTool } | null>(null);
  const [runArgs, setRunArgs] = useState('{}');
  const [runResult, setRunResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const loadConnections = useCallback(async () => {
    const rows = await listMcpConnections(userId);
    setConnections(rows);
    const allTools = await listMcpTools(rows.map((r) => r.id));
    setTools(allTools);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listConnectors().catch((err: unknown) => ({
        connectors: [] as Connector[],
        composioConfigured: false,
        message: err instanceof Error ? err.message : 'Could not load connectors.',
      })),
      loadConnections().catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not load connections.');
        return undefined;
      }),
    ])
      .then(([connectorResult]) => {
        if (cancelled) return;
        setConnectors(connectorResult.connectors);
        setComposioConfigured(connectorResult.composioConfigured);
        setConnectorMessage(connectorResult.message ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, loadConnections]);

  const toolsByConnection = useMemo(() => {
    const map = new Map<string, McpTool[]>();
    for (const tool of tools) {
      const list = map.get(tool.connection_id) ?? [];
      list.push(tool);
      map.set(tool.connection_id, list);
    }
    return map;
  }, [tools]);

  const filteredConnectors = useMemo(() => {
    const q = search.trim().toLowerCase();
    return connectors
      .filter((connector) => (category === 'all' ? true : connector.category === category))
      .filter(
        (connector) =>
          !q ||
          connector.name.toLowerCase().includes(q) ||
          connector.description.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const ai = CATEGORY_ORDER.indexOf(a.category);
        const bi = CATEGORY_ORDER.indexOf(b.category);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
  }, [connectors, category, search]);

  const categories = useMemo(() => {
    const set = new Set(connectors.map((c) => c.category));
    return ['all', ...CATEGORY_ORDER.filter((c) => set.has(c))];
  }, [connectors]);

  const connect = async (connector: Connector) => {
    setBusy(connector.slug);
    setError(null);
    try {
      const result = await connectComposio({
        connectorSlug: connector.slug,
        displayName: connector.name,
        callbackUrl: `${window.location.origin}/marketplace`,
      });
      if (result.redirectUrl) {
        window.open(result.redirectUrl, '_blank', 'noopener');
        toast('Complete the sign-in in the new tab, then press Refresh.', 'info');
      } else {
        toast(result.message, 'success');
      }
      await loadConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start that connection.');
    } finally {
      setBusy(null);
    }
  };

  const connectCustom = async () => {
    setBusy('custom');
    setError(null);
    setRunResult(null);
    try {
      const result = await connectCustomServer({
        serverUrl: custom.serverUrl,
        displayName: custom.displayName || new URL(custom.serverUrl).hostname,
        authHeader: custom.authHeader || undefined,
        authToken: custom.authToken || undefined,
      });
      toast(`${result.message} (${result.tools.length} tools discovered)`, 'success');
      setCustom({ serverUrl: '', displayName: '', authHeader: 'Authorization', authToken: '' });
      await loadConnections();
      setTab('connected');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach that MCP server.');
    } finally {
      setBusy(null);
    }
  };

  const refresh = async (connection: McpConnection) => {
    setBusy(connection.id);
    try {
      await refreshMcpTools(connection.id);
      await loadConnections();
      toast('Tool list refreshed.', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Refresh failed.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (connection: McpConnection) => {
    setBusy(connection.id);
    try {
      await disconnectMcp(connection.id);
      await loadConnections();
      toast('Account disconnected.', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Disconnect failed.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const toggleTool = async (tool: McpTool, enabled: boolean) => {
    setTools((prev) => prev.map((item) => (item.id === tool.id ? { ...item, enabled } : item)));
    try {
      await setMcpToolEnabled(tool.id, enabled);
    } catch (err) {
      setTools((prev) => prev.map((item) => (item.id === tool.id ? { ...item, enabled: !enabled } : item)));
      toast(err instanceof Error ? err.message : 'Could not update the tool.', 'error');
    }
  };

  const openRun = async (connection: McpConnection, tool: McpTool) => {
    setRunTarget({ connection, tool });
    setRunResult(null);
    setRunArgs('{}');
    if (toolsByConnection.get(connection.id)?.length === 0) {
      try {
        const result = await listConnectionTools(connection.id);
        setTools((prev) => [
          ...prev.filter((t) => t.connection_id !== connection.id),
          ...result.tools,
        ]);
      } catch {
        /* tool list may be stale; the run will surface the real error */
      }
    }
  };

  const runTool = async () => {
    if (!runTarget) return;
    setRunning(true);
    setRunResult(null);
    try {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(runArgs || '{}') as Record<string, unknown>;
      } catch {
        throw new Error('Arguments must be valid JSON.');
      }
      const result = await executeMcpTool({
        connectionId: runTarget.connection.id,
        toolName: runTarget.tool.tool_name,
        arguments: parsed,
      });
      setRunResult(JSON.stringify(result, null, 2));
      if (!result.ok) toast(result.error ?? 'The tool returned an error.', 'error');
    } catch (err) {
      setRunResult(err instanceof Error ? err.message : 'Tool execution failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Page
      title="MCP Marketplace"
      description="Connect accounts the agent may use. Tools are discovered live, and every call is permission-checked server-side."
      actions={
        <Badge tone={composioConfigured ? 'good' : 'warn'}>
          {composioConfigured ? 'Composio linked' : 'Composio key missing'}
        </Badge>
      }
    >
      <div className="mb-4">
        <Tabs
          active={tab}
          onChange={(id) => setTab(id as Tab)}
          items={[
            { id: 'discover', label: 'Discover', badge: connectors.length || undefined },
            { id: 'connected', label: 'Connected', badge: connections.length || undefined },
            { id: 'custom', label: 'Custom MCP server' },
          ]}
        />
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {tab === 'discover' && (
        <>
          {composioConfigured === false && (
            <div className="mb-4">
              <InfoNote>
                Composio is not configured, so managed connectors cannot be listed or connected. Set{' '}
                <code className="text-cyan">COMPOSIO_API_KEY</code> as a Supabase Edge Function
                secret (integration dashboard → settings), then reload. Custom remote MCP servers
                work without Composio.
              </InfoNote>
            </div>
          )}
          {connectorMessage && composioConfigured === false && (
            <div className="mb-4 text-[11px] text-muted">Provider said: {connectorMessage}</div>
          )}

          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search connectors (Gmail, Drive, Slack…)"
              className="flex-1"
            />
            <Button
              variant="secondary"
              onClick={() => void loadConnections()}
              aria-label="Refresh connections"
            >
              <RefreshCw size={14} /> Refresh
            </Button>
          </div>

          <div className="mb-3 flex flex-wrap gap-1.5">
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCategory(item)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px] capitalize transition',
                  category === item
                    ? 'border-cyan/50 bg-cyan/10 text-cyan'
                    : 'border-line text-muted hover:text-ink',
                )}
              >
                {item}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-36" />
              ))}
            </div>
          ) : filteredConnectors.length === 0 ? (
            <EmptyState
              icon={<Blocks size={22} />}
              title={connectors.length === 0 ? 'No connectors available' : 'Nothing matches that filter'}
              description={
                connectors.length === 0
                  ? 'Managed connectors come from Composio once its key is configured. You can always add a custom remote MCP server.'
                  : 'Clear the search or choose All categories.'
              }
              action={
                <Button size="sm" variant="secondary" onClick={() => setTab('custom')}>
                  Add a custom server
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredConnectors.map((connector) => {
                const isConnected = connections.some(
                  (c) => c.display_name === connector.name && c.status === 'connected',
                );
                return (
                  <Card key={connector.slug} className="flex flex-col p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{connector.name}</p>
                        <p className="text-[10px] uppercase tracking-wider text-muted">
                          {connector.category} · {connector.authMode.replace(/_/g, ' ')}
                        </p>
                      </div>
                      {isConnected && <Badge tone="good">connected</Badge>}
                    </div>
                    <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-muted">
                      {connector.description || 'No description provided by the provider.'}
                    </p>
                    <div className="mt-auto pt-3">
                      <Button
                        size="sm"
                        variant={isConnected ? 'ghost' : 'secondary'}
                        className="w-full"
                        disabled={!composioConfigured}
                        loading={busy === connector.slug}
                        onClick={() => void connect(connector)}
                      >
                        {isConnected ? 'Reconnect' : 'Connect'} <ArrowRight size={12} />
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'connected' && (
        <>
          {connections.length === 0 ? (
            <EmptyState
              icon={<Plug size={22} />}
              title="No connected accounts"
              description="Connect a managed connector or your own MCP server. Tools appear here with individual enable switches."
              action={
                <Button size="sm" variant="secondary" onClick={() => setTab('discover')}>
                  Browse connectors
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {connections.map((connection) => {
                const connectionTools = toolsByConnection.get(connection.id) ?? [];
                const isOpen = expanded === connection.id;
                return (
                  <Card key={connection.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold">{connection.display_name}</p>
                          <Badge tone={connection.status === 'connected' ? 'good' : 'warn'}>
                            {connection.status}
                          </Badge>
                          <Badge tone="neutral">{connection.provider}</Badge>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-muted">
                          {connection.server_url ?? connection.external_account_id ?? 'Managed account'}{' '}
                          · {connectionTools.length} tools · added {timeAgo(connection.created_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setExpanded(isOpen ? null : connection.id)}
                        >
                          {isOpen ? 'Hide tools' : 'Tools'}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Refresh tools"
                          loading={busy === connection.id}
                          onClick={() => void refresh(connection)}
                        >
                          <RefreshCw size={13} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Disconnect"
                          onClick={() => void disconnect(connection)}
                        >
                          <Unplug size={13} />
                        </Button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="mt-3 space-y-1.5 border-t border-line/60 pt-3">
                        {connectionTools.length === 0 ? (
                          <p className="text-[11px] text-muted">
                            No tools discovered yet. Press refresh to query the server.
                          </p>
                        ) : (
                          connectionTools.map((tool) => (
                            <div
                              key={tool.id}
                              className="flex items-start gap-2 rounded-lg border border-line/60 bg-bg/30 px-2.5 py-2"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[11px] font-medium text-ink">
                                  {tool.tool_name}
                                </p>
                                <p className="line-clamp-2 text-[10px] leading-snug text-muted">
                                  {tool.description ?? 'No description.'}
                                </p>
                              </div>
                              <Switch
                                checked={tool.enabled}
                                onChange={(next) => void toggleTool(tool, next)}
                                label={`Enable ${tool.tool_name}`}
                              />
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={`Run ${tool.tool_name}`}
                                onClick={() => void openRun(connection, tool)}
                              >
                                <Play size={12} />
                              </Button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
          <div className="mt-4">
            <InfoNote>
              <span className="inline-flex items-center gap-1 text-ink">
                <ShieldCheck size={12} /> Permission model:
              </span>{' '}
              the agent may discover tools freely, but external tool calls default to “ask”. Change
              the global <code className="text-cyan">mcp_call_tool</code> level in{' '}
              <Link to="/agent" className="text-cyan underline">
                Agent Manager → Permissions
              </Link>
              .
            </InfoNote>
          </div>
        </>
      )}

      {tab === 'custom' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <SectionHeading
              title="Add a remote MCP server"
              subtitle="Streamable HTTP transport. The server must expose the MCP handshake and a tools list."
            />
            <div className="space-y-3">
              <Field label="Server URL" hint="HTTPS only. Private-network and metadata hosts are rejected server-side.">
                <Input
                  value={custom.serverUrl}
                  onChange={(event) =>
                    setCustom((prev) => ({ ...prev, serverUrl: event.target.value }))
                  }
                  placeholder="https://mcp.example.com/mcp"
                />
              </Field>
              <Field label="Display name">
                <Input
                  value={custom.displayName}
                  onChange={(event) =>
                    setCustom((prev) => ({ ...prev, displayName: event.target.value }))
                  }
                  placeholder="My tools"
                />
              </Field>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Auth header" hint="Optional.">
                  <Input
                    value={custom.authHeader}
                    onChange={(event) =>
                      setCustom((prev) => ({ ...prev, authHeader: event.target.value }))
                    }
                    placeholder="Authorization"
                  />
                </Field>
                <Field label="Token" hint="Stored encrypted, never returned to the browser.">
                  <Input
                    type="password"
                    value={custom.authToken}
                    onChange={(event) =>
                      setCustom((prev) => ({ ...prev, authToken: event.target.value }))
                    }
                    placeholder="Bearer …"
                  />
                </Field>
              </div>
              <Button
                variant="primary"
                onClick={() => void connectCustom()}
                loading={busy === 'custom'}
                disabled={!custom.serverUrl.trim()}
              >
                <Cable size={14} /> Test & connect
              </Button>
            </div>
          </Card>

          <Card className="p-4">
            <SectionHeading title="What happens on connect" />
            <ol className="space-y-2 text-xs leading-relaxed text-muted">
              <li>1. The URL is validated against the SSRF guard (HTTPS, no private IPs).</li>
              <li>2. JOBBY performs the MCP initialize handshake with a short timeout.</li>
              <li>3. Tools are discovered and stored per connection, disabled-by-default review.</li>
              <li>4. Your auth token goes into Vault; only a reference is stored.</li>
              <li>5. Every call is logged with the run it belonged to.</li>
            </ol>
            <div className="mt-4">
              <InfoNote>
                If the server does not answer the handshake, the connection fails with its actual
                error. JOBBY will not show a connected badge for an unreachable server.
              </InfoNote>
            </div>
          </Card>
        </div>
      )}

      <Modal
        open={runTarget !== null}
        onClose={() => setRunTarget(null)}
        title={runTarget ? `Run ${runTarget.tool.tool_name}` : 'Run tool'}
        description="A live call against the connected account. Results are shown verbatim."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setRunTarget(null)}>
              Close
            </Button>
            <Button variant="primary" size="sm" onClick={() => void runTool()} loading={running}>
              <Play size={12} /> Run
            </Button>
          </>
        }
      >
        {runTarget && (
          <div className="space-y-3">
            <div className="rounded-lg border border-line bg-bg/40 p-2.5 text-[11px] text-muted">
              <span className="text-ink">{runTarget.connection.display_name}</span> ·{' '}
              {runTarget.tool.tool_name}
            </div>
            <Field label="Arguments (JSON)">
              <Textarea
                value={runArgs}
                onChange={(event) => setRunArgs(event.target.value)}
                className="min-h-28 font-mono text-xs"
              />
            </Field>
            {runResult && (
              <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-bg/60 p-3 text-[11px] text-ink/85">
                {runResult}
              </pre>
            )}
          </div>
        )}
      </Modal>

      {loading && (
        <div className="mt-4 flex items-center gap-2 text-[11px] text-muted">
          <Loader2 size={12} className="animate-spin" /> Loading connector catalogue…
        </div>
      )}

      <div className="mt-6 flex items-center gap-2 text-[10px] text-muted/60">
        <CheckCircle2 size={11} />
        Connector credentials live in the backend only.
        <Link to="/agent" className="ml-auto inline-flex items-center gap-1 text-cyan">
          Manage tools <ExternalLink size={10} />
        </Link>
      </div>
    </Page>
  );
}
