-- JOBBY core schema.
-- Every table is owned by a user and protected by row-level security. The
-- browser only ever holds the publishable anon key, so Postgres is the real
-- authorization boundary. Edge functions use the service role to run agent
-- work on behalf of the authenticated user they verified.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.application_status as enum
    ('discovered','saved','reviewing','ready','submitted','interview','accepted','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.agent_run_status as enum
    ('queued','running','awaiting_approval','completed','failed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.agent_step_status as enum
    ('pending','pending_approval','running','succeeded','failed','denied');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.permission_level as enum ('allow','ask','deny');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.provider_kind as enum ('openrouter','openai_compatible','kilo');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.mcp_provider as enum ('composio','custom');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.mcp_connection_status as enum ('connected','disconnected','error');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.browser_session_status as enum ('starting','active','stopped','error');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.message_role as enum ('user','assistant','system','tool');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- shared trigger
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  country text,
  phone text,
  headline text,
  years_experience integer check (years_experience is null or years_experience between 0 and 70),
  date_of_birth date,
  preferences jsonb not null default '{}'::jsonb,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- create the profile row alongside the auth user
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, full_name)
select u.id, nullif(u.raw_user_meta_data ->> 'full_name', '')
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- skills (built-in rows have no owner)
-- ---------------------------------------------------------------------------
create table if not exists public.user_skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  skill_name text not null check (char_length(skill_name) between 1 and 80),
  proficiency integer not null default 3 check (proficiency between 1 and 5),
  created_at timestamptz not null default now(),
  unique (user_id, skill_name)
);

create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  instructions text not null,
  category text not null default 'career',
  icon text not null default 'sparkles',
  enabled boolean not null default true,
  built_in boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists skills_owner_idx on public.skills (user_id);

-- ---------------------------------------------------------------------------
-- ai providers (credentials live in provider_secrets, never in this table)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider_name text not null check (char_length(provider_name) between 1 and 80),
  kind public.provider_kind not null default 'openai_compatible',
  model_name text not null,
  endpoint text,
  enabled boolean not null default true,
  is_default boolean not null default false,
  fallback_order integer not null default 0,
  has_credential boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_providers_owner_idx on public.ai_providers (user_id, fallback_order);

drop trigger if exists ai_providers_touch on public.ai_providers;
create trigger ai_providers_touch before update on public.ai_providers
  for each row execute function public.touch_updated_at();

-- vault pointer table: RLS on, no policy => readable only by the service role
create table if not exists public.provider_secrets (
  provider_id uuid primary key references public.ai_providers (id) on delete cascade,
  secret_id uuid not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- resumes
-- ---------------------------------------------------------------------------
create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'My CV',
  content jsonb not null default '{}'::jsonb,
  storage_path text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists resumes_owner_idx on public.resumes (user_id, updated_at desc);

drop trigger if exists resumes_touch on public.resumes;
create trigger resumes_touch before update on public.resumes
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- conversations + messages
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New task',
  model text,
  provider_id uuid references public.ai_providers (id) on delete set null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_owner_idx on public.conversations (user_id, updated_at desc);

drop trigger if exists conversations_touch on public.conversations;
create trigger conversations_touch before update on public.conversations
  for each row execute function public.touch_updated_at();

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role public.message_role not null,
  content text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- agent runs / steps
-- ---------------------------------------------------------------------------
create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  status public.agent_run_status not null default 'queued',
  task_plan jsonb,
  result jsonb,
  model text,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists agent_runs_owner_idx on public.agent_runs (user_id, created_at desc);

create table if not exists public.agent_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs (id) on delete cascade,
  tool_name text not null,
  status public.agent_step_status not null default 'pending',
  input_summary text,
  result_summary text,
  input jsonb,
  output jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agent_steps_run_idx on public.agent_steps (run_id, created_at);

-- ---------------------------------------------------------------------------
-- jobs / matches / applications
-- ---------------------------------------------------------------------------
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  company text not null,
  location text,
  country text,
  source text not null,
  external_id text,
  job_url text,
  description text,
  requirements text[] not null default '{}',
  tags text[] not null default '{}',
  salary text,
  remote boolean not null default false,
  deadline date,
  eligibility jsonb not null default '{}'::jsonb,
  posted_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists jobs_source_external_idx
  on public.jobs (source, external_id) where external_id is not null;
create index if not exists jobs_posted_idx on public.jobs (posted_at desc nulls last);

create table if not exists public.job_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  match_score integer not null check (match_score between 0 and 100),
  explanation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, job_id)
);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  resume_id uuid references public.resumes (id) on delete set null,
  status public.application_status not null default 'saved',
  notes text,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_id)
);

