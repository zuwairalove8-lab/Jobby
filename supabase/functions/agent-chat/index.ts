// agent-chat: the JOBBY agent loop. Streams assistant text over SSE, executes
// tools through the permission layer and pauses for explicit approval before
// any sensitive or external action.
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
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MAX_ITERATIONS = 6;
const MAX_HISTORY = 18;

type Permission = 'allow' | 'ask' | 'deny';

const DEFAULT_PERMISSIONS: Record<string, Permission> = {
  get_profile: 'allow',
  search_jobs: 'allow',
  save_job: 'allow',
  list_applications: 'allow',
  update_application_status: 'ask',
  list_resumes: 'allow',
  create_resume_version: 'ask',
  generate_cover_letter: 'ask',
  browser_navigate: 'ask',
  browser_click: 'ask',
  browser_type: 'ask',
  browser_screenshot: 'allow',
  mcp_list_tools: 'allow',
  mcp_call_tool: 'ask',
  submit_application: 'ask',
};

const TOOL_DEFS = [
  tool('get_profile', 'Read the user profile, skills and enabled skill packs.', {}),
  tool('search_jobs', 'Search live public job feeds and persist matches.', {
    query: str('Keywords, e.g. "GRC analyst".'),
    country: str('Country filter, optional.'),
    remoteOnly: { type: 'boolean', description: 'Only remote roles.' },
    category: {
      type: 'string',
      enum: ['all', 'internship', 'training', 'entry', 'grc', 'cybersecurity', 'remote'],
      description: 'Category filter.',
    },
  }),
  tool('save_job', 'Save a job to the application tracker.', {
    jobId: str('Job id returned by search_jobs.'),
  }),
  tool('list_applications', 'List tracked applications and their stages.', {}),
  tool('update_application_status', 'Move a tracked application to a new stage.', {
    applicationId: str('Application id.'),
    status: {
      type: 'string',
      enum: ['discovered', 'saved', 'reviewing', 'ready', 'submitted', 'interview', 'accepted', 'rejected'],
    },
  }),
  tool('list_resumes', 'List saved CV versions.', {}),
  tool('create_resume_version', 'Generate and save a tailored CV version.', {
    targetRole: str('Role to tailor for.'),
    jobDescription: str('Listing text, optional.'),
    instructions: str('Extra instructions, optional.'),
    saveAsTitle: str('Title for the saved version.'),
  }),
  tool('generate_cover_letter', 'Draft a cover letter from real profile facts.', {
    company: str('Company name.'),
    role: str('Role title.'),
    jobDescription: str('Listing text, optional.'),
    instructions: str('Extra instructions, optional.'),
  }),
  tool('browser_navigate', 'Move the shared browser to an https URL.', {
    url: str('HTTPS URL.'),
  }),
  tool('browser_click', 'Click an element in the shared browser.', {
    selector: str('CSS selector.'),
  }),
  tool('browser_type', 'Type into a field in the shared browser.', {
    selector: str('CSS selector.'),
    text: str('Text to enter.'),
  }),
  tool('browser_screenshot', 'Capture the current page for the user to review.', {}),
  tool('mcp_list_tools', 'List tools on connected MCP accounts.', {}),
  tool('mcp_call_tool', 'Run a tool on a connected MCP account.', {
    connectionId: str('MCP connection id.'),
    toolName: str('Tool name.'),
    arguments: { type: 'object', description: 'Tool arguments object.' },
  }),
  tool('submit_application', 'Open an application page for final submission by the user.', {
    jobId: str('Job id to open.'),
  }),
];

function str(description: string) {
  return { type: 'string', description };
}

function tool(name: string, description: string, properties: Record<string, unknown>) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, additionalProperties: false },
    },
  };
}

interface Provider {
  endpoint: string;
  key: string;
  model: string;
  label: string;
}

interface StepRow {
  id: string;
  run_id: string;
  tool_name: string;
  status: string;
  input_summary: string | null;
  result_summary: string | null;
  input: Record<string, unknown> | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing bearer token.' }, 401);
  const userToken = authHeader.slice(7);

