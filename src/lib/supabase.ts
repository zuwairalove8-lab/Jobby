import { createClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from './env';

/**
 * Single browser client. If configuration is missing we still create a client
 * (pointing at a placeholder) so the UI can render an explicit setup screen
 * instead of crashing at import time.
 */
const url = isSupabaseConfigured ? env.supabaseUrl : 'http://localhost:54321';
const key = isSupabaseConfigured ? env.supabaseAnonKey : 'public-anon-key-placeholder';

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
  global: {
    headers: { 'x-jobby-client': 'web' },
  },
});

/** Authenticated fetch against a Supabase edge function, with streaming support. */
export async function callFunction<T>(
  slug: string,
  body: unknown,
  init?: RequestInit,
): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('You must be signed in.');

  const base = env.supabaseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/functions/v1/${slug}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: env.supabaseAnonKey,
    },
    body: JSON.stringify(body),
    ...init,
  });

  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const message =
      (payload as { error?: string } | null)?.error ??
      (payload as { message?: string } | null)?.message ??
      `Request failed (${res.status})`;
    throw new Error(message);
  }
  return payload as T;
}

/** Raw streaming POST used by the chat stream parser. */
export async function streamFunction(
  slug: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('You must be signed in.');

  const base = env.supabaseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/functions/v1/${slug}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${token}`,
      apikey: env.supabaseAnonKey,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Chat request failed (${res.status})`);
  }
  return res;
}