create index if not exists applications_owner_idx on public.applications (user_id, updated_at desc);

drop trigger if exists applications_touch on public.applications;
create trigger applications_touch before update on public.applications
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- MCP
-- ---------------------------------------------------------------------------
create table if not exists public.mcp_registry (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  category text not null default 'general',
  auth_mode text not null default 'oauth',
  logo_url text,
  tool_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.mcp_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider public.mcp_provider not null,
  external_account_id text,
  server_url text,
  display_name text not null,
  status public.mcp_connection_status not null default 'connected',
  registry_id uuid references public.mcp_registry (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists mcp_connections_owner_idx on public.mcp_connections (user_id, created_at desc);

create table if not exists public.mcp_connection_secrets (
  connection_id uuid primary key references public.mcp_connections (id) on delete cascade,
  secret_id uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.mcp_connection_tools (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.mcp_connections (id) on delete cascade,
  tool_name text not null,
  description text,
  input_schema jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (connection_id, tool_name)
);

-- ---------------------------------------------------------------------------
-- permissions / browser / audit
-- ---------------------------------------------------------------------------
create table if not exists public.tool_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tool_name text not null,
  permission_level public.permission_level not null default 'ask',
  enabled boolean not null default true,
  unique (user_id, tool_name)
);

create table if not exists public.browser_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  remote_session_id text,
  current_url text,
  status public.browser_session_status not null default 'starting',
  last_screenshot_path text,
  provider text not null default 'playwright',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists browser_sessions_owner_idx
  on public.browser_sessions (user_id, created_at desc);

drop trigger if exists browser_sessions_touch on public.browser_sessions;
create trigger browser_sessions_touch before update on public.browser_sessions
  for each row execute function public.touch_updated_at();

create table if not exists public.tool_execution_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid references public.agent_runs (id) on delete set null,
  tool_name text not null,
  action text not null,
  status text not null default 'succeeded',
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tool_logs_owner_idx
  on public.tool_execution_logs (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_skills enable row level security;
alter table public.skills enable row level security;
alter table public.ai_providers enable row level security;
alter table public.provider_secrets enable row level security;
alter table public.resumes enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_steps enable row level security;
alter table public.jobs enable row level security;
alter table public.job_matches enable row level security;
alter table public.applications enable row level security;
alter table public.mcp_registry enable row level security;
alter table public.mcp_connections enable row level security;
alter table public.mcp_connection_secrets enable row level security;
alter table public.mcp_connection_tools enable row level security;
alter table public.tool_permissions enable row level security;
alter table public.browser_sessions enable row level security;
alter table public.tool_execution_logs enable row level security;

-- profiles: row id is the user id
drop policy if exists profiles_owner on public.profiles;
create policy profiles_owner on public.profiles
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- simple owner tables
do $$
declare
  t text;
begin
  foreach t in array array[
    'user_skills','ai_providers','resumes','conversations','job_matches',
    'applications','mcp_connections','tool_permissions','browser_sessions',
    'tool_execution_logs','agent_runs'
  ]
  loop
    execute format('drop policy if exists %I_owner on public.%I', t, t);
    execute format(
      'create policy %I_owner on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t, t
    );
  end loop;
end $$;

-- messages belong to a conversation owned by the user
drop policy if exists messages_owner on public.messages;
create policy messages_owner on public.messages
  for all to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = (select auth.uid())
    )
  );

-- agent steps belong to a run owned by the user
drop policy if exists agent_steps_owner on public.agent_steps;
create policy agent_steps_owner on public.agent_steps
  for select to authenticated
  using (
    exists (
      select 1 from public.agent_runs r
      where r.id = agent_steps.run_id and r.user_id = (select auth.uid())
    )
  );

-- MCP tools belong to connections owned by the user
drop policy if exists mcp_tools_owner on public.mcp_connection_tools;
create policy mcp_tools_owner on public.mcp_connection_tools
  for all to authenticated
  using (
    exists (
      select 1 from public.mcp_connections c
      where c.id = mcp_connection_tools.connection_id and c.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.mcp_connections c
      where c.id = mcp_connection_tools.connection_id and c.user_id = (select auth.uid())
    )
  );

-- skills: built-in packs are visible to everyone signed in
drop policy if exists skills_read on public.skills;
create policy skills_read on public.skills
  for select to authenticated
  using (built_in or user_id = (select auth.uid()));

drop policy if exists skills_write on public.skills;
create policy skills_write on public.skills
  for all to authenticated
  using (user_id = (select auth.uid()) and not built_in)
  with check (user_id = (select auth.uid()) and not built_in);

-- jobs: public read for signed-in users, writes only via the service role
drop policy if exists jobs_read on public.jobs;
create policy jobs_read on public.jobs
  for select to authenticated
  using (true);

-- registry is reference data
drop policy if exists mcp_registry_read on public.mcp_registry;
create policy mcp_registry_read on public.mcp_registry
  for select to authenticated
  using (true);

-- provider_secrets / mcp_connection_secrets intentionally have no policies:
-- only the service role (edge functions) can touch the vault pointers.

-- ---------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.jobs, public.mcp_registry to authenticated;

-- ---------------------------------------------------------------------------
-- storage buckets (private, one folder per user id)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('resumes', 'resumes', false, 10485760),
  ('attachments', 'attachments', false, 10485760)
on conflict (id) do nothing;

drop policy if exists jobby_storage_read on storage.objects;
create policy jobby_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id in ('resumes','attachments')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists jobby_storage_write on storage.objects;
create policy jobby_storage_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('resumes','attachments')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists jobby_storage_update on storage.objects;
create policy jobby_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('resumes','attachments')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists jobby_storage_delete on storage.objects;
create policy jobby_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('resumes','attachments')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- built-in skills
-- ---------------------------------------------------------------------------
insert into public.skills (user_id, name, description, instructions, category, icon, enabled, built_in)
values
  (
    null,
    'Truth-only applications',
    'Never invents experience, qualifications or certifications.',
    E'Only state facts that appear in the user profile, their saved CVs, or the job listing.\nIf a requirement is missing, say it is missing and suggest a realistic way to address it.\nNever claim a certification, degree, employer, date or metric that the user has not recorded.\nWhen unsure, ask the user for the missing fact instead of guessing.',
    'compliance',
    'shield',
    true,
    true
  ),
  (
    null,
    'Evidence-first matching',
    'Explains every match with the exact requirement it maps to.',
    E'When scoring a role, quote or paraphrase the specific listing requirement behind each match.\nSeparate required from preferred skills.\nUse the transparent 60/20/20 weighting: required skills, preferred skills, eligibility.\nFlag eligibility rules (work authorization, degree, years) explicitly rather than folding them into the score.',
    'career',
    'target',
    true,
    true
  ),
  (
    null,
    'Submission gate',
    'Nothing is submitted externally without explicit approval.',
    E'Treat every external action — submitting an application, sending an email, posting a message — as requiring explicit user approval, regardless of stored permissions.\nBefore an external action, summarise exactly what will be sent and to whom.\nAfter it runs, report the real outcome from the tool. Never claim success you did not observe.',
    'compliance',
    'lock',
    true,
    true
  ),
  (
    null,
    'Concise professional tone',
    'Clear, direct, no filler.',
    E'Write in plain professional English. Lead with the answer, then the detail.\nAvoid hype, emojis and exclamation marks in documents.\nKeep CV bullets to one line each, starting with a strong verb.\nPrefer concrete numbers only when the user has supplied them.',
    'writing',
    'pen',
    true,
    true
  )
on conflict do nothing;
