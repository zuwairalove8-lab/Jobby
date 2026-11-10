/**
 * Shared domain types for JOBBY. These mirror the SQL schema in
 * `supabase/migrations` and the payloads of the edge functions.
 */

export type ApplicationStatus =
  | 'discovered'
  | 'saved'
  | 'reviewing'
  | 'ready'
  | 'submitted'
  | 'interview'
  | 'accepted'
  | 'rejected';

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  'discovered',
  'saved',
  'reviewing',
  'ready',
  'submitted',
  'interview',
  'accepted',
  'rejected',
];

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentStepStatus =
  | 'pending'
  | 'pending_approval'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'denied';

export type PermissionLevel = 'allow' | 'ask' | 'deny';

export type ProviderKind = 'openrouter' | 'openai_compatible' | 'kilo';

export type McpConnectionStatus = 'connected' | 'disconnected' | 'error';

export type BrowserSessionStatus = 'starting' | 'active' | 'stopped' | 'error';

export interface Profile {
  id: string;
  full_name: string | null;
  country: string | null;
  phone: string | null;
  headline: string | null;
  years_experience: number | null;
  date_of_birth: string | null;
  preferences: Record<string, unknown>;
  onboarded: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserSkill {
  id: string;
  user_id: string;
  skill_name: string;
  proficiency: number;
  created_at: string;
}

export interface ResumeExperience {
  company: string;
  title: string;
  start?: string;
  end?: string;
  bullets: string[];
}

export interface ResumeContent {
  summary?: string;
  contact?: { email?: string; phone?: string; location?: string; links?: string[] };
  experience?: ResumeExperience[];
  education?: { institution: string; qualification: string; year?: string }[];
  skills?: string[];
  certifications?: string[];
}

export interface Resume {
  id: string;
  user_id: string;
  title: string;
  content: ResumeContent;
  storage_path: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  model: string | null;
  provider_id: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AgentRun {
  id: string;
  user_id: string;
  conversation_id: string | null;
  status: AgentRunStatus;
  task_plan: unknown;
  result: unknown;
  model: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface AgentStep {
  id: string;
  run_id: string;
  tool_name: string;
  status: AgentStepStatus;
  input_summary: string | null;
  result_summary: string | null;
  input?: Record<string, unknown>;
  output?: unknown;
  created_at: string;
}

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string | null;
  country: string | null;
  source: string;
  external_id: string | null;
  job_url: string | null;
  description: string | null;
  requirements: string[];
  tags: string[];
  salary: string | null;
  remote: boolean;
  deadline: string | null;
  eligibility: Record<string, unknown>;
  posted_at: string | null;
  created_at: string;
}

export interface JobMatch {
  id: string;
  user_id: string;
  job_id: string;
  match_score: number;
  explanation: {
    matched?: string[];
    missing?: string[];
    notes?: string[];
    eligible?: boolean | null;
  };
  created_at: string;
}

export interface Application {
  id: string;
  user_id: string;
  job_id: string | null;
  resume_id: string | null;
  status: ApplicationStatus;
  notes: string | null;
  applied_at: string | null;
  updated_at: string;
  created_at: string;
}

export interface AiProvider {
  id: string;
  user_id: string;
  provider_name: string;
  kind: ProviderKind;
  model_name: string;
  endpoint: string | null;
  enabled: boolean;
  is_default: boolean;
  fallback_order: number;
  has_credential: boolean;
  created_at: string;
  updated_at: string;
}

export interface McpConnection {
  id: string;
  user_id: string;
  provider: 'composio' | 'custom';
  external_account_id: string | null;
  server_url: string | null;
  display_name: string;
  status: McpConnectionStatus;
  registry_id: string | null;
  created_at: string;
}

export interface McpTool {
  id: string;
  connection_id: string;
  tool_name: string;
  description: string | null;
  input_schema: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

export interface ToolPermission {
  id: string;
  user_id: string;
  tool_name: string;
  permission_level: PermissionLevel;
  enabled: boolean;
}

export interface BrowserSession {
  id: string;
  user_id: string;
  remote_session_id: string | null;
  current_url: string | null;
  status: BrowserSessionStatus;
  last_screenshot_path: string | null;
  created_at: string;
  updated_at: string;
  provider: string | null;
}

export interface ToolExecutionLog {
  id: string;
  user_id: string;
  run_id: string | null;
  tool_name: string;
  action: string;
  status: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface Skill {
  id: string;
  user_id: string | null;
  name: string;
  description: string;
  instructions: string;
  category: string;
  icon: string;
  enabled: boolean;
  built_in: boolean;
  created_at: string;
}

/* ------------------------------------------------------------------------- */
/* Edge-function payloads                                                     */
/* ------------------------------------------------------------------------- */

export type ChatStreamEvent =
  | { type: 'run_start'; runId: string; model: string }
  | { type: 'delta'; text: string }
  | { type: 'step'; step: AgentStep }
  | { type: 'approval_required'; step: AgentStep; runId: string }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done'; messageId: string | null; usage?: Record<string, unknown> };

export interface ChatRequest {
  action: 'chat';
  conversationId: string;
  content: string;
  providerId?: string | null;
  model?: string | null;
  enableTools?: boolean;
  skillIds?: string[];
}

export interface ApproveRequest {
  action: 'approve';
  stepId: string;
  approved: boolean;
  conversationId: string;
}

export interface CancelRequest {
  action: 'cancel';
  runId: string;
}

export interface ProviderTestResult {
  ok: boolean;
  models?: string[];
  message: string;
  latencyMs?: number;
}

export interface JobSearchFilters {
  query: string;
  country?: string;
  remoteOnly?: boolean;
  category?: 'all' | 'internship' | 'training' | 'entry' | 'grc' | 'cybersecurity' | 'remote';
  limit?: number;
}

export interface JobSearchResult {
  jobs: Job[];
  sources: { source: string; count: number; error?: string }[];
}

export interface MatchResult {
  score: number;
  matched: string[];
  missing: string[];
  notes: string[];
  eligible: boolean | null;
}