  const { data: userData, error: userError } = await admin.auth.getUser(userToken);
  if (userError || !userData.user) return json({ error: 'Not signed in.' }, 401);
  const userId = userData.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const action = String(body.action ?? 'chat');

  try {
    if (action === 'cancel') {
      const runId = String(body.runId ?? '');
      const { data: run } = await admin
        .from('agent_runs')
        .select('id')
        .eq('id', runId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!run) return json({ ok: false, error: 'Run not found.' }, 404);
      await admin
        .from('agent_runs')
        .update({ status: 'cancelled', finished_at: new Date().toISOString() })
        .eq('id', runId);
      await admin
        .from('agent_steps')
        .update({ status: 'denied' })
        .eq('run_id', runId)
        .eq('status', 'pending_approval');
      return json({ ok: true });
    }

    if (action === 'approve') {
      return await approve(body, userId, userToken);
    }

    return await chat(body, userId, userToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The agent failed.';
    return json({ error: message }, 500);
  }
});

/* ---------------------------------- chat ---------------------------------- */

async function chat(body: Record<string, unknown>, userId: string, userToken: string) {
  const conversationId = String(body.conversationId ?? '');
  const content = String(body.content ?? '').trim();
  if (!conversationId) return json({ error: 'conversationId is required.' }, 400);
  if (!content) return json({ error: 'Message content is empty.' }, 400);

  const { data: conversation } = await admin
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!conversation) return json({ error: 'Conversation not found.' }, 404);

  const provider = await resolveProvider(userId, body.providerId ? String(body.providerId) : null);
  if (!provider) {
    return json(
      {
        error:
          'No AI provider is available. Add your own key in Agent Manager, or set OPENROUTER_API_KEY for the server default.',
      },
      503,
    );
  }

  const messages = await buildMessages(userId, conversationId, conversation.title);
  const { data: run, error: runError } = await admin
    .from('agent_runs')
    .insert({
      user_id: userId,
      conversation_id: conversationId,
      status: 'running',
      model: provider.model,
      started_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (runError) throw new Error(runError.message);

  const stream = sseStream();
  void drive(run.id, conversationId, userId, userToken, provider, messages, stream).catch(
    async (error: unknown) => {
      const message = error instanceof Error ? error.message : 'The agent failed.';
      await admin
        .from('agent_runs')
        .update({ status: 'failed', error: message, finished_at: new Date().toISOString() })
        .eq('id', run.id);
      stream.send({ type: 'error', message });
      stream.close();
    },
  );

  stream.send({ type: 'run_start', runId: run.id, model: provider.model });
  return stream.response();
}

/* --------------------------------- approve -------------------------------- */

async function approve(body: Record<string, unknown>, userId: string, userToken: string) {
  const stepId = String(body.stepId ?? '');
  const approved = Boolean(body.approved);

  const { data: step } = await admin
    .from('agent_steps')
    .select('*')
    .eq('id', stepId)
    .maybeSingle();
  if (!step) return json({ error: 'Step not found.' }, 404);

  const { data: run } = await admin
    .from('agent_runs')
    .select('*')
    .eq('id', step.run_id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!run) return json({ error: 'Run not found.' }, 404);
  if (step.status !== 'pending_approval') {
    return json({ error: 'That step is no longer waiting for approval.' }, 409);
  }

  const plan = (run.task_plan ?? {}) as {
    messages?: Array<Record<string, unknown>>;
    iteration?: number;
    conversationId?: string;
  };
  const provider = await resolveProvider(userId, null);
  if (!provider) return json({ error: 'No AI provider is available.' }, 503);

  const stream = sseStream();

  if (!approved) {
    await admin
      .from('agent_steps')
      .update({ status: 'denied', result_summary: 'Denied by the user' })
      .eq('id', step.id);
    const messages = [...(plan.messages ?? [])];
    messages.push({
      role: 'tool',
      tool_call_id: String(step.input?.toolCallId ?? ''),
      content: 'The user denied this action. Do not retry it; explain the alternative.',
    });
    await admin
      .from('agent_runs')
      .update({ task_plan: { ...plan, messages }, status: 'running' })
      .eq('id', run.id);
    stream.send({ type: 'run_start', runId: run.id, model: provider.model });
    void drive(
      run.id,
      String(plan.conversationId ?? run.conversation_id ?? ''),
      userId,
      userToken,
      provider,
      messages,
      stream,
      Number(plan.iteration ?? 1) + 1,
    ).catch((error: unknown) => {
      stream.send({ type: 'error', message: error instanceof Error ? error.message : 'Failed.' });
      stream.close();
    });
    return stream.response();
  }

  const toolName = String(step.tool_name);
  const args = (step.input?.args ?? {}) as Record<string, unknown>;
  const toolCallId = String(step.input?.toolCallId ?? '');

  await admin.from('agent_steps').update({ status: 'running' }).eq('id', step.id);
  await admin.from('agent_runs').update({ status: 'running' }).eq('id', run.id);

  stream.send({ type: 'run_start', runId: run.id, model: provider.model });
  stream.send({ type: 'step', step: { ...step, status: 'running' } });

  const result = await executeTool(toolName, args, { userId, userToken, runId: run.id });
  await admin
    .from('agent_steps')
    .update({
      status: result.ok ? 'succeeded' : 'failed',
      result_summary: result.summary.slice(0, 500),
      output: { data: result.data } as Record<string, unknown>,
    })
    .eq('id', step.id);

  stream.send({
    type: 'step',
    step: {
      ...step,
      status: result.ok ? 'succeeded' : 'failed',
      result_summary: result.summary.slice(0, 500),
    },
  });

  const messages = [...(plan.messages ?? [])];
  messages.push({ role: 'tool', tool_call_id: toolCallId, content: JSON.stringify(result.data).slice(0, 8000) });
  await admin
    .from('agent_runs')
    .update({
      task_plan: { messages, iteration: Number(plan.iteration ?? 1), conversationId: plan.conversationId },
    })
    .eq('id', run.id);

  void drive(
    run.id,
    String(plan.conversationId ?? run.conversation_id ?? ''),
    userId,
    userToken,
    provider,
    messages,
    stream,
    Number(plan.iteration ?? 1) + 1,
  ).catch((error: unknown) => {
    stream.send({ type: 'error', message: error instanceof Error ? error.message : 'Failed.' });
    stream.close();
  });

  return stream.response();
}

/* ---------------------------------- loop ---------------------------------- */

async function drive(
  runId: string,
  conversationId: string,
  userId: string,
  userToken: string,
  provider: Provider,
  messages: Array<Record<string, unknown>>,
  stream: ReturnType<typeof sseStream>,
  startIteration = 0,
) {
  let iteration = startIteration;

  while (iteration < MAX_ITERATIONS) {
    iteration += 1;
    const outcome = await streamCompletion(provider, messages, stream);

    if (outcome.toolCalls.length === 0) {
      const text = outcome.content.trim() || 'I could not produce an answer for that.';
      const { data: saved } = await admin
        .from('messages')
        .insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: text,
          metadata: { model: provider.model, runId },
        })
        .select('id')
        .single();
      await admin
        .from('agent_runs')
        .update({
          status: 'completed',
          finished_at: new Date().toISOString(),
          result: { messageId: saved?.id ?? null },
          model: provider.model,
        })
        .eq('id', runId);
      await admin
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);
      stream.send({ type: 'done', messageId: saved?.id ?? null });
      stream.close();
      return;
    }

    const assistantMessage: Record<string, unknown> = {
      role: 'assistant',
      content: outcome.content || null,
      tool_calls: outcome.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.args) },
      })),
    };
    messages.push(assistantMessage);

    for (const call of outcome.toolCalls) {
      const permission = await permissionFor(userId, call.name);
      const { data: step } = await admin
        .from('agent_steps')
        .insert({
          run_id: runId,
          tool_name: call.name,
          status: permission === 'deny' ? 'denied' : permission === 'ask' ? 'pending_approval' : 'running',
          input_summary: summariseArgs(call.args),
          input: { args: call.args, toolCallId: call.id },
        })
        .select('*')
        .single();

      if (permission === 'deny') {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: 'Blocked by the user permission settings for this tool.',
        });
        if (step) stream.send({ type: 'step', step });
        continue;
      }

      if (permission === 'ask') {
        if (step) stream.send({ type: 'step', step });
        await admin
          .from('agent_runs')
          .update({
            status: 'awaiting_approval',
            task_plan: { messages, iteration, conversationId },
          })
          .eq('id', runId);
        stream.send({ type: 'approval_required', step, runId });
        stream.send({ type: 'done', messageId: null });
        stream.close();
        return;
      }

      if (step) stream.send({ type: 'step', step });
      const result = await executeTool(call.name, call.args, { userId, userToken, runId });
      if (step) {
        const { data: updated } = await admin
          .from('agent_steps')
          .update({
            status: result.ok ? 'succeeded' : 'failed',
            result_summary: result.summary.slice(0, 500),
            output: { data: result.data } as Record<string, unknown>,
          })
          .eq('id', step.id)
          .select('*')
          .single();
        stream.send({ type: 'step', step: updated ?? step });
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result.data).slice(0, 8000),
      });
    }
  }

  const notice =
    'I stopped after several tool rounds. Ask me to continue and I will pick up from here.';
  await admin.from('messages').insert({
    conversation_id: conversationId,
    role: 'assistant',
    content: notice,
    metadata: { runId, stopped: 'max_iterations' },
  });
  await admin
    .from('agent_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString() })
    .eq('id', runId);
  stream.send({ type: 'delta', text: notice });
  stream.send({ type: 'done', messageId: null });
  stream.close();
}

