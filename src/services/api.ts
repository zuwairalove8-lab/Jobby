import { callFunction, streamFunction } from '../lib/supabase';
import { createSseParser } from '../lib/sse';
import { validateHttpsUrl } from '../lib/url';
import type {
  BrowserSession,
  ChatRequest,
  ChatStreamEvent,
  JobSearchFilters,
  JobSearchResult,
  MatchResult,
  McpTool,
  ProviderTestResult,
  Resume,
} from '../types';

/* ----------------------------------- chat ---------------------------------- */

export async function streamChat(
  request: ChatRequest | { action: 'approve'; stepId: string; approved: boolean; conversationId: string } | { action: 'cancel'; runId: string },
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await streamFunction('agent-chat', request, signal);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The assistant returned an empty stream.');

  const decoder = new TextDecoder();
  const parser = createSseParser<ChatStreamEvent>(onEvent);

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.flush();
}

export async function cancelAgentRun(runId: string): Promise<{ ok: boolean }> {
  return callFunction('agent-chat', { action: 'cancel', runId });
}

/* --------------------------------- providers ------------------------------- */

export async function testProvider(input: {
  providerId?: string;
  kind: string;
  endpoint?: string | null;
  apiKey?: string | null;
}): Promise<ProviderTestResult> {
  return callFunction<ProviderTestResult>('provider-gateway', {
    action: 'test',
    ...input,
  });
}

export async function listProviderModels(input: {
  kind: string;
  endpoint?: string | null;
  apiKey?: string | null;
}): Promise<{ models: string[]; message: string }> {
  return callFunction<{ models: string[]; message: string }>('provider-gateway', {
    action: 'models',
    ...input,
  });
}

export async function saveProviderSecret(input: {
  providerId: string;
  apiKey: string;
  label?: string;
}): Promise<{ ok: true; hasCredential: true }> {
  return callFunction<{ ok: true; hasCredential: true }>('provider-gateway', {
    action: 'save-secret',
    ...input,
  });
}

export async function deleteProviderSecret(providerId: string): Promise<{ ok: true }> {
  return callFunction<{ ok: true }>('provider-gateway', {
    action: 'delete-secret',
    providerId,
  });
}

export async function getProviderStatus(): Promise<{
  serverDefaults: { openrouter: boolean; composio: boolean; browserWorker: boolean };
  vault: boolean;
}> {
  return callFunction('provider-gateway', { action: 'status' });
}

/* ------------------------------------ MCP ---------------------------------- */

export interface Connector {
  slug: string;
  name: string;
  description: string;
  category: string;
  authMode: string;
  logo?: string;
  toolCount?: number;
}

export async function listConnectors(): Promise<{
  connectors: Connector[];
  composioConfigured: boolean;
  message?: string;
}> {
  return callFunction('mcp-gateway', { action: 'connectors' });
}

export async function connectComposio(input: {
  connectorSlug: string;
  displayName: string;
  callbackUrl?: string;
}): Promise<{ connectionId: string; status: string; redirectUrl?: string | null; message: string }> {
  return callFunction('mcp-gateway', { action: 'connect-composio', ...input });
}

export async function connectCustomServer(input: {
  serverUrl: string;
  displayName: string;
  authHeader?: string;
  authToken?: string;
}): Promise<{ connectionId: string; tools: McpTool[]; message: string }> {
  const check = validateHttpsUrl(input.serverUrl);
  if (!check.ok) throw new Error(check.error ?? 'Invalid server URL.');
  return callFunction('mcp-gateway', {
    action: 'connect-custom',
    serverUrl: check.url?.toString(),
    displayName: input.displayName,
    authHeader: input.authHeader,
    authToken: input.authToken,
  });
}

export async function disconnectMcp(connectionId: string): Promise<{ ok: true }> {
  return callFunction('mcp-gateway', { action: 'disconnect', connectionId });
}

export async function refreshMcpTools(connectionId: string): Promise<{ tools: McpTool[] }> {
  return callFunction('mcp-gateway', { action: 'refresh-tools', connectionId });
}

export async function executeMcpTool(input: {
  connectionId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}): Promise<{ ok: boolean; result: unknown; error?: string }> {
  return callFunction('mcp-gateway', { action: 'execute', ...input });
}

export async function listConnectionTools(connectionId: string): Promise<{ tools: McpTool[] }> {
  return callFunction('mcp-gateway', { action: 'tools', connectionId });
}

/* ---------------------------------- browser -------------------------------- */

export async function createBrowserSession(input?: {
  startUrl?: string;
}): Promise<{ session: BrowserSession; message?: string }> {
  return callFunction('browser-gateway', { action: 'create', ...input });
}

export async function getBrowserSessionStatus(): Promise<{
  session: BrowserSession | null;
  workerConfigured: boolean;
  message?: string;
}> {
  return callFunction('browser-gateway', { action: 'session' });
}

export async function browserNavigate(
  url: string,
): Promise<{ session: BrowserSession; screenshot?: string | null }> {
  const check = validateHttpsUrl(url);
  if (!check.ok) throw new Error(check.error ?? 'Invalid URL.');
  return callFunction('browser-gateway', { action: 'navigate', url: check.url?.toString() });
}

export async function browserAction(input: {
  kind: 'click' | 'type' | 'scroll' | 'back' | 'forward';
  selector?: string;
  text?: string;
  direction?: 'up' | 'down';
}): Promise<{ ok: boolean; message: string; screenshot?: string | null; url?: string }> {
  return callFunction('browser-gateway', { action: 'act', ...input });
}

export async function browserScreenshot(): Promise<{ screenshot: string | null; url?: string }> {
  return callFunction('browser-gateway', { action: 'screenshot' });
}

export async function stopBrowserSession(): Promise<{ ok: true }> {
  return callFunction('browser-gateway', { action: 'stop' });
}

/* ----------------------------------- jobs ---------------------------------- */

export async function searchJobs(filters: JobSearchFilters): Promise<JobSearchResult> {
  return callFunction<JobSearchResult>('jobs', { action: 'search', ...filters });
}

export async function matchJob(jobId: string): Promise<MatchResult> {
  return callFunction<MatchResult>('jobs', { action: 'match', jobId });
}

/* ---------------------------------- resume --------------------------------- */

export async function generateResume(input: {
  jobId?: string;
  targetRole?: string;
  jobDescription?: string;
  instructions?: string;
  saveAsTitle?: string;
}): Promise<{ resume: Resume | null; content: Resume['content']; message: string }> {
  return callFunction('resume', { action: 'generate-resume', ...input });
}

export async function generateCoverLetter(input: {
  jobId?: string;
  resumeId?: string;
  company?: string;
  role?: string;
  jobDescription?: string;
  instructions?: string;
}): Promise<{ letter: string; message: string }> {
  return callFunction('resume', { action: 'cover-letter', ...input });
}

