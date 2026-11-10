import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Blocks,
  Bot,
  Briefcase,
  ClipboardList,
  FileText,
  Globe,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  Menu,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { useAuth } from '../context/AuthProvider';
import { initials } from '../lib/format';
import { Badge, Button } from './ui';

export interface NavItem {
  to: string;
  label: string;
  shortLabel?: string;
  icon: ReactNode;
  group: 'primary' | 'workspace' | 'system';
  mobile?: boolean;
}

const icon = (Component: typeof Bot) => <Component size={17} strokeWidth={1.8} />;

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: icon(LayoutDashboard), group: 'primary', mobile: true },
  { to: '/workspace', label: 'AI Workspace', shortLabel: 'Chat', icon: icon(MessagesSquare), group: 'primary', mobile: true },
  { to: '/browser', label: 'Shared Browser', shortLabel: 'Browser', icon: icon(Globe), group: 'primary', mobile: true },
  { to: '/jobs', label: 'Job Search', shortLabel: 'Jobs', icon: icon(Briefcase), group: 'workspace', mobile: true },
  { to: '/cv', label: 'CV Studio', shortLabel: 'CV', icon: icon(FileText), group: 'workspace' },
  { to: '/applications', label: 'Applications', shortLabel: 'Apps', icon: icon(ClipboardList), group: 'workspace' },
  { to: '/marketplace', label: 'MCP Marketplace', shortLabel: 'Marketplace', icon: icon(Blocks), group: 'workspace' },
  { to: '/agent', label: 'Agent Manager', shortLabel: 'Agent', icon: icon(Sparkles), group: 'system' },
  { to: '/settings', label: 'Settings', icon: icon(Settings), group: 'system', mobile: true },
];

const MOBILE_NAV = NAV_ITEMS.filter((item) => item.mobile);

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-cyan to-violet shadow-lg shadow-cyan/25">
        <Bot size={19} className="text-[#04121c]" strokeWidth={2.2} />
      </div>
      {!compact && (
        <div className="leading-tight">
          <p className="text-[15px] font-semibold tracking-[0.22em] text-ink">JOBBY</p>
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted">Job assistant</p>
        </div>
      )}
    </div>
  );
}

function NavRow({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition',
          isActive
            ? 'bg-raised text-ink shadow-inner shadow-cyan/10 before:absolute before:left-0 before:h-5 before:w-0.5 before:rounded-r before:bg-cyan'
            : 'text-muted hover:bg-raised/60 hover:text-ink',
        )
      }
    >
      <span className="text-current opacity-80">{item.icon}</span>
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { profile, user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const current = NAV_ITEMS.find((item) =>
    item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to),
  );

  const displayName = profile?.full_name ?? user?.email ?? 'Account';
  const email = user?.email ?? '';

  const groups: Array<{ key: NavItem['group']; label: string }> = [
    { key: 'primary', label: 'Workspace' },
    { key: 'workspace', label: 'Career suite' },
    { key: 'system', label: 'System' },
  ];

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line/70 bg-surface/40 px-3 py-4 backdrop-blur lg:flex">
        <div className="px-2">
          <Brand />
        </div>

        <nav className="mt-7 flex-1 space-y-5 overflow-y-auto">
          {groups.map((group) => (
            <div key={group.key}>
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted/60">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {NAV_ITEMS.filter((item) => item.group === group.key).map((item) => (
                  <NavRow key={item.to} item={item} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-3 rounded-xl border border-line/80 bg-bg/50 p-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan/25 to-violet/25 text-xs font-semibold text-ink">
              {initials(displayName)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-ink">{displayName}</p>
              <p className="truncate text-[10px] text-muted">{email}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                void signOut().then(() => navigate('/login'));
              }}
              className="rounded-lg p-1.5 text-muted transition hover:bg-raised hover:text-bad"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line/60 bg-bg/70 px-4 py-3 pt-safe backdrop-blur lg:hidden">
          <Brand compact />
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink">{current?.label ?? 'JOBBY'}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="rounded-lg p-2 text-muted transition hover:bg-raised hover:text-ink"
              aria-label="Open navigation"
            >
              <Menu size={18} />
            </button>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </main>

        {/* Mobile bottom navigation */}
        <nav className="pb-safe flex items-stretch justify-around border-t border-line/70 bg-surface/85 px-1 pt-1 backdrop-blur lg:hidden">
          {MOBILE_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] transition',
                  isActive ? 'text-cyan' : 'text-muted hover:text-ink',
                )
              }
            >
              {item.icon}
              <span>{item.shortLabel ?? item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Mobile full menu */}
      {menuOpen && (
        <div className="fixed inset-0 z-95 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-[78%] max-w-xs border-l border-line bg-surface p-4 pt-safe">
            <div className="mb-5 flex items-center justify-between">
              <Brand />
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="rounded-lg p-2 text-muted hover:bg-raised hover:text-ink"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => (
                <NavRow key={item.to} item={item} onNavigate={() => setMenuOpen(false)} />
              ))}
            </div>
            <div className="mt-5 rounded-xl border border-line bg-bg/60 p-3">
              <div className="flex items-center gap-2.5">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-cyan/25 to-violet/25 text-xs font-semibold">
                  {initials(displayName)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{displayName}</p>
                  <p className="truncate text-[10px] text-muted">{email}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-3 w-full justify-start"
                onClick={() => {
                  void signOut().then(() => navigate('/login'));
                }}
              >
                <LogOut size={14} /> Sign out
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Standard scrolling page container used by every non-chat page. */
export function Page({
  title,
  description,
  actions,
  children,
  badge,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  badge?: string;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-5 lg:px-8 lg:pt-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-ink lg:text-2xl">{title}</h1>
              {badge && <Badge tone="violet">{badge}</Badge>}
            </div>
            {description && (
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}
