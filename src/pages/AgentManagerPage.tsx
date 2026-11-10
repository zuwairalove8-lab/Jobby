import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  Check,
  Cpu,
  KeyRound,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
  X,
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
  Select,
  Skeleton,
  Switch,
  Tabs,
  Textarea,
} from '../components/ui';
import { useAuth } from '../context/AuthProvider';
import { useToast } from '../context/ToastProvider';
import {
  createAgentSkill,
  deleteAgentSkill,
  deleteProvider,
  listAgentSkills,
  listProviders,
  listToolLogs,
  listToolPermissions,
  setAgentSkillEnabled,
  setDefaultProvider,
  setToolPermission,
  upsertProvider,
} from '../services/db';
import {
  deleteProviderSecret,
  getProviderStatus,
  saveProviderSecret,
  testProvider,
} from '../services/api';
import { TOOL_CATALOG } from '../lib/tools';
import { timeAgo } from '../lib/format';
import type {
  AiProvider,
  PermissionLevel,
  ProviderKind,
  Skill,
  ToolExecutionLog,
  ToolPermission,
} from '../types';

type Tab = 'providers' | 'skills' | 'permissions' | 'activity';

const KIND_LABEL: Record<ProviderKind, string> = {
  openrouter: 'OpenRouter',
  openai_compatible: 'OpenAI-compatible',
  kilo: 'Kilo Gateway',
};

const EMPTY_FORM = {
  provider_name: '',
  kind: 'openrouter' as ProviderKind,
  model_name: '',
  endpoint: '',
  apiKey: '',
};

