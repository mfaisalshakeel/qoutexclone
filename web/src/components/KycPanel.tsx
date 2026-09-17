import { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { dateTime } from '../lib/format';
import { toast } from '../store/toast';
import { useAuth } from '../store/auth';
import { FormSkeleton } from './Skeleton';

interface KycState {
  status: 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedAt: string | null;
  required: boolean;
  thresholdUsd: number;
  submission: {
    id: string;
    status: string;
    note: string | null;
    documentType: string;
    createdAt: string;
    reviewedAt: string | null;
  } | null;
}

const DOCUMENTS = [
  { value: 'PASSPORT', label: 'Passport' },
  { value: 'ID_CARD', label: 'National ID card' },
  { value: 'DRIVING_LICENCE', label: 'Driving licence' },
];

const TONE: Record<string, string> = {
  APPROVED: 'bg-up-soft text-up',
  PENDING: 'bg-amber-400/10 text-amber-300',
  REJECTED: 'bg-down-soft text-down',
  NOT_SUBMITTED: 'bg-ink-600 text-slate-400',
};

/** Identity verification: submit once, admin reviews, withdrawals unlock. */
export function KycPanel() {
  const refreshUser = useAuth((s) => s.refreshUser);
  const [state, setState] = useState<KycState | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    dateOfBirth: '',
    country: '',
    address: '',
    documentType: 'PASSPORT',
    documentNumber: '',
  });

  const load = () =>
    api
      .get<KycState>('/me/kyc')
      .then(setState)
      .catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/me/kyc', form);
      await load();
      await refreshUser();
      toast.success('Verification submitted', 'We will review your documents shortly');
    } catch (err) {
      toast.error('Could not submit', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <FormSkeleton fields={6} />;

  const canSubmit = state.status === 'NOT_SUBMITTED' || state.status === 'REJECTED';

  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Identity verification</h2>
          <p className="text-xs text-slate-500">
            {state.required
              ? state.thresholdUsd > 0
                ? `Required for withdrawals over $${state.thresholdUsd}`
                : 'Required before any withdrawal'
              : 'Optional on this platform, but it speeds up payouts'}
          </p>
        </div>
        <span className={`chip ${TONE[state.status]}`}>{state.status.replace(/_/g, ' ').toLowerCase()}</span>
      </div>

      {state.submission && state.status !== 'NOT_SUBMITTED' && (
        <div className="rounded-lg bg-ink-700/60 p-3 text-xs text-slate-400">
          <p>
            {DOCUMENTS.find((d) => d.value === state.submission!.documentType)?.label ??
              state.submission.documentType}{' '}
            submitted {dateTime(state.submission.createdAt)}
          </p>
          {state.submission.note && (
            <p className="mt-1 text-slate-300">Reviewer note: {state.submission.note}</p>
          )}
        </div>
      )}

      {state.status === 'APPROVED' && (
        <p className="rounded-lg bg-up-soft px-3 py-2 text-xs text-up">
          Your identity is verified — withdrawals are unlocked.
        </p>
      )}
      {state.status === 'PENDING' && (
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">
          Your documents are under review. This usually takes a few hours.
        </p>
      )}

      {canSubmit && (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="kyc-name">
                Full legal name
              </label>
              <input
                id="kyc-name"
                required
                minLength={3}
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                className="field"
              />
            </div>
            <div>
              <label className="label" htmlFor="kyc-dob">
                Date of birth
              </label>
              <input
                id="kyc-dob"
                type="date"
                required
                value={form.dateOfBirth}
                onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                className="field"
              />
            </div>
            <div>
              <label className="label" htmlFor="kyc-country">
                Country of residence
              </label>
              <input
                id="kyc-country"
                required
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                className="field"
              />
            </div>
            <div>
              <label className="label" htmlFor="kyc-doc-type">
                Document type
              </label>
              <select
                id="kyc-doc-type"
                value={form.documentType}
                onChange={(e) => setForm({ ...form, documentType: e.target.value })}
                className="field"
              >
                {DOCUMENTS.map((doc) => (
                  <option key={doc.value} value={doc.value}>
                    {doc.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="kyc-doc-number">
                Document number
              </label>
              <input
                id="kyc-doc-number"
                required
                minLength={3}
                value={form.documentNumber}
                onChange={(e) => setForm({ ...form, documentNumber: e.target.value })}
                className="field"
              />
            </div>
            <div>
              <label className="label" htmlFor="kyc-address">
                Residential address
              </label>
              <input
                id="kyc-address"
                required
                minLength={5}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="field"
              />
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Document images are uploaded to your operator's document store, never to the trading database.
            Submitting confirms the details above are yours.
          </p>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Submitting…' : state.status === 'REJECTED' ? 'Submit again' : 'Submit for verification'}
          </button>
        </form>
      )}
    </div>
  );
}
