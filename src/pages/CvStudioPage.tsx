import { useEffect, useState } from 'react';
import {
  Download,
  FileText,
  Printer,
  Save,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
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
  InfoNote,
  Modal,
  SectionHeading,
  Skeleton,
  Tabs,
  Textarea,
} from '../components/ui';
import { useAuth } from '../context/AuthProvider';
import { useToast } from '../context/ToastProvider';
import {
  createResume,
  createResumeDownloadUrl,
  deleteResume,
  listResumes,
  updateResume,
  uploadResumeFile,
} from '../services/db';
import { generateCoverLetter, generateResume } from '../services/api';
import type { Resume, ResumeContent, ResumeExperience } from '../types';

interface ResumeEducation {
  institution: string;
  qualification: string;
  year?: string;
}
import { shortDate } from '../lib/format';

type Tab = 'editor' | 'tailor' | 'letters';

function emptyContent(): ResumeContent {
  return { summary: '', experience: [], education: [], skills: [], certifications: [] };
}

function normalise(content: ResumeContent | null | undefined): ResumeContent {
  return {
    summary: content?.summary ?? '',
    contact: content?.contact ?? {},
    experience: (content?.experience ?? []).map((item) => ({
      company: item.company ?? '',
      title: item.title ?? '',
      start: item.start ?? '',
      end: item.end ?? '',
      bullets: item.bullets ?? [],
    })),
    education: (content?.education ?? []).map((item) => ({
      institution: item.institution ?? '',
      qualification: item.qualification ?? '',
      year: item.year ?? '',
    })),
    skills: content?.skills ?? [],
    certifications: content?.certifications ?? [],
  };
}

