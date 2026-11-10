import { useCallback, useRef, useState } from 'react';
import { cancelAgentRun, streamChat } from '../../services/api';
import type { AgentStep, ChatStreamEvent } from '../../types';

interface ApprovalState {
  step: AgentStep;
  runId: string;
}

interface ChatState {
  streaming: boolean;
  draft: string;
  steps: AgentStep[];
  approval: ApprovalState | null;
  notice: string | null;
  error: string | null;
  runId: string | null;
}

const INITIAL: ChatState = {
  streaming: false,
  draft: '',
  steps: [],
  approval: null,
  notice: null,
  error: null,
  runId: null,
};

function upsertStep(steps: AgentStep[], next: AgentStep): AgentStep[] {
  const index = steps.findIndex((s) => s.id === next.id);
  if (index === -1) return [...steps, next];
  const copy = [...steps];
  copy[index] = { ...copy[index], ...next };
  return copy;
}

export interface SendInput {
  conversationId: string;
  content: string;
  providerId?: string | null;
  model?: string | null;
  skillIds?: string[];
}

export function useChatStream(options: { onComplete?: () => void } = {}) {
  const [state, setState] = useState<ChatState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  const { onComplete } = options;

  const handleEvent = useCallback((event: ChatStreamEvent) => {
    setState((prev) => {
      switch (event.type) {
        case 'run_start':
          return { ...prev, runId: event.runId, streaming: true, error: null };
        case 'delta':
          return { ...prev, draft: prev.draft + event.text };
        case 'step':
          return { ...prev, steps: upsertStep(prev.steps, event.step) };
        case 'approval_required':
          return {
            ...prev,
            approval: { step: event.step, runId: event.runId },
            steps: upsertStep(prev.steps, event.step),
          };
        case 'notice':
          return { ...prev, notice: event.message };
        case 'error':
          return { ...prev, error: event.message };
        case 'done':
          // A paused run ends its stream too: keep the approval card visible and
          // only clear the live draft once a normal answer has been persisted.
          return prev.approval ? prev : { ...prev, draft: '', steps: [] };
        default:
          return prev;
      }
    });
  }, []);

  const run = useCallback(
    async (
      payload:
        | { action: 'chat'; conversationId: string; content: string; providerId?: string | null; model?: string | null; skillIds?: string[] }
        | { action: 'approve'; stepId: string; approved: boolean; conversationId: string },
      resetDraft: boolean,
    ) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState((prev) => ({
        ...prev,
        streaming: true,
        error: null,
        notice: null,
        approval: resetDraft ? null : prev.approval,
        draft: resetDraft ? '' : prev.draft,
        steps: resetDraft ? [] : prev.steps,
      }));

      try {
        await streamChat(payload, handleEvent, controller.signal);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          setState((prev) => ({ ...prev, streaming: false, notice: 'Generation stopped.' }));
        } else {
          setState((prev) => ({
            ...prev,
            streaming: false,
            error: error instanceof Error ? error.message : 'The assistant request failed.',
          }));
        }
      } finally {
        setState((prev) => ({ ...prev, streaming: false }));
        onComplete?.();
      }
    },
    [handleEvent, onComplete],
  );

  const send = useCallback(
    (input: SendInput) =>
      run(
        {
          action: 'chat',
          conversationId: input.conversationId,
          content: input.content,
          providerId: input.providerId ?? null,
          model: input.model ?? null,
          skillIds: input.skillIds ?? [],
        },
        true,
      ),
    [run],
  );

  const resolveApproval = useCallback(
    (approved: boolean, conversationId: string) => {
      const approval = state.approval;
      if (!approval) return;
      setState((prev) => ({ ...prev, approval: null }));
      void run(
        {
          action: 'approve',
          stepId: approval.step.id,
          approved,
          conversationId,
        },
        false,
      );
    },
    [run, state.approval],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    if (state.runId) {
      void cancelAgentRun(state.runId).catch(() => {
        /* best effort — the stream abort already stops client work */
      });
    }
  }, [state.runId]);

  const reset = useCallback(() => setState(INITIAL), []);

  return { state, send, stop, reset, resolveApproval };
}
