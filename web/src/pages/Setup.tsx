import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { IconLogo } from '../components/Icons';
import { usePageMeta } from '../hooks/usePageMeta';

type Step = 'welcome' | 'database' | 'admin' | 'review' | 'installing' | 'done';

interface DbForm {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
}

interface AdminForm {
  email: string;
  password: string;
  confirm: string;
}

const STEP_ORDER: Step[] = ['welcome', 'database', 'admin', 'review', 'installing', 'done'];
const STEP_LABELS: Record<Step, string> = {
  welcome: 'Welcome',
  database: 'Database',
  admin: 'Admin account',
  review: 'Review',
  installing: 'Installing',
  done: 'Done',
};

/**
 * The first-run setup wizard. Reached whenever `GET /api/setup/status`
 * answers `{ configured: false }` — before `server/.env` carries a
 * `DATABASE_URL`, the API is a completely different, minimal server
 * (`server/src/setup/setup-server.ts`) that only knows how to test a
 * database connection and write that file, migrate and seed against it.
 * `install.sh` is the same installer for a terminal; this is it for a
 * browser, for the cPanel/shared-hosting case where nobody has a shell.
 */
export function Setup() {
  usePageMeta({ title: 'Set up Quantex', noindex: true });

  const [step, setStep] = useState<Step>('welcome');
  const [requirements, setRequirements] = useState<{
    node: { version: string; ok: boolean; required: string };
  } | null>(null);

  const [db, setDb] = useState<DbForm>({
    host: '127.0.0.1',
    port: '3306',
    database: 'quotex',
    user: 'quotex',
    password: '',
  });
  const [dbTested, setDbTested] = useState(false);
  const [dbTesting, setDbTesting] = useState(false);
  const [dbError, setDbError] = useState('');

  const [admin, setAdmin] = useState<AdminForm>({
    email: 'admin@quotexclone.dev',
    password: '',
    confirm: '',
  });
  const [adminError, setAdminError] = useState('');

  const [installError, setInstallError] = useState('');
  const [waitingForRestart, setWaitingForRestart] = useState(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    api
      .get<{ node: { version: string; ok: boolean; required: string } }>('/setup/requirements')
      .then(setRequirements)
      .catch(() => setRequirements(null));
  }, []);

  useEffect(
    () => () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    },
    [],
  );

  const testDb = async () => {
    setDbTesting(true);
    setDbError('');
    setDbTested(false);
    try {
      await api.post('/setup/test-db', {
        host: db.host,
        port: Number(db.port),
        database: db.database,
        user: db.user,
        password: db.password,
      });
      setDbTested(true);
    } catch (err) {
      setDbError(err instanceof ApiError ? err.message : 'Could not reach the database.');
    } finally {
      setDbTesting(false);
    }
  };

  const submitAdmin = (event: React.FormEvent) => {
    event.preventDefault();
    setAdminError('');
    if (admin.password.length < 8) {
      setAdminError('Password must be at least 8 characters.');
      return;
    }
    if (admin.password !== admin.confirm) {
      setAdminError('Passwords do not match.');
      return;
    }
    setStep('review');
  };

  const install = async () => {
    setStep('installing');
    setInstallError('');
    try {
      await api.post('/setup/install', {
        db: {
          host: db.host,
          port: Number(db.port),
          database: db.database,
          user: db.user,
          password: db.password,
        },
        admin: { email: admin.email, password: admin.password },
      });
      setStep('done');
      setWaitingForRestart(true);
      // the app process exits right after this response so its process
      // manager restarts it in configured mode — poll for that instead of
      // assuming any particular restart time
      const startedAt = Date.now();
      pollRef.current = window.setInterval(async () => {
        try {
          const status = await api.get<{ configured: boolean }>('/setup/status');
          if (status.configured) {
            if (pollRef.current) window.clearInterval(pollRef.current);
            window.location.href = '/login';
          }
        } catch {
          // the process is mid-restart and not answering yet — keep polling
        }
        if (Date.now() - startedAt > 60_000 && pollRef.current) {
          window.clearInterval(pollRef.current);
          setWaitingForRestart(false);
        }
      }, 2000);
    } catch (err) {
      setInstallError(
        err instanceof ApiError ? err.message : 'Something went wrong finishing the installation.',
      );
      setStep('review');
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <IconLogo className="h-9 w-9" />
        <span className="text-xl font-bold tracking-tight">Quantex</span>
      </div>

      <ol className="mb-6 flex w-full max-w-lg items-center justify-between text-[11px] text-slate-500">
        {STEP_ORDER.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-1.5 last:flex-none">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                STEP_ORDER.indexOf(step) >= i ? 'bg-accent-solid text-slate-100' : 'bg-ink-600 text-slate-400'
              }`}
            >
              {i + 1}
            </span>
            <span className={`hidden sm:inline ${STEP_ORDER.indexOf(step) >= i ? 'text-slate-200' : ''}`}>
              {STEP_LABELS[s]}
            </span>
            {i < STEP_ORDER.length - 1 && <span className="h-px flex-1 bg-ink-600" />}
          </li>
        ))}
      </ol>

      <div className="card w-full max-w-lg p-6 sm:p-8">
        {step === 'welcome' && (
          <>
            <h1 className="text-xl font-bold">Set up Quantex</h1>
            <p className="mb-6 mt-1 text-sm text-slate-400">
              No configuration was found. This wizard collects what the platform needs to run — a database and
              an admin account — and installs it. It only appears until that is done.
            </p>
            <ul className="mb-6 space-y-2 text-sm">
              <li className="flex items-center justify-between rounded-lg bg-ink-700 px-3 py-2">
                <span>Node.js {requirements?.node.required ?? '20+'}</span>
                {requirements && (
                  <span className={requirements.node.ok ? 'text-up' : 'text-down'}>
                    {requirements.node.version} {requirements.node.ok ? '✓' : '✗'}
                  </span>
                )}
              </li>
              <li className="rounded-lg bg-ink-700 px-3 py-2">
                MySQL 8 or MariaDB 10.4+ reachable from this server
              </li>
            </ul>
            <button className="btn-primary w-full" onClick={() => setStep('database')}>
              Get started
            </button>
          </>
        )}

        {step === 'database' && (
          <>
            <h1 className="text-xl font-bold">Database connection</h1>
            <p className="mb-6 mt-1 text-sm text-slate-400">
              The account below needs permission to create tables in this database.
            </p>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-1">
                  <label className="label" htmlFor="db-host">
                    Host
                  </label>
                  <input
                    id="db-host"
                    className="field"
                    value={db.host}
                    onChange={(e) => {
                      setDb({ ...db, host: e.target.value });
                      setDbTested(false);
                    }}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="db-port">
                    Port
                  </label>
                  <input
                    id="db-port"
                    inputMode="numeric"
                    className="field"
                    value={db.port}
                    onChange={(e) => {
                      setDb({ ...db, port: e.target.value });
                      setDbTested(false);
                    }}
                  />
                </div>
              </div>
              <div>
                <label className="label" htmlFor="db-name">
                  Database name
                </label>
                <input
                  id="db-name"
                  className="field"
                  value={db.database}
                  onChange={(e) => {
                    setDb({ ...db, database: e.target.value });
                    setDbTested(false);
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="db-user">
                    User
                  </label>
                  <input
                    id="db-user"
                    className="field"
                    value={db.user}
                    onChange={(e) => {
                      setDb({ ...db, user: e.target.value });
                      setDbTested(false);
                    }}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="db-password">
                    Password
                  </label>
                  <input
                    id="db-password"
                    type="password"
                    className="field"
                    value={db.password}
                    onChange={(e) => {
                      setDb({ ...db, password: e.target.value });
                      setDbTested(false);
                    }}
                  />
                </div>
              </div>

              {dbError && (
                <p role="alert" className="rounded-lg bg-down-soft px-3 py-2 text-sm text-down">
                  {dbError}
                </p>
              )}
              {dbTested && (
                <p className="rounded-lg bg-up-soft px-3 py-2 text-sm text-up">Connected successfully.</p>
              )}

              <div className="flex gap-2">
                <button className="btn-ghost flex-1" onClick={() => void testDb()} disabled={dbTesting}>
                  {dbTesting ? 'Testing…' : 'Test connection'}
                </button>
                <button className="btn-primary flex-1" disabled={!dbTested} onClick={() => setStep('admin')}>
                  Next
                </button>
              </div>
            </div>
          </>
        )}

        {step === 'admin' && (
          <>
            <h1 className="text-xl font-bold">Admin account</h1>
            <p className="mb-6 mt-1 text-sm text-slate-400">
              You will sign in with this once the install finishes.
            </p>
            <form onSubmit={submitAdmin} className="space-y-4">
              <div>
                <label className="label" htmlFor="admin-email">
                  Email
                </label>
                <input
                  id="admin-email"
                  type="email"
                  required
                  className="field"
                  value={admin.email}
                  onChange={(e) => setAdmin({ ...admin, email: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="admin-password">
                  Password
                </label>
                <input
                  id="admin-password"
                  type="password"
                  required
                  className="field"
                  value={admin.password}
                  onChange={(e) => setAdmin({ ...admin, password: e.target.value })}
                  placeholder="At least 8 characters"
                />
              </div>
              <div>
                <label className="label" htmlFor="admin-confirm">
                  Confirm password
                </label>
                <input
                  id="admin-confirm"
                  type="password"
                  required
                  className="field"
                  value={admin.confirm}
                  onChange={(e) => setAdmin({ ...admin, confirm: e.target.value })}
                />
              </div>
              {adminError && (
                <p role="alert" className="rounded-lg bg-down-soft px-3 py-2 text-sm text-down">
                  {adminError}
                </p>
              )}
              <div className="flex gap-2">
                <button type="button" className="btn-ghost flex-1" onClick={() => setStep('database')}>
                  Back
                </button>
                <button type="submit" className="btn-primary flex-1">
                  Next
                </button>
              </div>
            </form>
          </>
        )}

        {step === 'review' && (
          <>
            <h1 className="text-xl font-bold">Review</h1>
            <p className="mb-6 mt-1 text-sm text-slate-400">
              This writes the configuration and sets up the database.
            </p>
            <dl className="mb-6 space-y-2 text-sm">
              <div className="flex justify-between rounded-lg bg-ink-700 px-3 py-2">
                <dt className="text-slate-400">Database</dt>
                <dd className="tabular">
                  {db.user}@{db.host}:{db.port}/{db.database}
                </dd>
              </div>
              <div className="flex justify-between rounded-lg bg-ink-700 px-3 py-2">
                <dt className="text-slate-400">Admin email</dt>
                <dd>{admin.email}</dd>
              </div>
            </dl>
            {installError && (
              <p role="alert" className="mb-4 rounded-lg bg-down-soft px-3 py-2 text-sm text-down">
                {installError}
              </p>
            )}
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setStep('admin')}>
                Back
              </button>
              <button className="btn-primary flex-1" onClick={() => void install()}>
                Install now
              </button>
            </div>
          </>
        )}

        {step === 'installing' && (
          <div className="py-6 text-center">
            <div
              aria-hidden
              className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-ink-500 border-t-accent"
            />
            <h1 className="text-xl font-bold">Installing…</h1>
            <p className="mt-1 text-sm text-slate-400">
              Setting up the database and creating your admin account.
            </p>
          </div>
        )}

        {step === 'done' && (
          <div className="py-6 text-center">
            {waitingForRestart ? (
              <>
                <div
                  aria-hidden
                  className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-ink-500 border-t-accent"
                />
                <h1 className="text-xl font-bold">Installation complete</h1>
                <p className="mt-1 text-sm text-slate-400">
                  Restarting the application — this page will move on to sign-in automatically.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-xl font-bold text-up">Installation complete</h1>
                <p className="mt-1 text-sm text-slate-400">
                  The application did not restart on its own within a minute — that is expected on some hosts.
                  Restart it yourself (for example, from your host's Node app manager, or{' '}
                  <code className="rounded bg-ink-700 px-1 py-0.5">pm2 restart quantex</code>), then reload
                  this page.
                </p>
                <button className="btn-primary mt-4" onClick={() => window.location.reload()}>
                  Reload
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