export function AgentManagerPage() {
  const { user } = useAuth();
  const toast = useToast();
  const userId = user?.id ?? '';

  const [tab, setTab] = useState<Tab>('providers');
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [permissions, setPermissions] = useState<ToolPermission[]>([]);
  const [logs, setLogs] = useState<ToolExecutionLog[]>([]);
  const [status, setStatus] = useState<{
    serverDefaults: { openrouter: boolean; composio: boolean; browserWorker: boolean };
    vault: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [providerModal, setProviderModal] = useState<AiProvider | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const [skillModal, setSkillModal] = useState(false);
  const [skillForm, setSkillForm] = useState({
    name: '',
    description: '',
    instructions: '',
    category: 'career',
    icon: 'sparkles',
  });

  const reload = useCallback(async () => {
    const [providerRows, skillRows, permissionRows, logRows, providerStatus] =
      await Promise.allSettled([
        listProviders(userId),
        listAgentSkills(userId),
        listToolPermissions(userId),
        listToolLogs(userId),
        getProviderStatus(),
      ]);
    if (providerRows.status === 'fulfilled') setProviders(providerRows.value);
    if (skillRows.status === 'fulfilled') setSkills(skillRows.value);
    if (permissionRows.status === 'fulfilled') setPermissions(permissionRows.value);
    if (logRows.status === 'fulfilled') setLogs(logRows.value);
    if (providerStatus.status === 'fulfilled') setStatus(providerStatus.value);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    reload()
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load agent settings.'),
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, reload]);

  const permissionMap = useMemo(
    () => new Map(permissions.map((p) => [p.tool_name, p])),
    [permissions],
  );

  const openProvider = (provider: AiProvider | 'new') => {
    setProviderModal(provider);
    setTestResult(null);
    setForm(
      provider === 'new'
        ? EMPTY_FORM
        : {
            provider_name: provider.provider_name,
            kind: provider.kind,
            model_name: provider.model_name,
            endpoint: provider.endpoint ?? '',
            apiKey: '',
          },
    );
  };

  const saveProvider = async () => {
    if (!form.provider_name.trim() || !form.model_name.trim()) {
      setError('Provider name and model name are required.');
      return;
    }
    setBusy('provider-save');
    setError(null);
    try {
      const existing = providerModal !== 'new' && providerModal ? providerModal : null;
      const saved = await upsertProvider({
        ...(existing ? { id: existing.id } : {}),
        user_id: userId,
        provider_name: form.provider_name.trim(),
        model_name: form.model_name.trim(),
        kind: form.kind,
        endpoint: form.endpoint.trim() || null,
        enabled: existing ? existing.enabled : true,
        fallback_order: existing ? existing.fallback_order : providers.length,
      });
      if (form.apiKey.trim()) {
        await saveProviderSecret({ providerId: saved.id, apiKey: form.apiKey.trim() });
        toast('Provider saved and the key was stored encrypted.', 'success');
      } else {
        toast('Provider saved.', 'success');
      }
      setProviderModal(null);
      setForm(EMPTY_FORM);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the provider.');
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testProvider({
        providerId: providerModal !== 'new' && providerModal ? providerModal.id : undefined,
        kind: form.kind,
        endpoint: form.endpoint.trim() || null,
        apiKey: form.apiKey.trim() || null,
      });
      setTestResult(
        result.ok
          ? `Connected in ${result.latencyMs ?? '?'}ms. ${result.models?.length ?? 0} models visible.`
          : `Failed: ${result.message}`,
      );
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : 'Connection test failed.');
    } finally {
      setTesting(false);
    }
  };

  const makeDefault = async (provider: AiProvider) => {
    setBusy(provider.id);
    try {
      await setDefaultProvider(userId, provider.id);
      await reload();
      toast(`${provider.provider_name} is now the default.`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not set the default.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const toggleProvider = async (provider: AiProvider, enabled: boolean) => {
    try {
      await upsertProvider({
        id: provider.id,
        user_id: userId,
        provider_name: provider.provider_name,
        model_name: provider.model_name,
        kind: provider.kind,
        endpoint: provider.endpoint,
        enabled,
        is_default: provider.is_default,
        fallback_order: provider.fallback_order,
      });
      setProviders((prev) =>
        prev.map((p) => (p.id === provider.id ? { ...p, enabled } : p)),
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update the provider.', 'error');
    }
  };

  const removeProvider = async (provider: AiProvider) => {
    try {
      if (provider.has_credential) await deleteProviderSecret(provider.id).catch(() => undefined);
      await deleteProvider(provider.id);
      await reload();
      toast('Provider removed.', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete the provider.', 'error');
    }
  };

  const updatePermission = async (
    toolName: string,
    level: PermissionLevel,
    enabled: boolean,
  ) => {
    try {
      await setToolPermission(userId, toolName, level, enabled);
      setPermissions((prev) => {
        const existing = prev.find((p) => p.tool_name === toolName);
        if (existing) {
          return prev.map((p) =>
            p.tool_name === toolName ? { ...p, permission_level: level, enabled } : p,
          );
        }
        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            user_id: userId,
            tool_name: toolName,
            permission_level: level,
            enabled,
          },
        ];
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update the permission.', 'error');
    }
  };

  const createSkill = async () => {
    if (!skillForm.name.trim() || !skillForm.instructions.trim()) {
      setError('A skill needs a name and instructions.');
      return;
    }
    setBusy('skill');
    try {
      await createAgentSkill(userId, {
        name: skillForm.name.trim(),
        description: skillForm.description.trim() || 'Custom skill',
        instructions: skillForm.instructions.trim(),
        category: skillForm.category,
        icon: skillForm.icon,
      });
      setSkillModal(false);
      setSkillForm({ name: '', description: '', instructions: '', category: 'career', icon: 'sparkles' });
      await reload();
      toast('Skill created.', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the skill.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page
      title="Agent Manager"
      description="Providers, skills, tool permissions and the audit trail for everything the agent does."
      actions={
        tab === 'providers' ? (
          <Button variant="primary" size="sm" onClick={() => openProvider('new')}>
            <Plus size={13} /> Add provider
          </Button>
        ) : tab === 'skills' ? (
          <Button variant="primary" size="sm" onClick={() => setSkillModal(true)}>
            <Plus size={13} /> New skill
          </Button>
        ) : undefined
      }
    >
      <div className="mb-4">
        <Tabs
          active={tab}
          onChange={(id) => setTab(id as Tab)}
          items={[
            { id: 'providers', label: 'AI providers', badge: providers.length || undefined },
            { id: 'skills', label: 'Skills', badge: skills.length || undefined },
            { id: 'permissions', label: 'Permissions' },
            { id: 'activity', label: 'Audit log' },
          ]}
        />
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {tab === 'providers' && (
        <div className="space-y-3">
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Bot size={16} className="text-cyan" />
                  <p className="text-sm font-semibold">JOBBY default · OpenRouter</p>
                  <Badge tone={status?.serverDefaults.openrouter ? 'good' : 'warn'}>
                    {status?.serverDefaults.openrouter ? 'key present' : 'no server key'}
                  </Badge>
                </div>
                <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted">
                  The built-in route. When the project secret{' '}
                  <code className="text-cyan">OPENROUTER_API_KEY</code> is set, every user gets
                  OpenRouter access out of the box. Without it, users must bring their own provider
                  key below — JOBBY never silently fakes a reply.
                </p>
              </div>
            </div>
          </Card>

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : providers.length === 0 ? (
            <EmptyState
              icon={<Cpu size={20} />}
              title="No personal providers yet"
              description="Add any OpenAI-compatible endpoint (OpenRouter, Kilo, a self-hosted gateway) with your own key. Keys are encrypted server-side and never returned to the browser."
              action={
                <Button size="sm" variant="secondary" onClick={() => openProvider('new')}>
                  Add a provider
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {providers.map((provider) => (
                <Card key={provider.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold">{provider.provider_name}</p>
                        <Badge tone="neutral">{KIND_LABEL[provider.kind]}</Badge>
                        <Badge tone={provider.has_credential ? 'good' : 'warn'}>
                          {provider.has_credential ? 'key stored' : 'no key'}
                        </Badge>
                        {provider.is_default && <Badge tone="cyan">default</Badge>}
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted">
                        model {provider.model_name}
                        {provider.endpoint ? ` · ${provider.endpoint}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={provider.enabled}
                        onChange={(next) => void toggleProvider(provider, next)}
                        label="Enabled"
                      />
                      {!provider.is_default && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void makeDefault(provider)}
                          loading={busy === provider.id}
                        >
                          Make default
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => openProvider(provider)}>
                        Edit
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Delete provider"
                        onClick={() => void removeProvider(provider)}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <InfoNote>
            Provider credentials are encrypted with Supabase Vault and only readable by the edge
            functions. Model availability is whatever your provider reports — JOBBY does not hardcode
            or promise free models.
          </InfoNote>
        </div>
      )}

      {tab === 'skills' && (
        <div className="space-y-3">
          {skills.length === 0 && !loading ? (
            <EmptyState
              icon={<Sparkles size={20} />}
              title="No skills available"
              description="Skills are reusable instruction packs the agent applies to every run — job-search discipline, application quality rules, tone."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {skills.map((skill) => (
                <Card key={skill.id} className="flex flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold">{skill.name}</p>
                        {skill.built_in && <Badge tone="violet">built-in</Badge>}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted">
                        {skill.description}
                      </p>
                    </div>
                    <Switch
                      checked={skill.enabled}
                      onChange={(next) => {
                        void setAgentSkillEnabled(skill.id, next).then(reload);
                      }}
                      label={`Enable ${skill.name}`}
                    />
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-muted">
                      Instructions
                    </summary>
                    <p className="mt-1.5 whitespace-pre-wrap rounded-lg border border-line/60 bg-bg/40 p-2 text-[11px] leading-relaxed text-ink/75">
                      {skill.instructions}
                    </p>
                  </details>
                  {!skill.built_in && (
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void deleteAgentSkill(skill.id).then(reload);
                        }}
                      >
                        <Trash2 size={12} /> Delete
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'permissions' && (
        <div className="space-y-3">
          <InfoNote>
            <span className="inline-flex items-center gap-1 text-ink">
              <ShieldCheck size={12} /> How levels work:
            </span>{' '}
            <span className="text-cyan">allow</span> runs automatically,{' '}
            <span className="text-warn">ask</span> pauses the agent for your approval,{' '}
            <span className="text-bad">deny</span> blocks the tool entirely. Application submission
            always asks, whatever this table says.
          </InfoNote>

          <Card className="divide-y divide-line/60">
            {TOOL_CATALOG.map((tool) => {
              const permission = permissionMap.get(tool.name);
              const level = permission?.permission_level ?? tool.defaultPermission;
              const enabled = permission?.enabled ?? true;
              return (
                <div key={tool.name} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
                      {tool.label}
                      {tool.alwaysAsk && (
                        <Badge tone="warn">
                          <ShieldCheck size={9} /> always ask
                        </Badge>
                      )}
                    </p>
                    <p className="text-[10px] text-muted">{tool.description}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted/50">{tool.name}</p>
                  </div>
                  <Select
                    aria-label={`Permission for ${tool.label}`}
                    value={level}
                    disabled={tool.alwaysAsk}
                    onChange={(event) =>
                      void updatePermission(tool.name, event.target.value as PermissionLevel, enabled)
                    }
                    className="h-8 w-28 py-0 text-[11px]"
                  >
                    <option value="allow">allow</option>
                    <option value="ask">ask</option>
                    <option value="deny">deny</option>
                  </Select>
                  <Switch
                    checked={enabled}
                    onChange={(next) => void updatePermission(tool.name, level, next)}
                    label={`Enable ${tool.label}`}
                  />
                </div>
              );
            })}
          </Card>
        </div>
      )}

      {tab === 'activity' && (
        <div className="space-y-2">
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : logs.length === 0 ? (
            <EmptyState
              icon={<Activity size={20} />}
              title="No tool activity yet"
              description="Every tool the agent runs — allowed, denied or failed — is written here with its run id."
            />
          ) : (
            <Card className="divide-y divide-line/60">
              {logs.map((log) => (
                <div key={log.id} className="flex items-start gap-3 p-3">
                  <span
                    className={
                      log.status === 'succeeded'
                        ? 'mt-1 h-2 w-2 shrink-0 rounded-full bg-good'
                        : log.status === 'failed'
                          ? 'mt-1 h-2 w-2 shrink-0 rounded-full bg-bad'
                          : 'mt-1 h-2 w-2 shrink-0 rounded-full bg-warn'
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-ink">
                      {log.tool_name}{' '}
                      <span className="text-muted">· {log.action}</span>{' '}
                      <span className="text-[10px] uppercase tracking-wide text-muted/60">
                        {log.status}
                      </span>
                    </p>
                    <p className="text-[10px] text-muted/60">
                      {timeAgo(log.created_at)}
                      {log.run_id ? ` · run ${log.run_id.slice(0, 8)}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {/* provider modal */}
      <Modal
        open={providerModal !== null}
        onClose={() => setProviderModal(null)}
        title={providerModal === 'new' ? 'Add an AI provider' : 'Edit provider'}
        description="Keys are sent over TLS to an edge function and encrypted at rest. They never enter the browser bundle."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setProviderModal(null)}>
              Cancel
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void test()} loading={testing}>
              Test connection
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void saveProvider()}
              loading={busy === 'provider-save'}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Provider name">
              <Input
                value={form.provider_name}
                onChange={(event) => setForm((prev) => ({ ...prev, provider_name: event.target.value }))}
                placeholder="My OpenRouter"
              />
            </Field>
            <Field label="Kind">
              <Select
                value={form.kind}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, kind: event.target.value as ProviderKind }))
                }
              >
                <option value="openrouter">OpenRouter</option>
                <option value="openai_compatible">OpenAI-compatible</option>
                <option value="kilo">Kilo Gateway</option>
              </Select>
            </Field>
          </div>
          <Field label="Model name" hint="Exactly as the provider expects, e.g. openrouter/auto or gpt-4o-mini.">
            <Input
              value={form.model_name}
              onChange={(event) => setForm((prev) => ({ ...prev, model_name: event.target.value }))}
              placeholder="openrouter/auto"
            />
          </Field>
          <Field
            label="Base URL"
            hint="Leave blank for the provider default. Must include https:// and no path suffix."
          >
            <Input
              value={form.endpoint}
              onChange={(event) => setForm((prev) => ({ ...prev, endpoint: event.target.value }))}
              placeholder="https://openrouter.ai/api/v1"
            />
          </Field>
          <Field
            label={providerModal !== 'new' ? 'Replace API key (optional)' : 'API key'}
            hint="Stored with Supabase Vault. Never logged."
          >
            <Input
              type="password"
              value={form.apiKey}
              onChange={(event) => setForm((prev) => ({ ...prev, apiKey: event.target.value }))}
              placeholder="sk-…"
              autoComplete="off"
            />
          </Field>
          {testResult && (
            <div
              className={
                testResult.startsWith('Failed') || testResult.toLowerCase().includes('error')
                  ? 'rounded-lg border border-bad/40 bg-bad/10 p-2.5 text-[11px] text-bad'
                  : 'rounded-lg border border-good/40 bg-good/10 p-2.5 text-[11px] text-good'
              }
            >
              {testResult}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[10px] text-muted">
            <KeyRound size={11} /> Provider keys are separate per user and per provider.
          </div>
        </div>
      </Modal>

      {/* skill modal */}
      <Modal
        open={skillModal}
        onClose={() => setSkillModal(false)}
        title="Create a skill"
        description="Skills are injected into the agent's system prompt for every run when enabled."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setSkillModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void createSkill()} loading={busy === 'skill'}>
              Create skill
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name">
            <Input
              value={skillForm.name}
              onChange={(event) => setSkillForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Strict truth-only applications"
            />
          </Field>
          <Field label="Description">
            <Input
              value={skillForm.description}
              onChange={(event) =>
                setSkillForm((prev) => ({ ...prev, description: event.target.value }))
              }
              placeholder="Never invent experience or certifications."
            />
          </Field>
          <Field label="Category">
            <Select
              value={skillForm.category}
              onChange={(event) => setSkillForm((prev) => ({ ...prev, category: event.target.value }))}
            >
              <option value="career">Career</option>
              <option value="writing">Writing</option>
              <option value="research">Research</option>
              <option value="security">Security</option>
              <option value="custom">Custom</option>
            </Select>
          </Field>
          <Field label="Instructions" hint="Concrete rules the agent must follow.">
            <Textarea
              value={skillForm.instructions}
              onChange={(event) =>
                setSkillForm((prev) => ({ ...prev, instructions: event.target.value }))
              }
              className="min-h-32"
              placeholder="Always cite the exact listing requirement. Never claim a certification the profile does not list…"
            />
          </Field>
        </div>
      </Modal>

      <div className="mt-6 flex flex-wrap items-center gap-2 text-[10px] text-muted/60">
        <Wand2 size={11} />
        Model routing: your default provider, then enabled fallbacks in order.
        {status && (
          <>
            <span className="mx-1">·</span>
            <span className={status.vault ? 'text-good' : 'text-warn'}>
              {status.vault ? 'Vault available' : 'Vault unavailable'}
            </span>
          </>
        )}
        {status?.serverDefaults.composio && (
          <>
            <span className="mx-1">·</span>
            <span className="inline-flex items-center gap-1 text-good">
              <Check size={10} /> Composio
            </span>
          </>
        )}
        {status && !status.serverDefaults.browserWorker && (
          <>
            <span className="mx-1">·</span>
            <span className="inline-flex items-center gap-1 text-warn">
              <X size={10} /> browser worker off
            </span>
          </>
        )}
      </div>
    </Page>
  );
}
