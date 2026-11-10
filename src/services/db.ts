import { supabase } from '../lib/supabase';
import type {
  AiProvider,
  Application,
  ApplicationStatus,
  BrowserSession,
  Conversation,
  Job,
  McpConnection,
  McpTool,
  Message,
  PermissionLevel,
  Profile,
  Resume,
  Skill,
  ToolExecutionLog,
  ToolPermission,
  UserSkill,
} from '../types';

/**
 * Thin, typed data-access layer. Every query runs as the signed-in user, so
 * Postgres row-level security is the real authorization boundary — the client
 * never gets to choose whose rows it can see.
 */

function unwrap<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return data as T;
}

/* ---------------------------------- profile -------------------------------- */

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  return unwrap<Profile | null>(data, error);
}

export async function updateProfile(
  userId: string,
  patch: Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>,
): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select('*')
    .single();
  return unwrap<Profile>(data, error);
}

/* ----------------------------------- skills -------------------------------- */

export async function listUserSkills(userId: string): Promise<UserSkill[]> {
  const { data, error } = await supabase
    .from('user_skills')
    .select('*')
    .eq('user_id', userId)
    .order('skill_name');
  return unwrap<UserSkill[]>(data ?? [], error);
}

export async function addUserSkill(
  userId: string,
  skillName: string,
  proficiency = 3,
): Promise<UserSkill> {
  const { data, error } = await supabase
    .from('user_skills')
    .upsert(
      { user_id: userId, skill_name: skillName.trim(), proficiency },
      { onConflict: 'user_id,skill_name' },
    )
    .select('*')
    .single();
  return unwrap<UserSkill>(data, error);
}

export async function removeUserSkill(id: string): Promise<void> {
  const { error } = await supabase.from('user_skills').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/* ------------------------------ conversations ------------------------------ */

export async function listConversations(userId: string): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .eq('archived', false)
    .order('updated_at', { ascending: false })
    .limit(100);
  return unwrap<Conversation[]>(data ?? [], error);
}

export async function createConversation(
  userId: string,
  title: string,
  model: string | null = null,
): Promise<Conversation> {
  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_id: userId, title: title.slice(0, 120), model })
    .select('*')
    .single();
  return unwrap<Conversation>(data, error);
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({ title: title.slice(0, 120), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteConversation(id: string): Promise<void> {
  const { error } = await supabase.from('conversations').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(500);
  return unwrap<Message[]>(data ?? [], error);
}

export async function insertUserMessage(
  conversationId: string,
  content: string,
  metadata: Record<string, unknown> = {},
): Promise<Message> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, role: 'user', content, metadata })
    .select('*')
    .single();
  return unwrap<Message>(data, error);
}

/* ---------------------------------- resumes -------------------------------- */

export async function listResumes(userId: string): Promise<Resume[]> {
  const { data, error } = await supabase
    .from('resumes')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  return unwrap<Resume[]>(data ?? [], error);
}

export async function createResume(
  userId: string,
  title: string,
  content: Resume['content'],
): Promise<Resume> {
  const { data, error } = await supabase
    .from('resumes')
    .insert({ user_id: userId, title, content })
    .select('*')
    .single();
  return unwrap<Resume>(data, error);
}

export async function updateResume(
  id: string,
  patch: Partial<Pick<Resume, 'title' | 'content' | 'is_primary' | 'storage_path'>>,
): Promise<Resume> {
  const { data, error } = await supabase
    .from('resumes')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  return unwrap<Resume>(data, error);
}