/* ------------------------------ model streaming ---------------------------- */

interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

async function streamCompletion(
  provider: Provider,
  messages: Array<Record<string, unknown>>,
  stream: ReturnType<typeof sseStream>,
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const res = await fetch(`${provider.endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://jobby.app',
      'X-Title': 'JOBBY',
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      tools: TOOL_DEFS,
      tool_choice: 'auto',
      stream: true,
      temperature: 0.35,
      max_tokens: 2400,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Provider ${res.status}: ${text.slice(0, 400)}`);
  }
  if (!res.body) throw new Error('Provider returned no stream.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const calls: Array<{ id: string; name: string; argsRaw: string }> = [];

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let parsed: {
        choices?: Array<{
          delta?: {
            content?: string | null;
            tool_calls?: Array<{
              index: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
          finish_reason?: string | null;
        }>;
        error?: { message?: string };
      };
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      if (parsed.error?.message) throw new Error(parsed.error.message);

      const delta = parsed.choices?.[0]?.delta;
      if (delta?.content) {
        content += delta.content;
        stream.send({ type: 'delta', text: delta.content });
      }
      for (const call of delta?.tool_calls ?? []) {
        const slot = (calls[call.index] ??= { id: '', name: '', argsRaw: '' });
        if (call.id) slot.id = call.id;
        if (call.function?.name) slot.name += call.function.name;
        if (call.function?.arguments) slot.argsRaw += call.function.arguments;
      }
    }
  }

  return {
    content,
    toolCalls: calls
      .filter((call) => call.name)
      .map((call) => ({
        id: call.id || crypto.randomUUID(),
        name: call.name,
        args: safeArgs(call.argsRaw),
      })),
  };
}

function safeArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/* --------------------------------- helpers -------------------------------- */

function sseStream() {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
    },
  });

  return {
    response: () =>
      new Response(stream, {
        headers: {
          ...cors,
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      }),
    send(payload: unknown) {
      if (!controller || closed) return;
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      } catch {
        closed = true;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        controller?.close();
      } catch {
        /* already closed */
      }
    },
  };
}

async function resolveProvider(userId: string, providerId: string | null): Promise<Provider | null> {
  if (providerId) {
    const direct = await providerFromRow(userId, providerId);
    if (direct) return direct;
  }
  const { data: providers } = await admin
    .from('ai_providers')
    .select('*')
    .eq('user_id', userId)
    .eq('enabled', true)
    .order('is_default', { ascending: false })
    .order('fallback_order', { ascending: true });
  for (const row of providers ?? []) {
    const provider = await providerFromRow(userId, row.id);
    if (provider) return provider;
  }
  const serverKey = Deno.env.get('OPENROUTER_API_KEY');
  if (serverKey) {
    return {
      endpoint: 'https://openrouter.ai/api/v1',
      key: serverKey,
      model: Deno.env.get('OPENROUTER_DEFAULT_MODEL') ?? 'openrouter/auto',
      label: 'OpenRouter (server default)',
    };
  }
  return null;
}

