import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../store/auth';
import { useSettings } from '../store/settings';
import { toast } from '../store/toast';

/**
 * A reminder to confirm the address, for accounts that have not.
 *
 * Dismissible for the session, not for ever: the address is how an account is
 * recovered, and when an operator has made verification mandatory it is also
 * what stands between the trader and their money.
 */
export function VerifyEmailBanner() {
  const user = useAuth((state) => state.user);
  const mode = useSettings((state) => state.values['security.emailVerification']) ?? 'optional';
  const [hidden, setHidden] = useState(false);
  const [sending, setSending] = useState(false);

  if (!user || user.emailVerifiedAt || mode === 'off' || hidden) return null;
  const required = mode === 'required';

  const resend = async () => {
    setSending(true);
    try {
      await api.post('/me/verify-email/resend');
      toast.success('Confirmation sent', 'Check your inbox for the link.');
    } catch (err) {
      toast.error('Could not send it', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      role="status"
      className={`border-b px-3 py-2.5 sm:px-4 ${
        required ? 'border-down/30 bg-down-soft' : 'border-accent/30 bg-accent/10'
      }`}
    >
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <p className={required ? 'text-down' : 'text-accent'}>
          {required
            ? 'Confirm your email address to deposit or withdraw.'
            : 'Confirm your email address so your account can be recovered.'}
        </p>
        <button onClick={() => void resend()} disabled={sending} className="font-semibold underline">
          {sending ? 'Sending…' : 'Send the link'}
        </button>
        <Link to="/account/security" className="text-slate-300 underline">
          Security settings
        </Link>
        <button
          onClick={() => setHidden(true)}
          aria-label="Hide this reminder"
          className="ml-auto rounded px-2 text-slate-400 transition hover:text-slate-200"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
