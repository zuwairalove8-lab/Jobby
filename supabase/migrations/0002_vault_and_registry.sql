-- Vault helpers and reference data.
-- Edge functions run as the service role; these SECURITY DEFINER functions are
-- the only path to encrypted provider credentials. Clients cannot execute them.

create or replace function public.jobby_store_secret(p_secret text, p_name text default 'jobby')
returns uuid
language plpgsql
security definer
set search_path = vault, public
as $$
declare
  v_id uuid;
begin
  if p_secret is null or length(p_secret) < 8 then
    raise exception 'secret is too short';
  end if;
  v_id := vault.create_secret(p_secret, p_name || '-' || encode(gen_random_bytes(4), 'hex'), 'JOBBY managed credential');
  return v_id;
end;
$$;

create or replace function public.jobby_update_secret(p_id uuid, p_secret text)
returns uuid
language plpgsql
security definer
set search_path = vault, public
as $$
begin
  if p_secret is null or length(p_secret) < 8 then
    raise exception 'secret is too short';
  end if;
  perform vault.update_secret(p_id, p_secret);
  return p_id;
end;
$$;

create or replace function public.jobby_read_secret(p_id uuid)
returns text
language sql
security definer
set search_path = vault, public
as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_id;
$$;

create or replace function public.jobby_delete_secret(p_id uuid)
returns void
language plpgsql
security definer
set search_path = vault, public
as $$
begin
  delete from vault.secrets where id = p_id;
end;
$$;

revoke all on function public.jobby_store_secret(text, text) from public, anon, authenticated;
revoke all on function public.jobby_update_secret(uuid, text) from public, anon, authenticated;
revoke all on function public.jobby_read_secret(uuid) from public, anon, authenticated;
revoke all on function public.jobby_delete_secret(uuid) from public, anon, authenticated;

grant execute on function public.jobby_store_secret(text, text) to service_role;
grant execute on function public.jobby_update_secret(uuid, text) to service_role;
grant execute on function public.jobby_read_secret(uuid) to service_role;
grant execute on function public.jobby_delete_secret(uuid) to service_role;

-- Reference catalogue of real Composio toolkits. It is only used to render the
-- marketplace before a Composio account key is configured; tools themselves are
-- always fetched live from the provider.
insert into public.mcp_registry (slug, name, description, category, auth_mode, tool_count)
values
  ('gmail', 'Gmail', 'Read, search and send email with your own account.', 'email', 'oauth2', 12),
  ('googlecalendar', 'Google Calendar', 'List events and schedule interviews.', 'calendar', 'oauth2', 8),
  ('googledrive', 'Google Drive', 'Read and store documents in your drive.', 'documents', 'oauth2', 9),
  ('googledocs', 'Google Docs', 'Create and edit documents.', 'documents', 'oauth2', 7),
  ('notion', 'Notion', 'Search pages and create notes or trackers.', 'documents', 'oauth2', 10),
  ('slack', 'Slack', 'Send messages and read channels.', 'communication', 'oauth2', 11),
  ('github', 'GitHub', 'Read repositories, issues and pull requests.', 'development', 'oauth2', 20),
  ('linkedin', 'LinkedIn', 'Research companies and job posts.', 'job search', 'oauth2', 5)
on conflict (slug) do nothing;
