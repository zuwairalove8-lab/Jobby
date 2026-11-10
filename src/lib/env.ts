/** Typed access to build-time environment configuration. */

const raw = import.meta.env;

export const env = {
  supabaseUrl: (raw.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '',
  supabaseAnonKey: (raw.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? '',
  browserWorkerUrl: (raw.VITE_BROWSER_WORKER_URL as string | undefined)?.trim() ?? '',
  appOrigin: (raw.VITE_APP_ORIGIN as string | undefined)?.trim() ?? '',
} as const;

export const isSupabaseConfigured = env.supabaseUrl.length > 0 && env.supabaseAnonKey.length > 0;

export const isBrowserWorkerConfigured = env.browserWorkerUrl.length > 0;

export const appOrigin = (): string => env.appOrigin || window.location.origin;
