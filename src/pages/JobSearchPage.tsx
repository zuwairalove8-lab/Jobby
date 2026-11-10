import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  MapPin,
  Search,
  Sparkles,
  TriangleAlert,
  Wifi,
} from 'lucide-react';
import { Page } from '../components/layout';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  Spinner,
} from '../components/ui';
import { matchJob, searchJobs } from '../services/api';
import { listApplications, upsertApplication } from '../services/db';
import { useAuth } from '../context/AuthProvider';
import { useToast } from '../context/ToastProvider';
import { cn } from '../lib/cn';
import { hostOf, shortDate } from '../lib/format';
import type { ApplicationWithJob } from '../services/db';
import type { Job, MatchResult } from '../types';

const CATEGORIES = [
  { id: 'all', label: 'All roles' },
  { id: 'internship', label: 'Internships' },
  { id: 'training', label: 'Training' },
  { id: 'entry', label: 'Entry level' },
  { id: 'grc', label: 'GRC' },
  { id: 'cybersecurity', label: 'Cybersecurity' },
  { id: 'remote', label: 'Remote' },
] as const;

type CategoryId = (typeof CATEGORIES)[number]['id'];

export function JobSearchPage() {
  const { user } = useAuth();
  const toast = useToast();
  const userId = user?.id ?? '';

  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('');
  const [category, setCategory] = useState<CategoryId>('all');
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<{ source: string; count: number; error?: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const [selected, setSelected] = useState<Job | null>(null);
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [matching, setMatching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<ApplicationWithJob[]>([]);

  const savedJobIds = useMemo(
    () => new Set(saved.map((a) => a.job_id).filter(Boolean) as string[]),
    [saved],
  );

  const runSearch = async () => {
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const result = await searchJobs({
        query: query.trim(),
        country: country.trim() || undefined,
        category,
        remoteOnly,
        limit: 24,
      });
      setJobs(result.jobs);
      setSources(result.sources);
      const applications = await listApplications(userId).catch(() => []);
      setSaved(applications);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Job search failed.');
      setJobs([]);
      setSources([]);
    } finally {
      setLoading(false);
    }
  };

  const openJob = (job: Job) => {
    setSelected(job);
    setMatch(null);
  };

  const checkMatch = async (job: Job) => {
    setMatching(true);
    try {
      const result = await matchJob(job.id);
      setMatch(result);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not score this role.', 'error');
    } finally {
      setMatching(false);
    }
  };

  const saveToTracker = async (job: Job) => {
    setSaving(true);
    try {
      await upsertApplication({ userId, jobId: job.id, status: 'saved' });
      const applications = await listApplications(userId);
      setSaved(applications);
      toast('Saved to your application tracker.', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save this role.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page
      title="Job Search"
      description="Live listings from public job feeds, with transparent match scoring against your profile."
      actions={
        <Badge tone="cyan">
          {jobs.length > 0 ? `${jobs.length} results` : 'Public feeds'}
        </Badge>
      }
    >
      <Card className="mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_14rem_auto]">
          <Field label="Search" htmlFor="job-query">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <Input
                id="job-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void runSearch();
                }}
                placeholder="GRC analyst, SOC, IT support…"
                className="pl-9"
              />
            </div>
          </Field>
          <Field label="Country (optional)" htmlFor="job-country">
            <Input
              id="job-country"
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              placeholder="Kenya"
              onKeyDown={(event) => {
                if (event.key === 'Enter') void runSearch();
              }}
            />
          </Field>
          <div className="flex items-end">
            <Button
              variant="primary"
              className="w-full sm:w-auto"
              onClick={() => void runSearch()}
              loading={loading}
            >
              <Search size={15} /> Search
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCategory(item.id)}
              className={cn(
                'rounded-full border px-3 py-1 text-[11px] transition',
                category === item.id
                  ? 'border-cyan/50 bg-cyan/10 text-cyan'
                  : 'border-line text-muted hover:border-cyan/30 hover:text-ink',
              )}
            >
              {item.label}
            </button>
          ))}
          <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={remoteOnly}
              onChange={(event) => setRemoteOnly(event.target.checked)}
              className="h-3.5 w-3.5 accent-[#00d4ff]"
            />
            Remote only
          </label>
        </div>
      </Card>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {sources.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {sources.map((source) => (
            <Badge key={source.source} tone={source.error ? 'warn' : 'neutral'}>
              {source.source}: {source.error ? 'unavailable' : `${source.count} listings`}
            </Badge>
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card h-40 animate-pulse p-4" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={<BriefcaseBusiness size={22} />}
          title={searched ? 'No listings matched that search' : 'Search live job feeds'}
          description={
            searched
              ? 'Try a broader keyword, remove the country filter, or switch category to All roles.'
              : 'JOBBY queries public feeds (Remotive, Arbeitnow, Himalayas) server-side. Nothing is invented — results are exactly what the feeds returned.'
          }
          action={
            !searched ? (
              <Button variant="secondary" size="sm" onClick={() => void runSearch()}>
                Run a broad search
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {jobs.map((job) => {
            const isSaved = job.id ? savedJobIds.has(job.id) : false;
            return (
              <Card key={job.id} className="flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => openJob(job)}
                      className="block truncate text-left text-sm font-semibold text-ink hover:text-cyan"
                    >
                      {job.title}
                    </button>
                    <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted">
                      <Building2 size={11} /> {job.company}
                    </p>
                  </div>
                  <Badge tone="neutral">{job.source}</Badge>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={11} /> {job.location || 'Not specified'}
                  </span>
                  {job.remote && (
                    <span className="inline-flex items-center gap-1 text-cyan">
                      <Wifi size={11} /> Remote
                    </span>
                  )}
                  {job.deadline && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock size={11} /> {shortDate(job.deadline)}
                    </span>
                  )}
                </div>

                {job.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {job.tags.slice(0, 5).map((tag) => (
                      <span key={tag} className="chip">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-auto flex items-center gap-1.5 pt-3">
                  <Button size="sm" variant="secondary" onClick={() => openJob(job)}>
                    Details & match
                  </Button>
                  <Button
                    size="sm"
                    variant={isSaved ? 'ghost' : 'outline'}
                    onClick={() => void saveToTracker(job)}
                    loading={saving}
                    disabled={isSaved}
                  >
                    {isSaved ? (
                      <>
                        <CheckCircle2 size={13} /> Saved
                      </>
                    ) : (
                      'Save'
                    )}
                  </Button>
                  {job.job_url && (
                    <a
                      href={job.job_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted hover:text-cyan"
                    >
                      {hostOf(job.job_url)} <ArrowUpRight size={11} />
                    </a>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.title ?? 'Role'}
        description={selected ? `${selected.company} · ${selected.location ?? 'Location not stated'}` : undefined}
        footer={
          selected && (
            <>
              {selected.job_url && (
                <a
                  href={selected.job_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mr-auto inline-flex items-center gap-1 text-xs text-cyan hover:underline"
                >
                  Open original <ExternalLink size={12} />
                </a>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void checkMatch(selected)}
                loading={matching}
              >
                <Sparkles size={13} /> Match me
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => void saveToTracker(selected)}
                loading={saving}
                disabled={savedJobIds.has(selected.id)}
              >
                {savedJobIds.has(selected.id) ? 'In tracker' : 'Save to tracker'}
              </Button>
            </>
          )
        }
      >
        {selected && (
          <div className="space-y-3.5">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="neutral">{selected.source}</Badge>
              {selected.remote && <Badge tone="cyan">Remote</Badge>}
              {selected.salary && <Badge tone="good">{selected.salary}</Badge>}
              {selected.deadline && <Badge tone="warn">Closes {shortDate(selected.deadline)}</Badge>}
            </div>

            {matching && (
              <div className="flex items-center gap-2 rounded-xl border border-line bg-raised/40 p-3 text-xs text-muted">
                <Spinner size={14} /> Scoring this role against your profile…
              </div>
            )}

            {match && (
              <div className="rounded-xl border border-line bg-bg/40 p-3.5">
                <div className="flex items-center gap-3">
                  <div className="grid h-14 w-14 place-items-center rounded-full border-2 border-cyan/50 bg-cyan/5">
                    <span className="text-lg font-semibold text-cyan">{match.score}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Transparent match score</p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      60% required skills · 20% preferred · 20% eligibility
                    </p>
                    {match.eligible === false && (
                      <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-warn">
                        <TriangleAlert size={11} /> An eligibility rule may exclude you — read the
                        notes.
                      </p>
                    )}
                  </div>
                </div>

                {match.matched.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-good">
                      Matched
                    </p>
                    <ul className="mt-1 space-y-0.5 text-[11px] text-ink/80">
                      {match.matched.slice(0, 8).map((item) => (
                        <li key={item}>✓ {item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {match.missing.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-bad">
                      Missing requirements
                    </p>
                    <ul className="mt-1 space-y-0.5 text-[11px] text-ink/80">
                      {match.missing.map((item) => (
                        <li key={item}>✗ {item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {match.notes.length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-line/60 pt-2 text-[11px] text-muted">
                    {match.notes.map((note) => (
                      <li key={note}>• {note}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {selected.requirements.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Extracted requirements
                </p>
                <ul className="space-y-0.5 text-xs text-ink/80">
                  {selected.requirements.slice(0, 12).map((req) => (
                    <li key={req}>• {req}</li>
                  ))}
                </ul>
              </div>
            )}

            {selected.description && (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Listing description
                </p>
                <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line/60 bg-bg/40 p-3 text-xs leading-relaxed text-ink/80">
                  {selected.description}
                </div>
              </div>
            )}

            <p className="text-[10px] leading-relaxed text-muted/70">
              JOBBY never invents qualifications. Eligibility and deadlines come from the listing
              text — always confirm on the employer's site before applying.
            </p>
          </div>
        )}
      </Modal>
    </Page>
  );
}
