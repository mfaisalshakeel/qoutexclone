import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Boom({ explode = true }: { explode?: boolean }): JSX.Element {
  if (explode) throw new Error('kaboom');
  return <p>all good</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs the caught error itself; keep the test output readable
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('all good')).toBeDefined();
  });

  it('catches a child error and offers a reload', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByRole('button', { name: /reload the page/i })).toBeDefined();
  });

  it('reports the error to the caller', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].message).toBe('kaboom');
  });

  it('keeps the rest of the page alive for an inline boundary', () => {
    render(
      <div>
        <p>sibling survives</p>
        <ErrorBoundary variant="inline" title="Chart unavailable">
          <Boom />
        </ErrorBoundary>
      </div>,
    );
    expect(screen.getByText('sibling survives')).toBeDefined();
    expect(screen.getByText('Chart unavailable')).toBeDefined();
    expect(screen.getByRole('button', { name: /try again/i })).toBeDefined();
  });

  it('clears the error when the reset key changes', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/trade">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeDefined();

    rerender(
      <ErrorBoundary resetKey="/wallet">
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('all good')).toBeDefined();
  });
});
