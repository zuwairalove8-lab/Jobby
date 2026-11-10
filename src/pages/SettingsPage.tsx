import { useEffect, useState } from 'react';
import {
  BadgeCheck,
  Bot,
  Database,
  Globe,
  LogOut,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Page } from '../components/layout';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  InfoNote,
  SectionHeading,
  Select,
  Skeleton,
  Switch,
  Textarea,
} from '../components/ui';
import { useAuth } from '../context/AuthProvider';
import { useToast } from '../context/ToastProvider';
import {
  addUserSkill,
  listUserSkills,
  removeUserSkill,
  updateProfile,
} from '../services/db';
import { getProviderStatus } from '../services/api';
import type { UserSkill } from '../types';
import { isBrowserWorkerConfigured, isSupabaseConfigured } from '../lib/env';
import { titleCase } from '../lib/format';

const COUNTRIES = [
  'Kenya', 'Nigeria', 'South Africa', 'Ghana', 'Uganda', 'Tanzania', 'Rwanda', 'Egypt',
  'Morocco', 'India', 'Pakistan', 'Bangladesh', 'Philippines', 'Indonesia', 'Malaysia',
  'United Arab Emirates', 'Saudi Arabia', 'Qatar', 'United Kingdom', 'Ireland', 'Germany',
  'Netherlands', 'France', 'Spain', 'Poland', 'Portugal', 'Canada', 'United States',
  'Brazil', 'Mexico', 'Australia', 'New Zealand', 'Other',
];

