import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from './ui';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches render errors so one broken panel cannot blank the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // No secrets in logs — stack traces only.
    console.error('[jobby] render error', error.message, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl border border-bad/40 bg-bad/10 text-bad">
            <TriangleAlert size={22} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Something broke in the interface</h1>
            <p className="mt-1 max-w-md text-sm text-muted">
              {this.state.error.message || 'An unexpected error occurred.'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload JOBBY
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
