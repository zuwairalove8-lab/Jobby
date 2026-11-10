import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  CircleSlash,
  Loader2,
  Lock,
  Mic,
  Paperclip,
  Square,
  User,
  X,
} from 'lucide-react';
import { Markdown } from '../../components/Markdown';
import { Badge, Button, Select } from '../../components/ui';
import { cn } from '../../lib/cn';
import { toolLabel } from '../../lib/tools';
import { timeAgo } from '../../lib/format';
import type { AgentStep, AiProvider, Message } from '../../types';
import { isSpeechSupported, startDictation } from './speech';

/* --------------------------------- steps ---------------------------------- */

export function StepChip({ step }: { step: AgentStep }) {
  const icon =
    step.status === 'succeeded' ? (
      <Check size={11} />
    ) : step.status === 'failed' ? (
      <X size={11} />
    ) : step.status === 'pending_approval' ? (
      <Lock size={11} />
    ) : step.status === 'denied' ? (
      <CircleSlash size={11} />
    ) : (
      <Loader2 size={11} className="animate-spin" />
    );

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]',
        step.status === 'succeeded' && 'border-good/30 bg-good/10 text-good',
        step.status === 'failed' && 'border-bad/30 bg-bad/10 text-bad',
        step.status === 'denied' && 'border-line bg-raised text-muted',
        step.status === 'pending_approval' && 'border-warn/40 bg-warn/10 text-warn',
        (step.status === 'running' || step.status === 'pending') &&
          'border-cyan/30 bg-cyan/10 text-cyan',
      )}
      title={step.input_summary ?? undefined}
    >
      {icon}
      <span className="truncate">{toolLabel(step.tool_name)}</span>
    </span>
  );
}