export async function deleteResume(id: string): Promise<void> {
  const { error } = await supabase.from('resumes').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Upload a CV/document into the private `resumes` bucket under the user's folder. */
export async function uploadResumeFile(userId: string, file: File): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const path = `${userId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from('resumes').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'application/octet-stream',
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function uploadAttachment(userId: string, file: File): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const path = `${userId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from('attachments').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'application/octet-stream',
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function createAttachmentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('attachments').createSignedUrl(path, 300);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function createResumeDownloadUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('resumes').createSignedUrl(path, 300);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/* ------------------------------- applications ------------------------------ */

export type ApplicationWithJob = Application & { jobs: Job | null };

export async function listApplications(userId: string): Promise<ApplicationWithJob[]> {
  const { data, error } = await supabase
    .from('applications')
    .select('*, jobs(*)')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(300);
  return unwrap<ApplicationWithJob[]>(data ?? [], error);
}

export async function upsertApplication(input: {
  userId: string;
  jobId: string | null;
  status: ApplicationStatus;
  resumeId?: string | null;
  notes?: string | null;
}): Promise<Application> {
  const { data, error } = await supabase
    .from('applications')
    .upsert(
      {
        user_id: input.userId,
        job_id: input.jobId,
        status: input.status,
        resume_id: input.resumeId ?? null,
        notes: input.notes ?? null,
        applied_at: input.status === 'submitted' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,job_id' },
    )
    .select('*')
    .single();
  return unwrap<Application>(data, error);
}

export async function updateApplication(
  id: string,
  patch: Partial<Pick<Application, 'status' | 'notes' | 'resume_id'>>,
): Promise<void> {
  const { error } = await supabase
    .from('applications')
    .update({
      ...patch,
      applied_at: patch.status === 'submitted' ? new Date().toISOString() : undefined,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteApplication(id: string): Promise<void> {
  const { error } = await supabase.from('applications').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/* --------------------------------- providers ------------------------------- */

export async function listProviders(userId: string): Promise<AiProvider[]> {
  const { data, error } = await supabase
    .from('ai_providers')
    .select('*')
    .eq('user_id', userId)
    .order('fallback_order', { ascending: true })
    .order('created_at', { ascending: true });
  return unwrap<AiProvider[]>(data ?? [], error);
}

export async function upsertProvider(
  provider: Partial<AiProvider> & { user_id: string; provider_name: string; model_name: string },
): Promise<AiProvider> {
  const payload = {
    ...provider,
    updated_at: new Date().toISOString(),
  };
  const query = provider.id
    ? supabase.from('ai_providers').update(payload).eq('id', provider.id)
    : supabase.from('ai_providers').insert(payload);
  const { data, error } = await query.select('*').single();
  return unwrap<AiProvider>(data, error);
}

export async function deleteProvider(id: string): Promise<void> {
  const { error } = await supabase.from('ai_providers').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setDefaultProvider(userId: string, providerId: string | null): Promise<void> {
  const { error } = await supabase
    .from('ai_providers')
    .update({ is_default: false })
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  if (providerId) {
    const { error: secondError } = await supabase
      .from('ai_providers')
      .update({ is_default: true, enabled: true })
      .eq('id', providerId);
    if (secondError) throw new Error(secondError.message);
  }
}

/* -------------------------------- permissions ------------------------------ */

export async function listToolPermissions(userId: string): Promise<ToolPermission[]> {
  const { data, error } = await supabase
    .from('tool_permissions')
    .select('*')
    .eq('user_id', userId)
    .order('tool_name');
  return unwrap<ToolPermission[]>(data ?? [], error);
}

export async function setToolPermission(
  userId: string,
  toolName: string,
  permissionLevel: PermissionLevel,
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase.from('tool_permissions').upsert(
    {
      user_id: userId,
      tool_name: toolName,
      permission_level: permissionLevel,
      enabled,
    },
    { onConflict: 'user_id,tool_name' },
  );
  if (error) throw new Error(error.message);
}

/* ------------------------------------ MCP ---------------------------------- */

export async function listMcpConnections(userId: string): Promise<McpConnection[]> {
  const { data, error } = await supabase
    .from('mcp_connections')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return unwrap<McpConnection[]>(data ?? [], error);
}

export async function listMcpTools(connectionIds: string[]): Promise<McpTool[]> {
  if (connectionIds.length === 0) return [];
  const { data, error } = await supabase
    .from('mcp_connection_tools')
    .select('*')
    .in('connection_id', connectionIds)
    .order('tool_name');
  return unwrap<McpTool[]>(data ?? [], error);
}

export async function setMcpToolEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('mcp_connection_tools')
    .update({ enabled })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/* ---------------------------------- browser -------------------------------- */

export async function getBrowserSession(userId: string): Promise<BrowserSession | null> {
  const { data, error } = await supabase
    .from('browser_sessions')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['starting', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return unwrap<BrowserSession | null>(data, error);
}

/* ---------------------------------- skills --------------------------------- */

export async function listAgentSkills(userId: string): Promise<Skill[]> {
  const { data, error } = await supabase
    .from('skills')
    .select('*')
    .or(`user_id.eq.${userId},built_in.eq.true`)
    .order('built_in', { ascending: false })
    .order('name');
  return unwrap<Skill[]>(data ?? [], error);
}

export async function createAgentSkill(
  userId: string,
  skill: Pick<Skill, 'name' | 'description' | 'instructions' | 'category' | 'icon'>,
): Promise<Skill> {
  const { data, error } = await supabase
    .from('skills')
    .insert({ ...skill, user_id: userId, built_in: false, enabled: true })
    .select('*')
    .single();
  return unwrap<Skill>(data, error);
}

export async function setAgentSkillEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.from('skills').update({ enabled }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteAgentSkill(id: string): Promise<void> {
  const { error } = await supabase.from('skills').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/* ----------------------------------- logs ---------------------------------- */

export async function listToolLogs(userId: string, limit = 40): Promise<ToolExecutionLog[]> {
  const { data, error } = await supabase
    .from('tool_execution_logs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return unwrap<ToolExecutionLog[]>(data ?? [], error);
}