async function providerFromRow(userId: string, providerId: string): Promise<Provider | null> {
  const { data: row } = await admin
    .from('ai_providers')
    .select('*')
    .eq('id', providerId)
    .eq('user_id', userId)
    .eq('enabled', true)
    .maybeSingle();
  if (!row) return null;
  const { data: secret } = await admin
    .from('provider_secrets')
    .select('secret_id')
    .eq('provider_id', row.id)
    .maybeSingle();
  if (!secret?.secret_id) return null;
  const { data: key } = await admin.rpc('jobby_read_secret', { p_id: secret.secret_id });
  if (typeof key !== 'string' || key.length < 8) return null;
  const endpoint =
    (row.endpoint as string | null)?.replace(/\/+$/, '') ||
    (row.kind === 'kilo' ? 'https://api.kilo.ai/api/gateway' : 'https://openrouter.ai/api/v1');
  return { endpoint, key, model: String(row.model_name), label: String(row.provider_name) };
}

async function buildMessages(userId: string, conversationId: string, title: string) {
  const [{ data: profile }, { data: skills }, { data: packs }, { data: history }] =
    await Promise.all([
      admin.from('profiles').select('*').eq('id', userId).maybeSingle(),
      admin.from('user_skills').select('skill_name, proficiency').eq('user_id', userId),
      admin
        .from('skills')
        .select('name, instructions')
        .or(`user_id.eq.${userId},built_in.eq.true`)
        .eq('enabled', true)
        .limit(8),
      admin
        .from('messages')
        .select('role, content, created_at')
        .eq('conversation_id', conversationId)
        .in('role', ['user', 'assistant'])
        .order('created_at', { ascending: false })
        .limit(MAX_HISTORY),
    ]);

  const facts = {
    name: profile?.full_name ?? null,
    country: profile?.country ?? null,
    headline: profile?.headline ?? null,
    years_experience: profile?.years_experience ?? null,
    skills: (skills ?? []).map((row) => `${row.skill_name} (${row.proficiency}/5)`),
  };

  const system = `You are JOBBY, an autonomous job-search assistant running inside the user's own account.
Today is ${new Date().toISOString().slice(0, 10)}.

WHAT YOU CAN DO
- Search live public job feeds, score fit with transparent evidence, and save roles to the tracker.
- Draft tailored CV content and cover letters from the user's real record.
- Operate a shared remote browser for pages the user asks about.
- Run tools from the user's connected MCP accounts.

HARD RULES
1. Never invent employers, dates, degrees, certifications, metrics or application outcomes. If a fact is missing, say so and ask.
2. Never claim a tool succeeded unless you received its result. Report failures verbatim and offer a next step.
3. Application submission is outward-facing: it always requires the user's explicit approval. After it runs, state exactly what happened.
4. When you search jobs, present real listings with company, title and source. Do not fabricate listings or deadlines.
5. Keep answers tight: lead with the answer, then the supporting detail. Use markdown lists and short paragraphs.
6. Conversation topic: "${title}".

USER RECORD (authoritative)
${JSON.stringify(facts)}
${(packs ?? []).length ? `\nSKILL PACKS (follow strictly)\n${(packs ?? []).map((p) => `${p.name}: ${p.instructions}`).join('\n')}` : ''}`;

  const messages: Array<Record<string, unknown>> = [{ role: 'system', content: system }];
  for (const row of (history ?? []).reverse()) {
    messages.push({ role: row.role, content: row.content });
  }
  return messages;
}