export function SettingsPage() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const userId = user?.id ?? '';

  const [form, setForm] = useState({
    full_name: '',
    country: '',
    headline: '',
    phone: '',
    years_experience: '',
    date_of_birth: '',
    remote_only: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<UserSkill[]>([]);
  const [skillInput, setSkillInput] = useState('');
  const [skillLevel, setSkillLevel] = useState('3');
  const [status, setStatus] = useState<{
    serverDefaults: { openrouter: boolean; composio: boolean; browserWorker: boolean };
    vault: boolean;
  } | null>(null);
  const [loadingSkills, setLoadingSkills] = useState(true);

  useEffect(() => {
    if (!profile) return;
    setForm({
      full_name: profile.full_name ?? '',
      country: profile.country ?? '',
      headline: profile.headline ?? '',
      phone: profile.phone ?? '',
      years_experience: profile.years_experience != null ? String(profile.years_experience) : '',
      date_of_birth: profile.date_of_birth ?? '',
      remote_only: Boolean((profile.preferences as { remote_only?: boolean })?.remote_only),
    });
  }, [profile]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    listUserSkills(userId)
      .then((rows) => {
        if (!cancelled) setSkills(rows);
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSkills(false);
      });
    void getProviderStatus()
      .then((value) => {
        if (!cancelled) setStatus(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const saveProfile = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateProfile(userId, {
        full_name: form.full_name.trim() || null,
        country: form.country || null,
        headline: form.headline.trim() || null,
        phone: form.phone.trim() || null,
        years_experience: form.years_experience ? Number(form.years_experience) : null,
        date_of_birth: form.date_of_birth || null,
        preferences: { ...(profile?.preferences ?? {}), remote_only: form.remote_only },
        onboarded: true,
      });
      await refreshProfile();
      toast('Profile saved.', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };

  const addSkill = async () => {
    const name = skillInput.trim();
    if (!name) return;
    try {
      const created = await addUserSkill(userId, name, Number(skillLevel));
      setSkills((prev) => [...prev.filter((s) => s.id !== created.id), created]);
      setSkillInput('');
      toast('Skill added.', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add that skill.', 'error');
    }
  };

  const removeSkill = async (id: string) => {
    try {
      await removeUserSkill(id);
      setSkills((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not remove that skill.', 'error');
    }
  };

  return (
    <Page
      title="Settings"
      description="Your profile powers eligibility checks and match scores. Nothing here is shared with employers automatically."
      actions={
        <Button variant="primary" size="sm" onClick={() => void saveProfile()} loading={saving}>
          Save profile
        </Button>
      }
    >
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <SectionHeading title="Profile" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name">
              <Input
                value={form.full_name}
                onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))}
                placeholder="Ada Lovelace"
                autoComplete="name"
              />
            </Field>
            <Field label="Country" hint="Used for location eligibility.">
              <Select
                value={form.country}
                onChange={(event) => setForm((prev) => ({ ...prev, country: event.target.value }))}
              >
                <option value="">Not set</option>
                {COUNTRIES.map((country) => (
                  <option key={country} value={country}>
                    {country}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Headline">
              <Input
                value={form.headline}
                onChange={(event) => setForm((prev) => ({ ...prev, headline: event.target.value }))}
                placeholder="IT support · GRC enthusiast"
              />
            </Field>
            <Field label="Phone">
              <Input
                value={form.phone}
                onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                placeholder="+254 …"
                autoComplete="tel"
              />
            </Field>
            <Field label="Years of experience">
              <Input
                type="number"
                min={0}
                max={60}
                value={form.years_experience}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, years_experience: event.target.value }))
                }
                placeholder="3"
              />
            </Field>
            <Field
              label="Date of birth (optional)"
              hint="Only used to check age-restricted listings. Age is never shown to employers."
            >
              <Input
                type="date"
                value={form.date_of_birth}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, date_of_birth: event.target.value }))
                }
              />
            </Field>
          </div>

          <div className="mt-4 flex items-center justify-between rounded-xl border border-line/70 bg-bg/30 px-3 py-2.5">
            <div>
              <p className="text-xs font-medium text-ink">Prefer remote roles</p>
              <p className="text-[10px] text-muted">
                Adds a remote filter hint to job searches and agent planning.
              </p>
            </div>
            <Switch
              checked={form.remote_only}
              onChange={(next) => setForm((prev) => ({ ...prev, remote_only: next }))}
              label="Prefer remote roles"
            />
          </div>

          <div className="mt-4">
            <SectionHeading title="Skills" subtitle="These drive the 60-point required-skill score." />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={skillInput}
                onChange={(event) => setSkillInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void addSkill();
                  }
                }}
                placeholder="Risk assessment"
                className="flex-1"
              />
              <Select
                value={skillLevel}
                onChange={(event) => setSkillLevel(event.target.value)}
                aria-label="Proficiency"
                className="sm:w-36"
              >
                <option value="1">Beginner</option>
                <option value="2">Basic</option>
                <option value="3">Intermediate</option>
                <option value="4">Advanced</option>
                <option value="5">Expert</option>
              </Select>
              <Button variant="secondary" onClick={() => void addSkill()}>
                <Plus size={14} /> Add
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {loadingSkills ? (
                <Skeleton className="h-7 w-40" />
              ) : skills.length === 0 ? (
                <p className="text-[11px] text-muted">
                  No skills yet. Add at least a few so match scores mean something.
                </p>
              ) : (
                skills.map((skill) => (
                  <span
                    key={skill.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raised/60 px-2.5 py-1 text-[11px] text-ink/85"
                  >
                    {skill.skill_name}
                    <span className="text-[9px] text-muted">{titleCase(['', 'beginner', 'basic', 'intermediate', 'advanced', 'expert'][skill.proficiency] ?? 'intermediate')}</span>
                    <button
                      type="button"
                      onClick={() => void removeSkill(skill.id)}
                      className="text-muted hover:text-bad"
                      aria-label={`Remove ${skill.skill_name}`}
                    >
                      <Trash2 size={10} />
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <SectionHeading title="Account" />
            <div className="flex items-center gap-2.5">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-cyan/25 to-violet/25">
                <UserRound size={17} className="text-cyan" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{profile?.full_name ?? 'No name set'}</p>
                <p className="truncate text-[10px] text-muted">{user?.email}</p>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted">Onboarding</span>
                <Badge tone={profile?.onboarded ? 'good' : 'warn'}>
                  {profile?.onboarded ? 'complete' : 'incomplete'}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted">Member since</span>
                <span className="text-ink/80">
                  {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 w-full justify-start text-bad hover:bg-bad/10"
              onClick={() => {
                void signOut().then(() => navigate('/login'));
              }}
            >
              <LogOut size={13} /> Sign out
            </Button>
          </Card>

          <Card className="p-4">
            <SectionHeading title="System status" />
            <ul className="space-y-2 text-[11px]">
              {[
                {
                  icon: Database,
                  label: 'Supabase',
                  ok: isSupabaseConfigured,
                  detail: isSupabaseConfigured ? 'connected' : 'missing env vars',
                },
                {
                  icon: Bot,
                  label: 'OpenRouter default',
                  ok: status?.serverDefaults.openrouter ?? false,
                  detail: status?.serverDefaults.openrouter ? 'server key present' : 'add a key',
                },
                {
                  icon: ShieldCheck,
                  label: 'Composio',
                  ok: status?.serverDefaults.composio ?? false,
                  detail: status?.serverDefaults.composio ? 'configured' : 'no key',
                },
                {
                  icon: Globe,
                  label: 'Browser worker',
                  ok: isBrowserWorkerConfigured,
                  detail: isBrowserWorkerConfigured ? 'linked' : 'not configured',
                },
                {
                  icon: BadgeCheck,
                  label: 'Credential vault',
                  ok: status?.vault ?? false,
                  detail: status?.vault ? 'available' : 'unavailable',
                },
              ].map((row) => (
                <li key={row.label} className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-muted">
                    <row.icon size={12} /> {row.label}
                  </span>
                  <span className={row.ok ? 'text-good' : 'text-warn'}>{row.detail}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <InfoNote>
                Secrets live in Supabase Edge Function secrets and the project's Settings → Secrets.
                They are never written to this app's bundle or database tables.
              </InfoNote>
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <Textarea
          className="hidden"
          readOnly
          value={`JOBBY · ${window.location.origin}`}
          aria-hidden
        />
      </div>
    </Page>
  );
}
