import * as Sentry from '@sentry/node';
import { env } from '../env.js';
import { log } from './logger.js';

/**
 * The one hook every genuinely unexpected error in the process passes
 * through: `middleware/error.ts`'s generic-500 branch, and `index.ts`'s
 * `uncaughtException`/`unhandledRejection` handlers and boot-failure catch.
 * A no-op when `SENTRY_DSN` is unset, so a deployment with nothing
 * configured behaves exactly as it did before this existed — same shape as
 * the mailer's outbox-without-SMTP or the storage provider's local-disk
 * default. Deliberately never called for an `AppError` (a validation
 * failure, a refused withdrawal, a 404): those are expected outcomes of
 * normal traffic, not faults, and routing every one of them to an error
 * tracker would bury the signal a real 500 is meant to be.
 */
const enabled = Boolean(env.sentryDsn);

if (enabled) {
  Sentry.init({
    dsn: env.sentryDsn!,
    environment: env.nodeEnv,
    // this platform already has structured request logging (pino/pino-http);
    // Sentry's job here is exception capture, not a second tracing system
    tracesSampleRate: 0,
  });
  log.boot.info('error tracking enabled (Sentry)');
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

/** Sentry batches and sends asynchronously — flush before the process exits or an event can be lost. */
export async function flushErrorTracking(timeoutMs = 2000): Promise<void> {
  if (!enabled) return;
  await Sentry.close(timeoutMs);
}

/** Exported for tests: whether a DSN was configured, without reaching into the module's closure. */
export function errorTrackingEnabled(): boolean {
  return enabled;
}
