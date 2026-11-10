import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Bot, Loader2 } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppShell } from './components/layout';
import { AuthProvider, useAuth } from './context/AuthProvider';
import { ToastProvider } from './context/ToastProvider';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { JobSearchPage } from './pages/JobSearchPage';
import { CvStudioPage } from './pages/CvStudioPage';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { MarketplacePage } from './pages/MarketplacePage';
import { AgentManagerPage } from './pages/AgentManagerPage';
import { BrowserPage } from './pages/BrowserPage';
import { SettingsPage } from './pages/SettingsPage';
import { isSupabaseConfigured } from './lib/env';

function Splash({ label }: { label: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-cyan to-violet shadow-2xl shadow-cyan/25">
        <Bot size={26} className="text-[#04121c]" strokeWidth={2.2} />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <Loader2 size={13} className="animate-spin text-cyan" /> {label}
      </div>
    </div>
  );
}

function Protected() {
  const { status } = useAuth();

  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-md px-6 py-20">
        <h1 className="text-lg font-semibold">Backend not configured</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          JOBBY needs <code className="text-cyan">VITE_SUPABASE_URL</code> and{' '}
          <code className="text-cyan">VITE_SUPABASE_ANON_KEY</code>. Add them to{' '}
          <code>.env</code> for local development, or as repository secrets for the Android build.
        </p>
      </div>
    );
  }

  if (status === 'loading') return <Splash label="Starting JOBBY…" />;
  if (status === 'signed-out') return <Navigate to="/login" replace />;
  return <AppShell />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<Protected />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/workspace" element={<WorkspacePage />} />
                <Route path="/jobs" element={<JobSearchPage />} />
                <Route path="/cv" element={<CvStudioPage />} />
                <Route path="/applications" element={<ApplicationsPage />} />
                <Route path="/marketplace" element={<MarketplacePage />} />
                <Route path="/agent" element={<AgentManagerPage />} />
                <Route path="/browser" element={<BrowserPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
