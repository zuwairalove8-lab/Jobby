import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Blocks,
  Briefcase,
  ClipboardList,
  FileText,
  Globe,
  MessagesSquare,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthProvider';
import { Page } from '../components/layout';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Progress,
  SectionHeading,
  Skeleton,
} from '../components/ui';
import { useAsyncData } from '../hooks/useAsyncData';
import {
  listAgentSkills,
  listApplications,
  listConversations,
  listMcpConnections,
  listResumes,
  listUserSkills,
} from '../services/db';
import { getProviderStatus } from '../services/api';
import { statusTone, timeAgo } from '../lib/format';
import { isBrowserWorkerConfigured } from '../lib/env';
import { cn } from '../lib/cn';

interface DashboardData {
  conversations: number;
  applications: Awaited<ReturnType<typeof listApplications>>;
  resumes: number;
  mcpConnected: number;
  skills: number;
  userSkills: number;
  providerReady: boolean;
  serverKeys: { openrouter: boolean; composio: boolean };
}

export function DashboardPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const userId = user?.id ?? '';

  const { data, loading, error } = useAsyncData<DashboardData>(async () => {
    const [conversations, applications, resumes, connections, skills, userSkills, status] =
      await Promise.allSettled([
        listConversations(userId),
        listApplications(userId),
        listResumes(userId),
        listMcpConnections(userId),
        listAgentSkills(userId),
        listUserSkills(userId),
        getProviderStatus(),
      ]);

    const providerStatus = status.status === 'fulfilled' ? status.value : null;

    return {
      conversations: conversations.status === 'fulfilled' ? conversations.value.length : 0,
      applications: applications.status === 'fulfilled' ? applications.value : [],
      resumes: resumes.status === 'fulfilled' ? resumes.value.length : 0,
      mcpConnected:
        connections.status === 'fulfilled'
          ? connections.value.filter((c) => c.status === 'connected').length
          : 0,
      skills: skills.status === 'fulfilled' ? skills.value.filter((s) => s.enabled).length : 0,
      userSkills: userSkills.status === 'fulfilled' ? userSkills.value.length : 0,
      providerReady: providerStatus?.serverDefaults.openrouter ?? false,
      serverKeys: {
        openrouter: providerStatus?.serverDefaults.openrouter ?? false,
        composio: providerStatus?.serverDefaults.composio ?? false,
      },
    };
  }, [userId]);

  const stats = useMemo(() => {
    const apps = data?.applications ?? [];
    return {
      total: apps.length,
      submitted: apps.filter((a) => a.status === 'submitted').length,
      interview: apps.filter((a) => a.status === 'interview').length,
      saved: apps.filter((a) => a.status === 'saved' || a.status === 'ready').length,
    };
  }, [data]);

  const checklist = useMemo(() => {
    const items = [
      {
        label: 'Complete your profile',
        done: Boolean(profile?.full_name && profile?.country),
        to: '/settings',
        hint: 'Name and country power eligibility checks.',
      },
      {
        label: 'Add your skills',
        done: (data?.userSkills ?? 0) > 0,
        to: '/settings',
        hint: 'Skills drive transparent match scores.',
      },
      {
        label: 'Configure an AI provider',
        done: data?.providerReady ?? false,
        to: '/agent',
        hint: 'OpenRouter is the default; add a key or use your own provider.',
      },
      {
        label: 'Connect an MCP account',
        done: (data?.mcpConnected ?? 0) > 0,
        to: '/marketplace',
        hint: 'Email, calendar and docs tools for the agent.',
      },
      {
        label: 'Start the shared browser',
        done: isBrowserWorkerConfigured,
        to: '/browser',
        hint: 'Needs a remote Playwright worker.',
      },
    ];
    return items;
  }, [profile, data, isBrowserWorkerConfigured]);

  const doneCount = checklist.filter((c) => c.done).length;
  const readiness = Math.round((doneCount / checklist.length) * 100);

  const recent = (data?.applications ?? []).slice(0, 5);

  return (
    <Page
      title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`}
      description="Your agent, pipeline and documents in one place."
      actions={
        <Button variant="primary" onClick={() => navigate('/workspace')}>
          <Sparkles size={15} /> New agent task
        </Button>
      }
    >
      {/* Hero command bar */}
      <button
        type="button"
        onClick={() => navigate('/workspace')}
        className="group mb-6 flex w-full items-center gap-3 rounded-2xl border border-line/80 bg-surface/70 px-4 py-3.5 text-left transition hover:border-cyan/50 hover:bg-surface"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cyan/20 to-violet/20 text-cyan">
          <Zap size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink/90">
            Ask JOBBY to find GRC roles in Kenya, check your fit, and draft a tailored CV…
          </span>
          <span className="mt-0.5 block text-[11px] text-muted">
            Agent runs step by step · every external action needs your approval
          </span>
        </span>
        <ArrowUpRight size={17} className="text-muted transition group-hover:text-cyan" />
      </button>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Conversations', value: data?.conversations ?? 0, icon: MessagesSquare, to: '/workspace' },
          { label: 'Tracked roles', value: stats.total, icon: ClipboardList, to: '/applications' },
          { label: 'Interviews', value: stats.interview, icon: Briefcase, to: '/applications' },
          { label: 'CV versions', value: data?.resumes ?? 0, icon: FileText, to: '/cv' },
        ].map(({ label, value, icon: Icon, to }) => (
          <Link
            key={label}
            to={to}
            className="card group p-4 transition hover:border-cyan/40"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                {label}
              </span>
              <Icon size={15} className="text-muted/60 transition group-hover:text-cyan" />
            </div>
            {loading ? (
              <Skeleton className="mt-3 h-7 w-12" />
            ) : (
              <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
            )}
          </Link>
        ))}
      </div>

      {error && (
        <Card className="mb-6 border-bad/30 bg-bad/5 p-4 text-sm text-bad">
          Some dashboard data could not load: {error}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Readiness */}
        <Card className="p-5 lg:col-span-1">
          <SectionHeading title="Workspace readiness" />
          <div className="mb-4">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-2xl font-semibold tabular-nums">{readiness}%</span>
              <span className="text-[11px] text-muted">
                {doneCount}/{checklist.length} complete
              </span>
            </div>
            <Progress value={readiness} />
          </div>
          <ul className="space-y-2">
            {checklist.map((item) => (
              <li key={item.label}>
                <Link
                  to={item.to}
                  className="flex items-start gap-2.5 rounded-lg px-1.5 py-1.5 transition hover:bg-raised/50"
                >
                  <span
                    className={cn(
                      'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px]',
                      item.done
                        ? 'border-good/60 bg-good/20 text-good'
                        : 'border-line bg-bg/60 text-muted',
                    )}
                  >
                    {item.done ? '✓' : ''}
                  </span>
                  <span className="min-w-0">
                    <span className={cn('block text-xs', item.done ? 'text-muted line-through' : 'text-ink')}>
                      {item.label}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-snug text-muted/70">
                      {item.hint}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        {/* Quick actions */}
        <Card className="p-5 lg:col-span-2">
          <SectionHeading
            title="Jump back in"
            action={
              <Button size="sm" variant="ghost" onClick={() => navigate('/jobs')}>
                Find jobs <ArrowUpRight size={13} />
              </Button>
            }
          />

          <div className="grid gap-2.5 sm:grid-cols-2">
            {[
              {
                title: 'Search live job feeds',
                desc: 'Remotive, Arbeitnow and Himalayas, filtered for you.',
                icon: Briefcase,
                to: '/jobs',
                tone: 'text-cyan',
              },
              {
                title: 'Tailor a CV',
                desc: 'Generate a role-specific version from your profile.',
                icon: FileText,
                to: '/cv',
                tone: 'text-violet',
              },
              {
                title: 'Connect an account',
                desc: 'Email, docs and calendar tools for the agent.',
                icon: Blocks,
                to: '/marketplace',
                tone: 'text-good',
              },
              {
                title: 'Open shared browser',
                desc: 'Same session for you and the agent.',
                icon: Globe,
                to: '/browser',
                tone: 'text-warn',
              },
            ].map((action) => (
              <button
                key={action.title}
                type="button"
                onClick={() => navigate(action.to)}
                className="flex items-start gap-3 rounded-xl border border-line/70 bg-bg/40 p-3.5 text-left transition hover:border-cyan/40 hover:bg-raised/40"
              >
                <action.icon size={17} className={cn('mt-0.5 shrink-0', action.tone)} />
                <span>
                  <span className="block text-sm font-medium text-ink">{action.title}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                    {action.desc}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="mt-5">
            <SectionHeading title="Recent applications" />
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : recent.length === 0 ? (
              <EmptyState
                icon={<ClipboardList size={20} />}
                title="No applications tracked yet"
                description="Save a job from search results and it will appear here with its stage."
                action={
                  <Button size="sm" variant="secondary" onClick={() => navigate('/jobs')}>
                    Browse jobs
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-line/60">
                {recent.map((app) => (
                  <li key={app.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">
                        {app.jobs?.title ?? 'Untitled role'}
                      </p>
                      <p className="truncate text-[11px] text-muted">
                        {app.jobs?.company ?? 'Unknown company'} · updated {timeAgo(app.updated_at)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] capitalize',
                        statusTone(app.status),
                      )}
                    >
                      {app.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <Badge tone={data?.serverKeys.openrouter ? 'good' : 'warn'}>
          {data?.serverKeys.openrouter ? 'OpenRouter default active' : 'No server AI key'}
        </Badge>
        <Badge tone={isBrowserWorkerConfigured ? 'good' : 'neutral'}>
          {isBrowserWorkerConfigured ? 'Browser worker linked' : 'Browser worker not configured'}
        </Badge>
        <Badge tone={data?.serverKeys.composio ? 'good' : 'neutral'}>
          {data?.serverKeys.composio ? 'Composio connected' : 'Composio key missing'}
        </Badge>
      </div>
    </Page>
  );
}
