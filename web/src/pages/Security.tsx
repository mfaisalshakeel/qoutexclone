import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ApiError, api } from '../lib/api';
import { dateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';
import { Skeleton } from '../components/Skeleton';

interface SessionRow {
  id: string;
  device: string;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
}

interface LoginRow {
  id: string;
  outcome: string;
  ip: string | null;
  device: string;
  newDevice: boolean;
  createdAt: string;
}

interface SecurityState {
  emailVerifiedAt: string | null;
  emailVerification: 'off' | 'optional' | 'required';
  twoFactorEnabled: boolean;
  twoFactorEnabledAt: string | null;
  backupCodesLeft: number;
  sessions: SessionRow[];
  events: LoginRow[];
}

/** What each login outcome is called where a trader will read it. */
const OUTCOMES: Record<string, { label: string; tone: string }> = {
  SUCCESS: { label: 'Signed in', tone: 'text-up' },
  BAD_PASSWORD: { label: 'Wrong password', tone: 'text-down' },
  UNKNOWN_EMAIL: { label: 'Unknown address', tone: 'text-down' },
  SUSPENDED: { label: 'Blocked — account suspended', tone: 'text-down' },
  TWO_FACTOR_REQUIRED: { label: 'Password accepted, code requested', tone: 'text-slate-400' },
  TWO_FACTOR_FAILED: { label: 'Wrong code', tone: 'text-down' },
};

export function Security() {
  const { user, refreshUser } = useAuth();
  const [state, setState] = useState<SecurityState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setState(await api.get<SecurityState>('/me/security'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your security settings');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (key: string, run: () => Promise<void>) => {
    setBusy(key);
    try {
      await run();
      await load();
    } catch (err) {
      toast.error('That did not work', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="card p-6 text-center">
          <p className="text-sm text-slate-300">{error}</p>
          <button onClick={() => void load()} className="btn-primary mt-4">
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {[0, 1, 2].map((index) => (
          <div key={index} className="card space-y-3 p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-lg font-bold">Security</h1>
        <p className="text-sm text-slate-400">
          Your address, your second factor, and everywhere this account is signed in.
        </p>
      </header>

      <EmailSection
        state={state}
        busy={busy === 'verify'}
        onResend={() =>
          act('verify', async () => {
            await api.post('/me/verify-email/resend');
            toast.success('Confirmation sent', 'Check your inbox for the link.');
          })
        }
      />

      <TwoFactorSection
        state={state}
        busy={busy}
        onChanged={async () => {
          await refreshUser();
          await load();
        }}
        act={act}
      />

      <SessionsSection
        sessions={state.sessions}
        busy={busy}
        onRevoke={(id) =>
          act(`session-${id}`, async () => {
            await api.del(`/me/sessions/${id}`);
            toast.success('Device signed out');
          })
        }
        onRevokeOthers={() =>
          act('revoke-others', async () => {
            const { count } = await api.post<{ count: number }>('/me/sessions/revoke-others');
            toast.success(
              count === 0 ? 'No other devices were signed in' : `Signed ${count} other device(s) out`,
            );
          })
        }
      />

      <HistorySection events={state.events} />

      {user?.role === 'ADMIN' && (
        <p className="text-xs text-slate-500">
          Administrators are expected to keep two-factor authentication on.
        </p>
      )}
    </div>
  );
}

function EmailSection({
  state,
  busy,
  onResend,
}: {
  state: SecurityState;
  busy: boolean;
  onResend: () => void;
}) {
  const verified = state.emailVerifiedAt !== null;
  return (
    <section className="card space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">Email address</h2>
        <span className={`chip ${verified ? 'bg-up-soft text-up' : 'bg-down-soft text-down'}`}>
          {verified ? 'confirmed' : 'not confirmed'}
        </span>
      </div>
      {verified ? (
        <p className="text-sm text-slate-400">Confirmed on {dateTime(state.emailVerifiedAt!)}.</p>
      ) : (
        <>
          <p className="text-sm text-slate-400">
            {state.emailVerification === 'required'
              ? 'Deposits and withdrawals stay closed until you confirm this address.'
              : 'Confirming your address is how your account can be recovered if you lose your password.'}
          </p>
          <button onClick={onResend} disabled={busy} className="btn-primary">
            {busy ? 'Sending…' : 'Send the link again'}
          </button>
        </>
      )}
    </section>
  );
}

function TwoFactorSection({
  state,
  busy,
  act,
  onChanged,
}: {
  state: SecurityState;
  busy: string | null;
  act: (key: string, run: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState('');
  const [disabling, setDisabling] = useState(false);

  const begin = () =>
    act('2fa-setup', async () => {
      const enrolment = await api.post<{ secret: string; otpauthUrl: string }>('/me/2fa/setup');
      // rendered here rather than fetched: the secret never leaves the browser
      const qr = await QRCode.toDataURL(enrolment.otpauthUrl, { margin: 1, width: 220 });
      setSetup({ ...enrolment, qr });
    });

  const confirm = (event: React.FormEvent) => {
    event.preventDefault();
    void act('2fa-enable', async () => {
      const { backupCodes } = await api.post<{ backupCodes: string[] }>('/me/2fa/enable', { code });
      setSetup(null);
      setCode('');
      setCodes(backupCodes);
      await onChanged();
    });
  };

  const turnOff = (event: React.FormEvent) => {
    event.preventDefault();
    void act('2fa-disable', async () => {
      await api.post('/me/2fa/disable', { password, code });
      setDisabling(false);
      setPassword('');
      setCode('');
      setCodes(null);
      await onChanged();
      toast.success('Two-factor authentication is off');
    });
  };

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">Two-factor authentication</h2>
        <span
          className={`chip ${state.twoFactorEnabled ? 'bg-up-soft text-up' : 'bg-ink-600 text-slate-300'}`}
        >
          {state.twoFactorEnabled ? 'on' : 'off'}
        </span>
      </div>

      {codes && <BackupCodes codes={codes} onDone={() => setCodes(null)} />}

      {!state.twoFactorEnabled && !setup && !codes && (
        <>
          <p className="text-sm text-slate-400">
            A code from an authenticator app, on top of your password. It is the single most useful thing you
            can turn on here.
          </p>
          <button onClick={() => void begin()} disabled={busy === '2fa-setup'} className="btn-primary">
            {busy === '2fa-setup' ? 'Preparing…' : 'Turn it on'}
          </button>
        </>
      )}

      {setup && (
        <form onSubmit={confirm} className="space-y-4">
          <p className="text-sm text-slate-400">
            Scan this with your authenticator app, then type the six-digit code it shows.
          </p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <img
              src={setup.qr}
              alt="QR code for your authenticator app"
              className="h-[180px] w-[180px] shrink-0 self-start rounded-xl bg-white p-2"
            />
            <div className="min-w-0 space-y-2">
              <p className="text-xs text-slate-400">Or type the key in by hand:</p>
              <code className="block break-all rounded-lg bg-ink-700/60 px-3 py-2 font-mono text-xs">
                {setup.secret}
              </code>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="enrol-code">
              Six-digit code
            </label>
            <input
              id="enrol-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="field tabular max-w-[180px] tracking-[0.3em]"
              placeholder="000000"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy === '2fa-enable'} className="btn-primary">
              {busy === '2fa-enable' ? 'Checking…' : 'Confirm'}
            </button>
            <button type="button" onClick={() => setSetup(null)} className="btn-ghost">
              Cancel
            </button>
          </div>
        </form>
      )}

      {state.twoFactorEnabled && !codes && (
        <>
          <p className="text-sm text-slate-400">
            On since {dateTime(state.twoFactorEnabledAt!)}. You have {state.backupCodesLeft} backup code
            {state.backupCodesLeft === 1 ? '' : 's'} left.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                void act('2fa-codes', async () => {
                  const { backupCodes } = await api.post<{ backupCodes: string[] }>('/me/2fa/backup-codes', {
                    code,
                  });
                  setCodes(backupCodes);
                  setCode('');
                })
              }
              disabled={busy === '2fa-codes' || code.length < 6}
              className="btn-ghost"
            >
              New backup codes
            </button>
            <button onClick={() => setDisabling((open) => !open)} className="btn-ghost !text-down">
              Turn it off
            </button>
          </div>
          {!disabling && (
            <div>
              <label className="label" htmlFor="current-code">
                Current code
              </label>
              <input
                id="current-code"
                inputMode="text"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="field tabular max-w-[180px] tracking-[0.2em]"
                placeholder="000000"
              />
              <p className="mt-1 text-xs text-slate-500">
                Needed before new backup codes are issued — the old ones stop working.
              </p>
            </div>
          )}
          {disabling && (
            <form onSubmit={turnOff} className="space-y-3 rounded-xl bg-ink-700/50 p-4">
              <p className="text-sm text-slate-300">
                Turning this off leaves your password as the only thing between anyone and your account.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="off-password">
                    Your password
                  </label>
                  <input
                    id="off-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="field"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="off-code">
                    Current code
                  </label>
                  <input
                    id="off-code"
                    inputMode="text"
                    autoComplete="one-time-code"
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    className="field tabular tracking-[0.2em]"
                    placeholder="000000"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={busy === '2fa-disable'} className="btn-primary !bg-down">
                  {busy === '2fa-disable' ? 'Turning off…' : 'Turn off two-factor'}
                </button>
                <button type="button" onClick={() => setDisabling(false)} className="btn-ghost">
                  Keep it on
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}

/** Shown exactly once. There is no way to see these again, by design. */
function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3 rounded-xl border border-accent/40 bg-accent/5 p-4">
      <p className="text-sm font-semibold">Save these backup codes now</p>
      <p className="text-xs text-slate-400">
        Each one signs you in once if you lose your phone. This is the only time they are shown.
      </p>
      <ul className="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-3">
        {codes.map((code) => (
          <li key={code} className="tabular rounded-lg bg-ink-800/70 px-2 py-1.5 text-center">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(codes.join('\n'));
            setCopied(true);
          }}
          className="btn-ghost"
        >
          {copied ? 'Copied' : 'Copy to clipboard'}
        </button>
        <button onClick={onDone} className="btn-primary">
          I have saved them
        </button>
      </div>
    </div>
  );
}

function SessionsSection({
  sessions,
  busy,
  onRevoke,
  onRevokeOthers,
}: {
  sessions: SessionRow[];
  busy: string | null;
  onRevoke: (id: string) => void;
  onRevokeOthers: () => void;
}) {
  const others = sessions.filter((session) => !session.current).length;
  return (
    <section className="card space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Devices</h2>
        <button
          onClick={onRevokeOthers}
          disabled={busy === 'revoke-others' || others === 0}
          className="btn-ghost !text-down disabled:!text-slate-500"
        >
          Log out other devices
        </button>
      </div>
      <ul className="space-y-2">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="flex flex-col gap-2 rounded-xl bg-ink-700/50 p-3 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {session.device}
                {session.current && <span className="chip ml-2 bg-up-soft text-up">this device</span>}
              </p>
              <p className="truncate text-xs text-slate-400">
                {session.ip ?? 'unknown address'} · signed in {dateTime(session.createdAt)}
              </p>
            </div>
            {!session.current && (
              <button
                onClick={() => onRevoke(session.id)}
                disabled={busy === `session-${session.id}`}
                className="btn-ghost self-start !py-1.5 !text-xs !text-down sm:self-auto"
              >
                Sign out
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function HistorySection({ events }: { events: LoginRow[] }) {
  return (
    <section className="card space-y-3 p-5">
      <h2 className="text-sm font-semibold">Recent sign-in attempts</h2>
      {events.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing recorded yet.</p>
      ) : (
        <ul className="divide-y divide-ink-600/70">
          {events.map((event) => {
            const outcome = OUTCOMES[event.outcome] ?? { label: event.outcome, tone: 'text-slate-400' };
            return (
              <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                <span className={`text-sm font-semibold ${outcome.tone}`}>{outcome.label}</span>
                {event.newDevice && <span className="chip bg-accent/15 text-accent">new device</span>}
                <span className="text-xs text-slate-400">
                  {event.device} · {event.ip ?? 'unknown address'}
                </span>
                <span className="ml-auto text-xs text-slate-500">{dateTime(event.createdAt)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