export function AgentStepsPanel({ steps }: { steps: AgentStep[] }) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  const visible = open ? steps : steps.slice(-4);

  return (
    <div className="mb-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {visible.map((step) => (
          <StepChip key={step.id} step={step} />
        ))}
        {steps.length > 4 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-1 text-[11px] text-muted hover:text-ink"
          >
            {open ? 'Hide' : `${steps.length - 4} more`}
            <ChevronDown size={10} className={cn(open && 'rotate-180')} />
          </button>
        )}
      </div>
      {open && (
        <ul className="mt-2 space-y-1 rounded-xl border border-line/60 bg-bg/40 p-2.5 text-[11px] text-muted">
          {steps.map((step) => (
            <li key={step.id} className="flex items-start gap-2">
              <span className="w-16 shrink-0 uppercase tracking-wide text-muted/60">
                {step.status}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-ink/90">{toolLabel(step.tool_name)}</span>
                {step.input_summary && (
                  <span className="block truncate text-muted/70">{step.input_summary}</span>
                )}
                {step.result_summary && (
                  <span className="block truncate text-muted/70">→ {step.result_summary}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------- approval -------------------------------- */

export function ApprovalCard({
  step,
  busy,
  onApprove,
  onDeny,
}: {
  step: AgentStep;
  busy: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <div className="mb-3 rounded-2xl border border-warn/40 bg-warn/[0.07] p-4">
      <div className="flex items-center gap-2 text-warn">
        <Lock size={15} />
        <p className="text-sm font-medium">Approval required: {toolLabel(step.tool_name)}</p>
      </div>
      {step.input_summary && (
        <p className="mt-1.5 text-xs leading-relaxed text-ink/75">{step.input_summary}</p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        JOBBY will only run this step if you approve. Everything is logged to your audit trail.
      </p>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" onClick={onApprove} loading={busy}>
          <Check size={13} /> Approve
        </Button>
        <Button variant="ghost" size="sm" onClick={onDeny} disabled={busy}>
          Deny
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------- messages -------------------------------- */

interface AttachmentMeta {
  name: string;
  path: string;
  type: string;
  size: number;
}

function attachmentsOf(message: Message): AttachmentMeta[] {
  const raw = message.metadata?.attachments;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is AttachmentMeta => {
    return (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as AttachmentMeta).name === 'string' &&
      typeof (item as AttachmentMeta).path === 'string'
    );
  });
}

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const attachments = attachmentsOf(message);

  if (message.role === 'system') return null;

  return (
    <div className={cn('flex w-full gap-2.5', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-line bg-raised/80">
          <Bot size={15} className={cn(isTool ? 'text-muted' : 'text-cyan')} />
        </div>
      )}

      <div className={cn('min-w-0 max-w-[86%] sm:max-w-[78%]', isUser && 'items-end')}>
        <div
          className={cn(
            'rounded-2xl px-3.5 py-2.5',
            isUser
              ? 'rounded-br-md border border-cyan/25 bg-cyan/[0.09] text-ink'
              : isTool
                ? 'border border-line/70 bg-bg/40 text-muted'
                : 'rounded-bl-md border border-line/70 bg-surface/80',
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
              {message.content}
            </p>
          ) : isTool ? (
            <p className="font-mono text-[11px] leading-relaxed break-words">{message.content}</p>
          ) : (
            <Markdown content={message.content} />
          )}

          {attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {attachments.map((file) => (
                <span
                  key={file.path}
                  className="inline-flex items-center gap-1 rounded-lg border border-line bg-bg/50 px-2 py-1 text-[10px] text-muted"
                >
                  <Paperclip size={10} /> {file.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <p
          className={cn(
            'mt-1 px-1 text-[10px] text-muted/50',
            isUser ? 'text-right' : 'text-left',
          )}
        >
          {timeAgo(message.created_at)}
        </p>
      </div>

      {isUser && (
        <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-cyan/25 bg-cyan/10">
          <User size={14} className="text-cyan" />
        </div>
      )}
    </div>
  );
}

export function StreamingBubble({
  text,
  steps,
  notice,
}: {
  text: string;
  steps: AgentStep[];
  notice: string | null;
}) {
  return (
    <div className="flex w-full gap-2.5">
      <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-line bg-raised/80">
        <Bot size={15} className="text-cyan" />
      </div>
      <div className="min-w-0 max-w-[86%] flex-1 sm:max-w-[78%]">
        {steps.length > 0 && <AgentStepsPanel steps={steps} />}
        <div className="rounded-2xl rounded-bl-md border border-line/70 bg-surface/80 px-3.5 py-2.5">
          {text ? (
            <Markdown content={text} />
          ) : (
            <div className="flex items-center gap-2 py-1 text-xs text-muted">
              <Loader2 size={13} className="animate-spin text-cyan" />
              {notice ?? 'Planning the task…'}
            </div>
          )}
          {text && (
            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-cyan align-middle" />
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- composer -------------------------------- */

export interface PendingAttachment {
  name: string;
  path: string;
  type: string;
  size: number;
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  providers,
  providerId,
  onProviderChange,
  onAttach,
  attachments,
  onRemoveAttachment,
  disabled,
  uploading,
}: {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  providers: AiProvider[];
  providerId: string;
  onProviderChange: (id: string) => void;
  onAttach: (file: File) => void;
  attachments: PendingAttachment[];
  onRemoveAttachment: (path: string) => void;
  disabled?: boolean;
  uploading?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dictating, setDictating] = useState(false);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const stopDictation = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  useEffect(() => () => stopDictation.current?.(), []);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!streaming && value.trim()) onSend();
    }
  };

  const toggleDictation = () => {
    if (dictating) {
      stopDictation.current?.();
      stopDictation.current = null;
      setDictating(false);
      return;
    }
    setDictationError(null);
    const stop = startDictation(
      (text) => onChange(`${value ? `${value} ` : ''}${text}`),
      (message) => {
        setDictationError(message);
        setDictating(false);
        stopDictation.current = null;
      },
    );
    if (stop) {
      stopDictation.current = stop;
      setDictating(true);
    } else {
      setDictationError('Voice input is not available in this browser.');
    }
  };

  const activeProvider = providers.find((p) => p.id === providerId);

  return (
    <div className="border-t border-line/60 bg-bg/80 px-3 pb-3 pt-2.5 backdrop-blur">
      <div className="mx-auto max-w-3xl">
        {(attachments.length > 0 || uploading) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((file) => (
              <span
                key={file.path}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-raised/70 px-2 py-1 text-[11px] text-muted"
              >
                <Paperclip size={11} /> {file.name}
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(file.path)}
                  className="text-muted hover:text-bad"
                  aria-label={`Remove ${file.name}`}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            {uploading && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-raised/70 px-2 py-1 text-[11px] text-cyan">
                <Loader2 size={11} className="animate-spin" /> Uploading…
              </span>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-line bg-surface/90 p-2 shadow-xl shadow-black/30 focus-within:border-cyan/50">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={
              disabled ? 'Select or create a conversation…' : 'Ask JOBBY to research, match or draft…'
            }
            className="max-h-[220px] w-full resize-none bg-transparent px-2.5 py-2 text-[15px] leading-relaxed text-ink placeholder:text-muted/60 focus:outline-none"
            disabled={disabled}
          />

          <div className="flex items-center gap-1.5 px-1">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.md,.json,image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onAttach(file);
                event.target.value = '';
              }}
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={() => fileRef.current?.click()}
              aria-label="Attach a file"
              title="Attach a file"
              disabled={disabled}
            >
              <Paperclip size={15} />
            </Button>

            {isSpeechSupported() && (
              <Button
                size="icon"
                variant="ghost"
                onClick={toggleDictation}
                aria-label={dictating ? 'Stop dictation' : 'Dictate a message'}
                title={dictating ? 'Stop dictation' : 'Dictate a message'}
                className={cn(dictating && 'text-bad')}
                disabled={disabled}
              >
                <Mic size={15} />
              </Button>
            )}

            <div className="min-w-0 flex-1">
              <Select
                aria-label="Model provider"
                value={providerId}
                onChange={(event) => onProviderChange(event.target.value)}
                className="h-8 border-transparent bg-transparent px-2 py-0 text-[11px] text-muted hover:border-line"
                disabled={disabled}
              >
                <option value="">JOBBY default (OpenRouter)</option>
                {providers
                  .filter((p) => p.enabled)
                  .map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.provider_name} · {provider.model_name}
                    </option>
                  ))}
              </Select>
            </div>

            {activeProvider && !activeProvider.has_credential && (
              <span className="hidden text-[10px] text-warn sm:inline">no key</span>
            )}

            {streaming ? (
              <Button size="icon" variant="danger" onClick={onStop} aria-label="Stop generation">
                <Square size={13} />
              </Button>
            ) : (
              <Button
                size="icon"
                variant="primary"
                onClick={onSend}
                disabled={disabled || !value.trim()}
                aria-label="Send message"
              >
                <ArrowUp size={16} />
              </Button>
            )}
          </div>
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-2 px-1">
          <p className="text-[10px] text-muted/50">
            Enter sends · Shift+Enter newline · external actions need approval
          </p>
          {dictationError && <p className="text-[10px] text-bad">{dictationError}</p>}
          {dictating && <Badge tone="bad">listening…</Badge>}
        </div>
      </div>
    </div>
  );
}
