import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '../lib/cn';

export type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

/** Callable toast helper with convenience shortcuts. */
export interface ToastFn {
  (message: string, tone?: ToastTone): void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastFn | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const value = useMemo<ToastFn>(() => {
    const fn = ((message: string, tone: ToastTone = 'info') => {
      counter.current += 1;
      const id = counter.current;
      setToasts((current) => [...current.slice(-3), { id, message, tone }]);
      window.setTimeout(() => dismiss(id), 5200);
    }) as ToastFn;
    fn.success = (message: string) => fn(message, 'success');
    fn.error = (message: string) => fn(message, 'error');
    fn.info = (message: string) => fn(message, 'info');
    return fn;
  }, [dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-24 z-100 flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm shadow-2xl backdrop-blur',
              t.tone === 'success' && 'border-good/40 bg-[#06231d]/95 text-good',
              t.tone === 'error' && 'border-bad/40 bg-[#2a0b12]/95 text-bad',
              t.tone === 'info' && 'border-line bg-surface/95 text-ink',
            )}
          >
            {t.tone === 'success' && <CheckCircle2 size={16} className="mt-0.5 shrink-0" />}
            {t.tone === 'error' && <TriangleAlert size={16} className="mt-0.5 shrink-0" />}
            {t.tone === 'info' && <Info size={16} className="mt-0.5 shrink-0 text-cyan" />}
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="text-muted transition hover:text-ink"
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
