// This file must import nothing that touches `env.ts` (or anything that
// imports it) before the configured-check below runs: `env.ts` validates
// `DATABASE_URL` at import time and calls `process.exit(1)` if it is
// missing, which is exactly the state a first install starts in. The setup
// wizard has to be able to serve a page in that state, so the branch has to
// happen before any such import, not inside one.
import './lib/load-env.js';

const configured = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0);

if (configured) {
  const [{ main }, { captureException, flushErrorTracking }] = await Promise.all([
    import('./boot.js'),
    import('./lib/error-tracking.js'),
  ]);
  main().catch((err) => {
    console.error('[boot] failed to start', err);
    captureException(err, { source: 'boot' });
    void flushErrorTracking().finally(() => process.exit(1));
  });
} else {
  const { startSetupServer } = await import('./setup/setup-server.js');
  startSetupServer().catch((err) => {
    console.error('[setup] failed to start', err);
    process.exit(1);
  });
}