function buildResumeHtml(title: string, content: ResumeContent, name: string): string {
  const escape = (value: string): string =>
    value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

  const experience = (content.experience ?? [])
    .map(
      (item) => `
        <section>
          <h3>${escape(item.title)} — ${escape(item.company)}</h3>
          <p class="meta">${escape(item.start ?? '')}${item.end ? ` – ${escape(item.end)}` : ''}</p>
          <ul>${(item.bullets ?? []).map((bullet) => `<li>${escape(bullet)}</li>`).join('')}</ul>
        </section>`,
    )
    .join('');

  const education = (content.education ?? [])
    .map(
      (item) =>
        `<p><strong>${escape(item.qualification)}</strong> · ${escape(item.institution)}${item.year ? ` · ${escape(item.year)}` : ''}</p>`,
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title>
  <style>
    @page { margin: 18mm; }
    body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #111; line-height: 1.45; }
    h1 { font-size: 22px; margin: 0 0 2px; }
    h2 { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin: 18px 0 8px; }
    h3 { font-size: 14px; margin: 12px 0 2px; }
    .meta { color: #666; font-size: 12px; margin: 0 0 4px; }
    ul { margin: 4px 0 0 18px; padding: 0; }
    li { margin-bottom: 3px; font-size: 13px; }
    p { font-size: 13px; margin: 4px 0; }
    .contact { color: #444; font-size: 12px; }
  </style></head><body>
    <h1>${escape(name || 'Your name')}</h1>
    <p class="contact">${escape(content.contact?.email ?? '')} ${content.contact?.location ? `· ${escape(content.contact.location)}` : ''}</p>
    ${content.summary ? `<h2>Summary</h2><p>${escape(content.summary)}</p>` : ''}
    ${experience ? `<h2>Experience</h2>${experience}` : ''}
    ${education ? `<h2>Education</h2>${education}` : ''}
    ${content.skills && content.skills.length > 0 ? `<h2>Skills</h2><p>${escape(content.skills.join(' · '))}</p>` : ''}
    ${content.certifications && content.certifications.length > 0 ? `<h2>Certifications</h2><p>${escape(content.certifications.join(' · '))}</p>` : ''}
  </body></html>`;
}

export function CvStudioPage() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const userId = user?.id ?? '';

  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('editor');
  const [editor, setEditor] = useState<{ id: string | null; title: string; content: ResumeContent }>({
    id: null,
    title: 'My CV',
    content: emptyContent(),
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Resume | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [targetRole, setTargetRole] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [generating, setGenerating] = useState(false);

  const [cover, setCover] = useState({ company: '', role: '', description: '', letter: '' });
  const [coverBusy, setCoverBusy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    listResumes(userId)
      .then((rows) => {
        if (cancelled) return;
        setResumes(rows);
        const primary = rows.find((r) => r.is_primary) ?? rows[0];
        if (primary) {
          setEditor({ id: primary.id, title: primary.title, content: normalise(primary.content) });
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load your CVs.'),
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const reload = async (selectId?: string) => {
    const rows = await listResumes(userId);
    setResumes(rows);
    const target = rows.find((r) => r.id === selectId) ?? rows[0];
    if (target) {
      setEditor({ id: target.id, title: target.title, content: normalise(target.content) });
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editor.id) {
        await updateResume(editor.id, { title: editor.title, content: editor.content });
        toast('CV saved.', 'success');
      } else {
        const created = await createResume(userId, editor.title || 'Untitled CV', editor.content);
        toast('CV created.', 'success');
        setEditor({ id: created.id, title: created.title, content: normalise(created.content) });
      }
      await reload(editor.id ?? undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this CV.');
    } finally {
      setSaving(false);
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const path = await uploadResumeFile(userId, file);
      if (editor.id) {
        await updateResume(editor.id, { storage_path: path });
        await reload(editor.id);
      } else {
        const created = await createResume(userId, editor.title || file.name, editor.content);
        await updateResume(created.id, { storage_path: path });
        setEditor({ id: created.id, title: created.title, content: normalise(created.content) });
        await reload(created.id);
      }
      toast('Document uploaded to private storage.', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const download = async (resume: Resume) => {
    if (!resume.storage_path) return;
    try {
      const signed = await createResumeDownloadUrl(resume.storage_path);
      window.open(signed, '_blank', 'noopener');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create a download link.', 'error');
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await deleteResume(deleteTarget.id);
      setDeleteTarget(null);
      const rows = await listResumes(userId);
      setResumes(rows);
      if (rows[0]) setEditor({ id: rows[0].id, title: rows[0].title, content: normalise(rows[0].content) });
      else setEditor({ id: null, title: 'My CV', content: emptyContent() });
      toast('CV deleted.', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete that CV.', 'error');
    }
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const result = await generateResume({
        targetRole: targetRole.trim() || undefined,
        jobDescription: jobDescription.trim() || undefined,
        instructions: instructions.trim() || undefined,
        saveAsTitle: saveName || (targetRole.trim() ? `Tailored — ${targetRole.trim()}` : undefined),
      });
      setEditor({ id: result.resume?.id ?? null, title: result.resume?.title ?? 'Tailored CV', content: normalise(result.content) });
      setTab('editor');
      await reload(result.resume?.id);
      toast(result.message, 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  const [saveName, setSaveName] = useState('');

  const makeCoverLetter = async () => {
    setCoverBusy(true);
    setError(null);
    try {
      const result = await generateCoverLetter({
        company: cover.company.trim() || undefined,
        role: cover.role.trim() || undefined,
        jobDescription: cover.description.trim() || undefined,
      });
      setCover((prev) => ({ ...prev, letter: result.letter }));
      toast(result.message, 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cover letter generation failed.');
    } finally {
      setCoverBusy(false);
    }
  };

  const printEditor = () => {
    const html = buildResumeHtml(editor.title, editor.content, profile?.full_name ?? '');
    const win = window.open('', '_blank');
    if (!win) {
      const blob = new Blob([html], { type: 'text/html' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${editor.title || 'cv'}.html`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast('Pop-up blocked — downloaded an HTML copy instead.', 'info');
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  const updateExperience = (index: number, patch: Partial<ResumeExperience>) => {
    setEditor((prev) => {
      const list = [...(prev.content.experience ?? [])];
      const current = list[index];
      if (!current) return prev;
      list[index] = { ...current, ...patch };
      return { ...prev, content: { ...prev.content, experience: list } };
    });
  };

  const updateEducation = (index: number, patch: Partial<ResumeEducation>) => {
    setEditor((prev) => {
      const list = [...(prev.content.education ?? [])];
      const current = list[index];
      if (!current) return prev;
      list[index] = { ...current, ...patch };
      return { ...prev, content: { ...prev.content, education: list } };
    });
  };

  return (
    <Page
      title="CV Studio"
      description="Your master CV, tailored versions, uploaded documents and cover letters."
      actions={
        <>
          <Button variant="secondary" size="sm" onClick={printEditor}>
            <Printer size={13} /> Print / PDF
          </Button>
          <Button variant="primary" size="sm" onClick={() => void save()} loading={saving}>
            <Save size={13} /> Save CV
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="mb-4">
        <Tabs
          active={tab}
          onChange={(id) => setTab(id as Tab)}
          items={[
            { id: 'editor', label: 'CV editor' },
            { id: 'tailor', label: 'Tailor with AI' },
            { id: 'letters', label: 'Cover letters' },
          ]}
        />
      </div>

      {tab === 'editor' && (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <Card className="h-fit p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                Versions
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditor({ id: null, title: 'New CV', content: emptyContent() });
                }}
              >
                + New
              </Button>
            </div>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : resumes.length === 0 ? (
              <p className="px-1 py-3 text-[11px] text-muted">
                No saved CVs yet. Fill in the editor and save your first version.
              </p>
            ) : (
              <ul className="space-y-1">
                {resumes.map((resume) => (
                  <li key={resume.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        setEditor({
                          id: resume.id,
                          title: resume.title,
                          content: normalise(resume.content),
                        })
                      }
                      className={
                        editor.id === resume.id
                          ? 'min-w-0 flex-1 rounded-lg bg-raised px-2 py-1.5 text-left'
                          : 'min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left hover:bg-raised/50'
                      }
                    >
                      <span className="block truncate text-[11px] text-ink">{resume.title}</span>
                      <span className="block text-[10px] text-muted">
                        {shortDate(resume.updated_at)}
                        {resume.storage_path ? ' · file' : ''}
                      </span>
                    </button>
                    {resume.storage_path && (
                      <button
                        type="button"
                        onClick={() => void download(resume)}
                        className="rounded p-1 text-muted hover:text-cyan"
                        aria-label="Download uploaded document"
                      >
                        <Download size={12} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(resume)}
                      className="rounded p-1 text-muted hover:text-bad"
                      aria-label="Delete CV"
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 border-t border-line/60 pt-3">
              <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-line px-2 py-2 text-[11px] text-muted transition hover:border-cyan/40 hover:text-cyan">
                <Upload size={12} />
                {uploading ? 'Uploading…' : 'Upload PDF / DOCX'}
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.txt,.md"
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(file);
                    event.target.value = '';
                  }}
                />
              </label>
              <p className="mt-1.5 text-[10px] leading-relaxed text-muted/60">
                Private bucket, owner-only access.
              </p>
            </div>
          </Card>

          <Card className="p-4">
            <div className="space-y-3">
              <Field label="CV title">
                <Input
                  value={editor.title}
                  onChange={(event) => setEditor((prev) => ({ ...prev, title: event.target.value }))}
                  placeholder="Master CV"
                />
              </Field>

              <Field label="Professional summary" hint="Write only what is true — the agent is told the same.">
                <Textarea
                  value={editor.content.summary ?? ''}
                  onChange={(event) =>
                    setEditor((prev) => ({
                      ...prev,
                      content: { ...prev.content, summary: event.target.value },
                    }))
                  }
                  placeholder="IT support professional with 3 years of experience in…"
                />
              </Field>

              <SectionHeading title="Experience" />
              <div className="space-y-3">
                {(editor.content.experience ?? []).map((item, index) => (
                  <div key={index} className="rounded-xl border border-line/70 bg-bg/30 p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        value={item.title}
                        onChange={(event) => updateExperience(index, { title: event.target.value })}
                        placeholder="Job title"
                      />
                      <Input
                        value={item.company}
                        onChange={(event) => updateExperience(index, { company: event.target.value })}
                        placeholder="Company"
                      />
                      <Input
                        value={item.start ?? ''}
                        onChange={(event) => updateExperience(index, { start: event.target.value })}
                        placeholder="Start (2022)"
                      />
                      <Input
                        value={item.end ?? ''}
                        onChange={(event) => updateExperience(index, { end: event.target.value })}
                        placeholder="End (Present)"
                      />
                    </div>
                    <Textarea
                      className="mt-2 min-h-20"
                      value={item.bullets.join('\n')}
                      onChange={(event) =>
                        updateExperience(index, {
                          bullets: event.target.value.split('\n').filter((line) => line.trim()),
                        })
                      }
                      placeholder="One achievement per line"
                    />
                    <div className="mt-1.5 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setEditor((prev) => ({
                            ...prev,
                            content: {
                              ...prev.content,
                              experience: (prev.content.experience ?? []).filter((_, i) => i !== index),
                            },
                          }))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setEditor((prev) => ({
                      ...prev,
                      content: {
                        ...prev.content,
                        experience: [
                          ...(prev.content.experience ?? []),
                          { company: '', title: '', start: '', end: '', bullets: [] },
                        ],
                      },
                    }))
                  }
                >
                  + Add experience
                </Button>
              </div>

              <SectionHeading title="Education" />
              <div className="space-y-2">
                {(editor.content.education ?? []).map((item, index) => (
                  <div key={index} className="grid gap-2 rounded-xl border border-line/70 bg-bg/30 p-3 sm:grid-cols-3">
                    <Input
                      value={item.institution}
                      onChange={(event) => updateEducation(index, { institution: event.target.value })}
                      placeholder="Institution"
                    />
                    <Input
                      value={item.qualification}
                      onChange={(event) => updateEducation(index, { qualification: event.target.value })}
                      placeholder="Qualification"
                    />
                    <div className="flex gap-1.5">
                      <Input
                        value={item.year ?? ''}
                        onChange={(event) => updateEducation(index, { year: event.target.value })}
                        placeholder="Year"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Remove education"
                        onClick={() =>
                          setEditor((prev) => ({
                            ...prev,
                            content: {
                              ...prev.content,
                              education: (prev.content.education ?? []).filter((_, i) => i !== index),
                            },
                          }))
                        }
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setEditor((prev) => ({
                      ...prev,
                      content: {
                        ...prev.content,
                        education: [
                          ...(prev.content.education ?? []),
                          { institution: '', qualification: '', year: '' },
                        ],
                      },
                    }))
                  }
                >
                  + Add education
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Skills" hint="Comma separated.">
                  <Textarea
                    value={(editor.content.skills ?? []).join(', ')}
                    onChange={(event) =>
                      setEditor((prev) => ({
                        ...prev,
                        content: {
                          ...prev.content,
                          skills: event.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        },
                      }))
                    }
                    placeholder="Risk assessment, ISO 27001, Python"
                  />
                </Field>
                <Field label="Certifications" hint="Only certifications you actually hold.">
                  <Textarea
                    value={(editor.content.certifications ?? []).join(', ')}
                    onChange={(event) =>
                      setEditor((prev) => ({
                        ...prev,
                        content: {
                          ...prev.content,
                          certifications: event.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        },
                      }))
                    }
                    placeholder="CompTIA Security+"
                  />
                </Field>
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === 'tailor' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <SectionHeading
              title="Generate a tailored version"
              subtitle="The agent uses your saved profile and skills; it is instructed not to invent experience."
            />
            <div className="space-y-3">
              <Field label="Target role">
                <Input
                  value={targetRole}
                  onChange={(event) => setTargetRole(event.target.value)}
                  placeholder="GRC Analyst"
                />
              </Field>
              <Field label="Job description (paste)" hint="Optional but improves relevance.">
                <Textarea
                  value={jobDescription}
                  onChange={(event) => setJobDescription(event.target.value)}
                  className="min-h-32"
                  placeholder="Paste the requirements section…"
                />
              </Field>
              <Field label="Extra instructions">
                <Textarea
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  placeholder="Keep it to one page; emphasise compliance reporting."
                />
              </Field>
              <Field label="Save as">
                <Input
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  placeholder="Tailored — GRC Analyst"
                />
              </Field>
              <Button variant="primary" onClick={() => void generate()} loading={generating}>
                <Wand2 size={14} /> Generate CV
              </Button>
            </div>
          </Card>
          <Card className="p-4">
            <SectionHeading title="How this works" />
            <ul className="space-y-2 text-xs leading-relaxed text-muted">
              <li>
                • The request is authenticated and routed through the <code>resume</code> edge
                function using your default provider.
              </li>
              <li>
                • It receives your profile, skills and the selected CV — never another user's data.
              </li>
              <li>
                • The result is stored as a new CV version you can edit; nothing is submitted
                anywhere.
              </li>
              <li>
                • If no AI provider is configured the request fails loudly with the provider error
                instead of returning a template.
              </li>
            </ul>
            <div className="mt-4">
              <InfoNote>
                Export with “Print / PDF”. On Android, use your device's share/print target; the
                generated document is also saved to your private storage.
              </InfoNote>
            </div>
          </Card>
        </div>
      )}

      {tab === 'letters' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <SectionHeading title="Draft a cover letter" />
            <div className="space-y-3">
              <Field label="Company">
                <Input
                  value={cover.company}
                  onChange={(event) => setCover((prev) => ({ ...prev, company: event.target.value }))}
                  placeholder="Acme Ltd"
                />
              </Field>
              <Field label="Role">
                <Input
                  value={cover.role}
                  onChange={(event) => setCover((prev) => ({ ...prev, role: event.target.value }))}
                  placeholder="SOC Analyst"
                />
              </Field>
              <Field label="Job description">
                <Textarea
                  value={cover.description}
                  onChange={(event) =>
                    setCover((prev) => ({ ...prev, description: event.target.value }))
                  }
                  className="min-h-28"
                />
              </Field>
              <Button variant="primary" onClick={() => void makeCoverLetter()} loading={coverBusy}>
                <Sparkles size={14} /> Generate letter
              </Button>
            </div>
          </Card>
          <Card className="flex flex-col p-4">
            <SectionHeading
              title="Draft"
              action={
                cover.letter ? (
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void navigator.clipboard.writeText(cover.letter);
                        toast('Copied to clipboard.', 'success');
                      }}
                    >
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const blob = new Blob([cover.letter], { type: 'text/plain' });
                        const link = document.createElement('a');
                        link.href = URL.createObjectURL(blob);
                        link.download = `cover-letter-${cover.company || 'draft'}.txt`;
                        link.click();
                        URL.revokeObjectURL(link.href);
                      }}
                    >
                      <Download size={12} /> .txt
                    </Button>
                  </div>
                ) : undefined
              }
            />
            {cover.letter ? (
              <Textarea
                value={cover.letter}
                onChange={(event) => setCover((prev) => ({ ...prev, letter: event.target.value }))}
                className="min-h-72 flex-1"
              />
            ) : (
              <EmptyState
                icon={<FileText size={20} />}
                title="No draft yet"
                description="Generated letters are editable here — check every claim before you send it."
              />
            )}
          </Card>
        </div>
      )}

      <div className="mt-5 flex items-center gap-2">
        <Badge tone="neutral">{resumes.length} saved version(s)</Badge>
        {loading && <Skeleton className="h-4 w-24" />}
      </div>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete this CV?"
        description="The CV record is removed. An uploaded file in storage is retained for audit."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={() => void remove()}>
              Delete
            </Button>
          </>
        }
      />
    </Page>
  );
}