async function permissionFor(userId: string, toolName: string): Promise<Permission> {
  if (toolName === 'submit_application') return 'ask';
  const { data } = await admin
    .from('tool_permissions')
    .select('permission_level, enabled')
    .eq('user_id', userId)
    .eq('tool_name', toolName)
    .maybeSingle();
  if (data && data.enabled === false) return 'deny';
  return (data?.permission_level as Permission | undefined) ?? DEFAULT_PERMISSIONS[toolName] ?? 'ask';
}

function summariseArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value.slice(0, 120) : JSON.stringify(value).slice(0, 120)}`);
  return entries.join(' · ').slice(0, 400);
}

/* --------------------------------- tools ---------------------------------- */

interface ToolContext {
  userId: string;
  userToken: string;
  runId: string;
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ ok: boolean; summary: string; data: unknown }> {
  try {
    switch (name) {
      case 'get_profile': {
        const [{ data: profile }, { data: skills }, { data: packs }] = await Promise.all([
          admin.from('profiles').select('*').eq('id', ctx.userId).maybeSingle(),
          admin.from('user_skills').select('skill_name, proficiency').eq('user_id', ctx.userId),
          admin
            .from('skills')
            .select('name, instructions')
            .or(`user_id.eq.${ctx.userId},built_in.eq.true`)
            .eq('enabled', true),
        ]);
        return {
          ok: true,
          summary: 'Profile loaded',
          data: { profile, skills: skills ?? [], skillPacks: packs ?? [] },
        };
      }

      case 'search_jobs': {
        const result = await callFunction('jobs', { action: 'search', ...args }, ctx.userToken);
        const jobs = Array.isArray(result.jobs) ? result.jobs : [];
        return {
          ok: true,
          summary: `${jobs.length} listings from live feeds`,
          data: {
            jobs: jobs.slice(0, 12).map((job) => {
              const row = job as Record<string, unknown>;
              return {
                id: row.id,
                title: row.title,
                company: row.company,
                location: row.location,
                remote: row.remote,
                source: row.source,
                url: row.job_url,
                deadline: row.deadline,
                requirements: row.requirements,
                tags: row.tags,
              };
            }),
            sources: result.sources,
          },
        };
      }

      case 'save_job': {
        const jobId = String(args.jobId ?? '');
        if (!jobId) return { ok: false, summary: 'jobId missing', data: { error: 'jobId is required' } };
        const { data, error } = await admin
          .from('applications')
          .upsert(
            { user_id: ctx.userId, job_id: jobId, status: 'saved', updated_at: new Date().toISOString() },
            { onConflict: 'user_id,job_id' },
          )
          .select('*')
          .single();
        if (error) return { ok: false, summary: error.message, data: { error: error.message } };
        return { ok: true, summary: 'Saved to the tracker', data };
      }

      case 'list_applications': {
        const { data } = await admin
          .from('applications')
          .select('id, status, notes, updated_at, jobs(title, company, job_url)')
          .eq('user_id', ctx.userId)
          .order('updated_at', { ascending: false })
          .limit(30);
        return { ok: true, summary: `${data?.length ?? 0} tracked`, data: data ?? [] };
      }

      case 'update_application_status': {
        const applicationId = String(args.applicationId ?? '');
        const status = String(args.status ?? '');
        const allowed = ['discovered', 'saved', 'reviewing', 'ready', 'submitted', 'interview', 'accepted', 'rejected'];
        if (!allowed.includes(status)) {
          return { ok: false, summary: 'Invalid status', data: { error: 'Unsupported status' } };
        }
        const { data, error } = await admin
          .from('applications')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('id', applicationId)
          .eq('user_id', ctx.userId)
          .select('*')
          .maybeSingle();
        if (error) return { ok: false, summary: error.message, data: { error: error.message } };
        if (!data) return { ok: false, summary: 'Application not found', data: { error: 'Not found' } };
        return { ok: true, summary: `Moved to ${status}`, data };
      }

      case 'list_resumes': {
        const { data } = await admin
          .from('resumes')
          .select('id, title, is_primary, updated_at')
          .eq('user_id', ctx.userId)
          .order('updated_at', { ascending: false });
        return { ok: true, summary: `${data?.length ?? 0} CV versions`, data: data ?? [] };
      }

      case 'create_resume_version': {
        const result = await callFunction('resume', { action: 'generate-resume', ...args }, ctx.userToken);
        return {
          ok: true,
          summary: result.resume ? `Saved "${(result.resume as Record<string, unknown>).title}"` : 'Draft generated',
          data: result,
        };
      }

      case 'generate_cover_letter': {
        const result = await callFunction('resume', { action: 'cover-letter', ...args }, ctx.userToken);
        return { ok: true, summary: 'Cover letter drafted', data: result };
      }

      case 'browser_navigate': {
        const result = await callFunction('browser-gateway', { action: 'navigate', url: args.url }, ctx.userToken);
        return { ok: true, summary: `Navigated to ${String(args.url)}`, data: result };
      }

      case 'browser_click': {
        const result = await callFunction(
          'browser-gateway',
          { action: 'act', kind: 'click', selector: args.selector },
          ctx.userToken,
        );
        return { ok: result.ok !== false, summary: String(result.message ?? 'Clicked'), data: result };
      }

      case 'browser_type': {
        const result = await callFunction(
          'browser-gateway',
          { action: 'act', kind: 'type', selector: args.selector, text: args.text },
          ctx.userToken,
        );
        return { ok: result.ok !== false, summary: String(result.message ?? 'Typed'), data: result };
      }

      case 'browser_screenshot': {
        const result = await callFunction('browser-gateway', { action: 'screenshot' }, ctx.userToken);
        return { ok: true, summary: 'Screenshot captured', data: result };
      }

      case 'mcp_list_tools': {
        const result = await callFunction('mcp-gateway', { action: 'tools-all' }, ctx.userToken);
        return { ok: true, summary: `${Array.isArray(result.tools) ? result.tools.length : 0} tools`, data: result };
      }

      case 'mcp_call_tool': {
        const result = await callFunction(
          'mcp-gateway',
          {
            action: 'execute',
            connectionId: args.connectionId,
            toolName: args.toolName,
            arguments: args.arguments ?? {},
          },
          ctx.userToken,
        );
        return {
          ok: result.ok !== false,
          summary: result.ok === false ? String(result.error ?? 'Tool failed') : 'Tool executed',
          data: result,
        };
      }

      case 'submit_application': {
        const jobId = String(args.jobId ?? '');
        const { data: job } = await admin
          .from('jobs')
          .select('id, title, company, job_url')
          .eq('id', jobId)
          .maybeSingle();
        if (!job?.job_url) {
          return { ok: false, summary: 'No application URL', data: { error: 'This job has no URL to open.' } };
        }
        const opened = await callFunction(
          'browser-gateway',
          { action: 'navigate', url: job.job_url },
          ctx.userToken,
        ).catch((error: unknown) => ({ error: error instanceof Error ? error.message : 'Browser unavailable' }));
        await admin.from('applications').upsert(
          { user_id: ctx.userId, job_id: jobId, status: 'ready', updated_at: new Date().toISOString() },
          { onConflict: 'user_id,job_id' },
        );
        return {
          ok: true,
          summary: 'Opened the application page',
          data: {
            opened: !('error' in opened),
            browser: opened,
            note: 'JOBBY has not submitted anything. Complete and submit the form yourself in the shared browser, then tell me so I can update the tracker.',
          },
        };
      }

      default:
        return { ok: false, summary: 'Unknown tool', data: { error: `No implementation for ${name}` } };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tool failed.';
    await admin.from('tool_execution_logs').insert({
      user_id: ctx.userId,
      run_id: ctx.runId,
      tool_name: name,
      action: 'execute',
      status: 'failed',
      detail: { error: message },
    });
    return { ok: false, summary: message, data: { error: message } };
  }
}

async function callFunction(
  slug: string,
  payload: Record<string, unknown>,
  userToken: string,
): Promise<Record<string, any>> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userToken}`,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = { raw: text.slice(0, 400) };
  }
  if (!res.ok) {
    const message =
      typeof parsed.error === 'string' ? parsed.error : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return parsed as Record<string, any>;
}
