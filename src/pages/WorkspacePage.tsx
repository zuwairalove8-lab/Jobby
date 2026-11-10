import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Check,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Search,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthProvider';
import { useToast } from '../context/ToastProvider';
import {
  Badge,
  Button,
  ErrorNote,
  Field,
  Input,
  Modal,
  Skeleton,
} from '../components/ui';
import {
  ApprovalCard,
  Composer,
  MessageBubble,
  StreamingBubble,
  type PendingAttachment,
} from '../modules/ai-chat/ChatParts';
import { useChatStream } from '../modules/ai-chat/useChatStream';
import {
  createConversation,
  deleteConversation,
  insertUserMessage,
  listConversations,
  listMessages,
  listProviders,
  renameConversation,
  uploadAttachment,
} from '../services/db';
import { getProviderStatus } from '../services/api';
import type { AiProvider, Conversation, Message } from '../types';
import { cn } from '../lib/cn';
import { timeAgo, truncate } from '../lib/format';

const SUGGESTIONS = [
  {
    title: 'Find entry-level GRC roles',
    prompt:
      'Search for entry-level governance, risk and compliance jobs that are open to candidates in my country. Summarise the top 5 and explain which ones fit my skills.',
  },
  {
    title: 'Score my fit for a role',
    prompt:
      'Search for cybersecurity analyst roles, then compare my profile against the top 3 listings and explain exactly which requirements I am missing.',
  },
  {
    title: 'Tailor my CV',
    prompt:
      'Using my profile and skills, propose a tailored CV summary and bullet points for an IT support role. Do not invent qualifications I have not listed.',
  },
  {
    title: 'Plan this week',
    prompt:
      'Build me a 5-step plan for this week to move my job search forward: which roles to target, what to prepare, and what to track.',
  },
];

