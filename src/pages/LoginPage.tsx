import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ArrowRight, Bot, Briefcase, Globe2, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthProvider';
import { Button, Card, ErrorNote, Field, Input } from '../components/ui';
import { isSupabaseConfigured } from '../lib/env';

type Mode = 'signin' | 'signup';

export function LoginPage() {
  const { status, signIn, signUp } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <Card className="max-w-md p-6">
          <h1 className="text-lg font-semibold">Supabase is not configured</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Set <code className="text-cyan">VITE_SUPABASE_URL</code> and{' '}
            <code className="text-cyan">VITE_SUPABASE_ANON_KEY</code> in your environment (or as
            GitHub Actions secrets for the APK build), then reload.
          </p>
        </Card>
      </div>
    );
  }

  if (status === 'signed-in') {
    const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={redirectTo} replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
      } else {
        const { needsConfirmation } = await signUp(email.trim(), password, fullName.trim());
        if (needsConfirmation) {
          setNotice('Check your inbox to confirm your email address, then sign in.');
          setMode('signin');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-line/60 bg-surface/30 p-10 lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-cyan to-violet shadow-xl shadow-cyan/25">
            <Bot size={22} className="text-[#04121c]" strokeWidth={2.2} />
          </div>
          <div>
            <p className="text-lg font-semibold tracking-[0.28em]">JOBBY</p>
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted">
              Autonomous job assistant
            </p>
          </div>
        </div>

        <div className="max-w-md">
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight">
            An agent that finds the job,
            <span className="bg-gradient-to-r from-cyan to-violet bg-clip-text text-transparent">
              {' '}
              tailors the CV
            </span>
            , and keeps the paperwork moving.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            One workspace for discovery, evaluation, tailored documents and applications — with a
            shared browser you can hand over to the agent, and permissions you keep.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-ink/80">
            {[
              { icon: Sparkles, text: 'Multi-step agent with tool approvals and audit logs' },
              { icon: Briefcase, text: 'Job search across public feeds, with transparent match scores' },
              { icon: Globe2, text: 'Shared remote browser — you and the agent, same session' },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2.5">
                <Icon size={16} className="mt-0.5 shrink-0 text-cyan" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] leading-relaxed text-muted/60">
          JOBBY never fabricates qualifications or submits an application without your explicit
          approval.
        </p>
      </div>

      {/* Auth panel */}
      <div className="flex items-center justify-center p-5 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-7 flex items-center gap-2.5 lg:hidden">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-cyan to-violet">
              <Bot size={18} className="text-[#04121c]" />
            </div>
            <p className="text-base font-semibold tracking-[0.26em]">JOBBY</p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">
            {mode === 'signin' ? 'Welcome back' : 'Create your workspace'}
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            {mode === 'signin'
              ? 'Sign in to your agent, conversations and applications.'
              : 'Your data stays in your own Supabase project, protected by row-level security.'}
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-3.5">
            {mode === 'signup' && (
              <Field label="Full name" htmlFor="name">
                <Input
                  id="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ada Lovelace"
                  autoComplete="name"
                  required
                />
              </Field>
            )}
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </Field>
            <Field
              label="Password"
              htmlFor="password"
              hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
            >
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                minLength={mode === 'signup' ? 8 : undefined}
                required
              />
            </Field>

            {error && <ErrorNote>{error}</ErrorNote>}
            {notice && (
              <div className="rounded-xl border border-cyan/30 bg-cyan/10 px-3.5 py-2.5 text-xs text-cyan">
                {notice}
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
              {mode === 'signin' ? 'Sign in' : 'Create account'}
              <ArrowRight size={16} />
            </Button>
          </form>

          <p className="mt-5 text-center text-xs text-muted">
            {mode === 'signin' ? 'New to JOBBY?' : 'Already have an account?'}{' '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setError(null);
                setNotice(null);
              }}
              className="font-medium text-cyan hover:underline"
            >
              {mode === 'signin' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
