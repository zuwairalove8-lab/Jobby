import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, ClipboardList, FileText, StickyNote, Trash2 } from 'lucide-react';
import { Page } from '../components/layout';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Modal,
  Select,
  Skeleton,
  Textarea,
} from '../components/ui';
import { useAuth } from '../context/AuthProvider';
import { useToast } from '../context/ToastProvider';
import {
  deleteApplication,
  listApplications,
  updateApplication,
  type ApplicationWithJob,
} from '../services/db';
import { APPLICATION_STATUSES, type ApplicationStatus } from '../types';
import { hostOf, shortDate, statusTone, timeAgo, titleCase } from '../lib/format';
import { cn } from '../lib/cn';

type FilterId = 'all' | 'pipeline' | 'submitted' | 'closed';

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pipeline', label: 'In progress' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'closed', label: 'Closed' },
];

function matchesFilter(status: ApplicationStatus, filter: FilterId): boolean {
  if (filter === 'all') return true;
  if (filter === 'pipeline') return ['discovered', 'saved', 'reviewing', 'ready'].includes(status);
  if (filter === 'submitted') return ['submitted', 'interview'].includes(status);
  return ['accepted', 'rejected'].includes(status);
}

export function ApplicationsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const userId = user?.id ?? '';

  const [applications, setApplications] = useState<ApplicationWithJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterId>('all');
  const [notesTarget, setNotesTarget] = useState<ApplicationWithJob | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ApplicationWithJob | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    listApplications(userId)
      .then((rows) => {
        if (!cancelled) setApplications(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load applications.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const counts = useMemo(() => {
    const base: Record<string, number> = { all: applications.length };
    for (const item of FILTERS) {
      if (item.id === 'all') continue;
      base[item.id] = applications.filter((app) => matchesFilter(app.status, item.id)).length;
    }
    return base;
  }, [applications]);

  const visible = useMemo(
    () => applications.filter((app) => matchesFilter(app.status, filter)),
    [applications, filter],
  );

  const changeStatus = async (app: ApplicationWithJob, status: ApplicationStatus) => {
    setBusyId(app.id);
    try {
      await updateApplication(app.id, { status });
      setApplications((prev) =>
        prev.map((item) =>
          item.id === app.id
            ? {
                ...item,
                status,
                applied_at:
                  status === 'submitted' ? new Date().toISOString() : item.applied_at,
                updated_at: new Date().toISOString(),
              }
            : item,
        ),
      );
      toast(`Moved to ${titleCase(status)}.`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update the stage.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const saveNotes = async () => {
    if (!notesTarget) return;
    try {
      await updateApplication(notesTarget.id, { notes: notesDraft.trim() || null });
      setApplications((prev) =>
        prev.map((item) =>
          item.id === notesTarget.id ? { ...item, notes: notesDraft.trim() || null } : item,
        ),
      );
      setNotesTarget(null);
      toast('Notes saved.', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save notes.', 'error');
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await deleteApplication(deleteTarget.id);
      setApplications((prev) => prev.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast('Removed from the tracker.', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not remove that entry.', 'error');
    }
  };

  return (
    <Page
      title="Applications"
      description="Every role you saved or applied to, with its stage and your notes. Submissions are never automatic."
      actions={
        <Button variant="primary" size="sm" onClick={() => navigate('/jobs')}>
          <ClipboardList size={13} /> Find more roles
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-[11px] transition',
              filter === item.id
                ? 'border-cyan/50 bg-cyan/10 text-cyan'
                : 'border-line text-muted hover:border-cyan/30 hover:text-ink',
            )}
          >
            {item.label}
            <span className="ml-1.5 text-[10px] opacity-70">{counts[item.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={22} />}
          title={applications.length === 0 ? 'Nothing tracked yet' : 'No roles in this stage'}
          description={
            applications.length === 0
              ? 'Open Job Search, run a query and save a listing. JOBBY keeps the stage, notes and CV link in one place.'
              : 'Switch filter to All to see everything you are tracking.'
          }
          action={
            <Button size="sm" variant="secondary" onClick={() => navigate('/jobs')}>
              Search jobs
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((app) => (
            <li key={app.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-ink">
                        {app.jobs?.title ?? 'Untitled role'}
                      </p>
                      <span
                        className={cn(
                          'shrink-0 rounded-full border px-2 py-0.5 text-[10px] capitalize',
                          statusTone(app.status),
                        )}
                      >
                        {app.status}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {app.jobs?.company ?? 'Unknown company'}
                      {app.jobs?.location ? ` · ${app.jobs.location}` : ''}
                      {app.jobs?.source ? ` · ${app.jobs.source}` : ''}
                    </p>
                    <p className="mt-1 text-[10px] text-muted/70">
                      Saved {timeAgo(app.created_at)}
                      {app.applied_at ? ` · submitted ${shortDate(app.applied_at)}` : ''}
                    </p>
                    {app.notes && (
                      <p className="mt-2 line-clamp-2 rounded-lg border border-line/60 bg-bg/40 px-2 py-1.5 text-[11px] text-ink/75">
                        {app.notes}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {app.jobs?.job_url && (
                        <a
                          href={app.jobs.job_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] text-cyan hover:underline"
                        >
                          {hostOf(app.jobs.job_url)} <ArrowUpRight size={10} />
                        </a>
                      )}
                      {app.resume_id && (
                        <Badge tone="neutral">
                          <FileText size={9} /> linked CV
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex w-full items-center gap-1.5 sm:w-auto">
                    <Select
                      aria-label="Application stage"
                      value={app.status}
                      disabled={busyId === app.id}
                      onChange={(event) =>
                        void changeStatus(app, event.target.value as ApplicationStatus)
                      }
                      className="h-8 py-0 text-[11px] sm:w-36"
                    >
                      {APPLICATION_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {titleCase(status)}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Edit notes"
                      onClick={() => {
                        setNotesTarget(app);
                        setNotesDraft(app.notes ?? '');
                      }}
                    >
                      <StickyNote size={14} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove entry"
                      onClick={() => setDeleteTarget(app)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={notesTarget !== null}
        onClose={() => setNotesTarget(null)}
        title={`Notes — ${notesTarget?.jobs?.title ?? 'role'}`}
        description="Recruiter names, follow-up dates, interview prep. Only you can read this."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setNotesTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void saveNotes()}>
              Save notes
            </Button>
          </>
        }
      >
        <Field label="Notes">
          <Textarea value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Remove this application?"
        description="The tracker entry is deleted. The job listing and any uploaded CV remain."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={() => void remove()}>
              Remove
            </Button>
          </>
        }
      />
    </Page>
  );
}