export function WorkspacePage() {
  const { user } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const userId = user?.id ?? '';

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [providerId, setProviderId] = useState('');
  const [serverProviderReady, setServerProviderReady] = useState<boolean | null>(null);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showList, setShowList] = useState(false);
  const [search, setSearch] = useState('');
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [sendingUserText, setSendingUserText] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastUserMessage = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'user') ?? null,
    [messages],
  );

  const { state, send, stop, resolveApproval } = useChatStream({
    onComplete: () => {
      if (activeIdRef.current) void loadMessages(activeIdRef.current);
      void loadConversations();
      setSendingUserText(null);
    },
  });

  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const loadMessages = useCallback(async (conversationId: string) => {
    setMessagesLoading(true);
    try {
      const rows = await listMessages(conversationId);
      setMessages(rows);
    } catch (error) {
      setContextError(error instanceof Error ? error.message : 'Could not load messages.');
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const rows = await listConversations(userId);
      setConversations(rows);
    } catch (error) {
      setContextError(error instanceof Error ? error.message : 'Could not load conversations.');
    } finally {
      setConversationsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    void loadConversations();
    void listProviders(userId)
      .then((rows) => {
        setProviders(rows);
        const preferred = rows.find((p) => p.is_default) ?? rows.find((p) => p.enabled);
        if (preferred) setProviderId(preferred.id);
      })
      .catch(() => setProviders([]));
    void getProviderStatus()
      .then((status) => setServerProviderReady(status.serverDefaults.openrouter))
      .catch(() => setServerProviderReady(false));
  }, [userId, loadConversations]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    void loadMessages(activeId);
  }, [activeId, loadMessages]);

  // A dashboard/other-page handoff can request a prefilled prompt.
  useEffect(() => {
    const prompt = (location.state as { prompt?: string } | null)?.prompt;
    if (prompt) setDraft(prompt);
  }, [location.state]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, state.draft, state.steps, state.approval]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, search]);

  const startNewConversation = async () => {
    try {
      const conversation = await createConversation(userId, 'New task');
      setConversations((prev) => [conversation, ...prev]);
      setActiveId(conversation.id);
      setMessages([]);
      setShowList(false);
      setDraft('');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not create a conversation.', 'error');
    }
  };

  const handleAttach = async (file: File) => {
    if (!userId) return;
    setUploading(true);
    try {
      const path = await uploadAttachment(userId, file);
      let textContent: string | undefined;
      const isText =
        file.type.startsWith('text/') ||
        /\.(txt|md|json|csv)$/i.test(file.name) ||
        file.type === '';
      if (isText && file.size < 256_000) {
        textContent = (await file.text()).slice(0, 20_000);
      }
      setAttachments((prev) => [
        ...prev,
        { name: file.name, path, type: file.type || 'file', size: file.size },
      ]);
      if (textContent) {
        setDraft((prev) =>
          `${prev}${prev ? '\n\n' : ''}[Attached: ${file.name}]\n${textContent}`.slice(0, 24_000),
        );
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Upload failed.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? draft).trim();
    if (!text || state.streaming || !userId) return;

    setContextError(null);
    let conversationId = activeId;

    try {
      if (!conversationId) {
        const conversation = await createConversation(userId, truncate(text, 48), null);
        setConversations((prev) => [conversation, ...prev]);
        setActiveId(conversation.id);
        activeIdRef.current = conversation.id;
        conversationId = conversation.id;
      }

      await insertUserMessage(conversationId, text, {
        attachments: attachments.map((a) => ({
          name: a.name,
          path: a.path,
          type: a.type,
          size: a.size,
        })),
        providerId: providerId || null,
      });

      setDraft('');
      setAttachments([]);
      setSendingUserText(text);
      await loadMessages(conversationId);
      void loadConversations();

      await send({
        conversationId,
        content: text,
        providerId: providerId || null,
      });
    } catch (error) {
      setSendingUserText(null);
      setContextError(error instanceof Error ? error.message : 'Could not send that message.');
    }
  };

  const confirmRename = async () => {
    if (!renameTarget) return;
    try {
      await renameConversation(renameTarget.id, renameValue.trim() || 'Untitled');
      setConversations((prev) =>
        prev.map((c) =>
          c.id === renameTarget.id ? { ...c, title: renameValue.trim() || 'Untitled' } : c,
        ),
      );
      setRenameTarget(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Rename failed.', 'error');
    }
  };

  const handleDelete = async (conversation: Conversation) => {
    try {
      await deleteConversation(conversation.id);
      setConversations((prev) => prev.filter((c) => c.id !== conversation.id));
      if (activeId === conversation.id) {
        setActiveId(null);
        setMessages([]);
      }
      setMenuFor(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Delete failed.', 'error');
    }
  };

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;
  const noProviderConfigured = providers.length === 0 && serverProviderReady === false;

  return (
    <div className="flex min-h-0 flex-1">
      {/* conversation list */}
      <aside
        className={cn(
          'absolute inset-y-0 left-0 z-40 w-[82%] max-w-xs flex-col border-r border-line/70 bg-surface/95 backdrop-blur transition-transform lg:static lg:z-auto lg:flex lg:w-64 lg:translate-x-0 lg:bg-surface/30',
          showList ? 'flex translate-x-0' : 'hidden -translate-x-full lg:flex',
        )}
      >
        <div className="flex items-center gap-2 border-b border-line/60 p-3">
          <Button variant="primary" size="sm" className="flex-1" onClick={() => void startNewConversation()}>
            <MessageSquarePlus size={14} /> New task
          </Button>
          <button
            type="button"
            onClick={() => setShowList(false)}
            className="rounded-lg p-2 text-muted hover:bg-raised hover:text-ink lg:hidden"
            aria-label="Close conversations"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-2.5">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search conversations"
              className="w-full rounded-lg border border-line/70 bg-bg/50 py-1.5 pl-8 pr-2 text-xs text-ink placeholder:text-muted/60 focus:border-cyan/50 focus:outline-none"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {conversationsLoading ? (
            <div className="space-y-2 p-1">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-[11px] leading-relaxed text-muted">
              {search ? 'No conversations match that search.' : 'No conversations yet. Start a task.'}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((conversation) => (
                <li key={conversation.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveId(conversation.id);
                      setShowList(false);
                    }}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition',
                      activeId === conversation.id
                        ? 'bg-raised text-ink'
                        : 'text-muted hover:bg-raised/50 hover:text-ink',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{conversation.title}</span>
                      <span className="mt-0.5 block text-[10px] text-muted/70">
                        {timeAgo(conversation.updated_at)}
                      </span>
                    </span>
                  </button>
                  <div className="absolute right-1 top-1.5 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => {
                        setRenameTarget(conversation);
                        setRenameValue(conversation.title);
                      }}
                      className="rounded p-1 text-muted hover:bg-bg/70 hover:text-ink"
                      aria-label="Rename conversation"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setMenuFor(menuFor === conversation.id ? null : conversation.id)}
                      className="rounded p-1 text-muted hover:bg-bg/70 hover:text-ink"
                      aria-label="Conversation actions"
                    >
                      <MoreHorizontal size={12} />
                    </button>
                  </div>
                  {menuFor === conversation.id && (
                    <div className="absolute right-1 top-8 z-20 w-36 rounded-lg border border-line bg-surface p-1 shadow-xl">
                      <button
                        type="button"
                        onClick={() => void handleDelete(conversation)}
                        className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[11px] text-bad hover:bg-bad/10"
                      >
                        <Trash2 size={11} /> Delete conversation
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {showList && (
        <button
          type="button"
          aria-label="Close conversations overlay"
          className="absolute inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setShowList(false)}
        />
      )}

      {/* chat column */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-line/60 bg-bg/60 px-3 py-2.5 backdrop-blur">
          <button
            type="button"
            onClick={() => setShowList(true)}
            className="rounded-lg p-2 text-muted hover:bg-raised hover:text-ink lg:hidden"
            aria-label="Show conversations"
          >
            <PanelLeft size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {activeConversation?.title ?? 'New agent task'}
            </p>
            <p className="text-[10px] text-muted">
              {state.streaming ? 'Agent working…' : 'Agent idle · tools require approval'}
            </p>
          </div>
          <Badge tone={providers.length > 0 ? 'violet' : 'cyan'}>
            {providers.find((p) => p.id === providerId)?.model_name ?? 'auto model'}
          </Badge>
        </header>

        {noProviderConfigured && (
          <div className="border-b border-warn/30 bg-warn/[0.07] px-4 py-2 text-[11px] text-warn">
            <span className="inline-flex items-center gap-1.5">
              <TriangleAlert size={12} />
              No AI provider is configured. Add an OpenRouter key in{' '}
              <Link to="/agent" className="underline">
                Agent Manager
              </Link>{' '}
              to enable real replies.
            </span>
          </div>
        )}

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {messagesLoading && (
              <div className="space-y-3">
                <Skeleton className="h-16 w-2/3" />
                <Skeleton className="ml-auto h-12 w-1/2" />
              </div>
            )}

            {!messagesLoading && messages.length === 0 && !sendingUserText && (
              <div className="py-6">
                <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-cyan/20 to-violet/20">
                  <Sparkles size={22} className="text-cyan" />
                </div>
                <h2 className="text-center text-lg font-semibold">
                  What should JOBBY work on?
                </h2>
                <p className="mx-auto mt-1 max-w-md text-center text-xs leading-relaxed text-muted">
                  It can search live job feeds, score your fit, draft documents and operate the
                  shared browser — always asking before it acts externally.
                </p>
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion.title}
                      type="button"
                      onClick={() => {
                        setDraft(suggestion.prompt);
                        void handleSend(suggestion.prompt);
                      }}
                      className="rounded-xl border border-line/70 bg-surface/60 p-3 text-left transition hover:border-cyan/40 hover:bg-raised/50"
                    >
                      <p className="text-xs font-medium text-ink">{suggestion.title}</p>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted">
                        {suggestion.prompt}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {state.approval && (
              <ApprovalCard
                step={state.approval.step}
                busy={state.streaming}
                onApprove={() => resolveApproval(true, activeId ?? '')}
                onDeny={() => resolveApproval(false, activeId ?? '')}
              />
            )}

            {(state.streaming || state.draft) && (
              <StreamingBubble
                text={state.draft}
                steps={state.steps}
                notice={state.notice}
              />
            )}

            {state.error && (
              <div className="space-y-2">
                <ErrorNote>{state.error}</ErrorNote>
                {lastUserMessage && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleSend(lastUserMessage.content)}
                    disabled={state.streaming}
                  >
                    Retry last request
                  </Button>
                )}
              </div>
            )}

            {contextError && <ErrorNote>{contextError}</ErrorNote>}

            {state.notice && !state.streaming && (
              <p className="text-center text-[11px] text-muted">{state.notice}</p>
            )}

            {state.streaming && state.approval === null && state.draft && (
              <div className="flex justify-center">
                <Button size="sm" variant="ghost" onClick={stop}>
                  <Check size={12} /> Stop generation
                </Button>
              </div>
            )}
          </div>
        </div>

        <Composer
          value={draft}
          onChange={setDraft}
          onSend={() => void handleSend()}
          onStop={stop}
          streaming={state.streaming}
          providers={providers}
          providerId={providerId}
          onProviderChange={setProviderId}
          onAttach={(file) => void handleAttach(file)}
          attachments={attachments}
          onRemoveAttachment={(path) =>
            setAttachments((prev) => prev.filter((a) => a.path !== path))
          }
          uploading={uploading}
        />
      </div>

      <Modal
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title="Rename conversation"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void confirmRename()}>
              Save
            </Button>
          </>
        }
      >
        <Field label="Title">
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            maxLength={120}
            autoFocus
          />
        </Field>
      </Modal>
    </div>
  );
}
