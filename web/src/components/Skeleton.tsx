import type { ReactNode } from 'react';

/**
 * Loading placeholders shaped like the content they stand in for, so the page
 * keeps its layout while data arrives instead of flashing an empty state.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

/** Announces the loading state once to screen readers; children stay decorative. */
export function SkeletonGroup({
  children,
  className = '',
  label = 'Loading',
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

/** Label + value tiles, matching the stat cards used across the app. */
export function StatSkeletons({ count = 4, className = '' }: { count?: number; className?: string }) {
  return (
    <SkeletonGroup className={className}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card space-y-2 p-3">
          <Skeleton className="h-2.5 w-14" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

/** Rows of an icon, two lines of text and a right-aligned figure. */
export function RowSkeletons({
  rows = 5,
  avatar = false,
  className = '',
  rowClassName = 'p-3.5',
}: {
  rows?: number;
  avatar?: boolean;
  className?: string;
  rowClassName?: string;
}) {
  return (
    <SkeletonGroup className={className}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`flex items-center gap-3 ${rowClassName}`}>
          {avatar && <Skeleton className="h-9 w-9 shrink-0 !rounded-full" />}
          <div className="min-w-0 flex-1 space-y-2">
            {/* varied widths read as real text rather than a barcode */}
            <Skeleton className={`h-3 ${['w-24', 'w-32', 'w-20', 'w-28'][i % 4]}`} />
            <Skeleton className={`h-2.5 ${['w-40', 'w-28', 'w-36', 'w-32'][i % 4]} max-w-full`} />
          </div>
          <div className="flex flex-col items-end gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-2.5 w-10" />
          </div>
        </div>
      ))}
    </SkeletonGroup>
  );
}

/** A table card: header strip plus body rows with a status pill at the end. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <SkeletonGroup className="card overflow-hidden">
      <div className="flex gap-6 bg-ink-700/60 px-4 py-3">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className={`h-2 flex-1 bg-ink-600 ${i === cols - 1 ? 'max-w-12 ml-auto' : ''}`} />
        ))}
      </div>
      <div className="divide-y divide-ink-700">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center gap-6 px-4 py-3.5">
            {Array.from({ length: cols }, (_, c) =>
              c === cols - 1 ? (
                <Skeleton key={c} className="ml-auto h-5 w-16 !rounded-full" />
              ) : (
                <div key={c} className="flex-1 space-y-1.5">
                  <Skeleton
                    className={`h-3 ${(r + c) % 3 === 0 ? 'w-4/5' : (r + c) % 3 === 1 ? 'w-3/5' : 'w-2/3'}`}
                  />
                  {c === 0 && <Skeleton className="h-2 w-2/5" />}
                </div>
              ),
            )}
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

/** Form-shaped panel: title row, a grid of labelled fields, a button. */
export function FormSkeleton({ fields = 4, className = '' }: { fields?: number; className?: string }) {
  return (
    <SkeletonGroup className={`card space-y-5 p-5 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-2.5 w-52 max-w-full" />
        </div>
        <Skeleton className="h-6 w-20 !rounded-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-10 w-full !rounded-lg" />
          </div>
        ))}
      </div>
      <Skeleton className="h-10 w-40 !rounded-lg" />
    </SkeletonGroup>
  );
}

/** Faint candle silhouettes behind the chart until history arrives. */
export function ChartSkeleton() {
  const bars = [
    38, 52, 44, 60, 55, 70, 62, 48, 58, 66, 74, 68, 80, 72, 64, 76, 84, 78, 70, 82, 88, 76, 68, 74,
  ];
  return (
    <SkeletonGroup label="Loading chart" className="absolute inset-0 flex flex-col bg-ink-800 p-4">
      <div className="flex min-h-0 flex-1 items-end gap-[3%] pr-14">
        {bars.map((height, i) => (
          <div
            key={i}
            aria-hidden
            className="skeleton flex-1 !rounded-sm"
            style={{ height: `${height * 0.5}%`, marginBottom: `${height * 0.3}%` }}
          />
        ))}
      </div>
      <div className="mt-3 flex justify-between pr-14">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-2 w-10" />
        ))}
      </div>
    </SkeletonGroup>
  );
}

/** Coin/network tiles and the amount form, while payment methods load. */
export function PaymentPanelSkeleton() {
  return (
    <SkeletonGroup label="Loading payment methods" className="space-y-5">
      <div>
        <Skeleton className="mb-2 h-2.5 w-36" />
        <div className="grid gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-ink-600 bg-ink-800 p-3">
              <Skeleton className="h-9 w-9 !rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-2.5 w-24" />
              </div>
              <Skeleton className="h-6 w-12" />
            </div>
          ))}
        </div>
      </div>
      <div className="card space-y-4 p-4">
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="h-11 w-full !rounded-lg" />
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 flex-1 !rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-11 w-full !rounded-lg" />
      </div>
    </SkeletonGroup>
  );
}
