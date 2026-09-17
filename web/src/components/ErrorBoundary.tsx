import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Compact variant for boundaries inside a page (e.g. the chart). */
  variant?: 'page' | 'inline';
  /** Shown instead of the generic heading when given. */
  title?: string;
  /** Resetting key: when it changes the boundary clears its error. */
  resetKey?: string;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

/**
 * Stops one broken subtree from blanking the whole app.
 *
 * React gives no hook equivalent, so this stays a class. Page boundaries offer a
 * reload; inline ones offer a retry that re-mounts the subtree, which is enough
 * for a transient render failure (a bad candle, a missing field).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    // navigating away from a broken route clears the error
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ui] render failed:', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const title = this.props.title ?? 'Something went wrong';

    if (this.props.variant === 'inline') {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm font-semibold text-slate-200">{title}</p>
          <p className="max-w-sm text-xs text-slate-500">
            This panel could not be displayed. The rest of the page still works.
          </p>
          <button onClick={this.retry} className="btn-ghost text-xs">
            Try again
          </button>
        </div>
      );
    }

    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-down-soft text-down">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 8v5M12 16.5v.5" strokeLinecap="round" />
            <circle cx="12" cy="12" r="9" />
          </svg>
        </span>
        <div>
          <h1 className="text-lg font-bold">{title}</h1>
          <p className="mt-1 max-w-md text-sm text-slate-400">
            The page hit an unexpected error. Reloading usually fixes it — your balance and open positions are
            unaffected.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <button onClick={() => window.location.reload()} className="btn-primary">
            Reload the page
          </button>
          <button onClick={this.retry} className="btn-ghost">
            Try again
          </button>
        </div>
        {import.meta.env.DEV && (
          <pre className="max-w-full overflow-x-auto rounded-lg bg-ink-800 p-3 text-left text-[11px] text-down">
            {error.message}
          </pre>
        )}
      </div>
    );
  }
}
