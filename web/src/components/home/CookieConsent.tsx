import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';

const STORAGE_KEY = 'quantex.cookies.accepted';

function alreadyAccepted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * A cookie-consent banner, shown once per browser until accepted. The
 * platform's own cookies are functional (session, preferences) rather than
 * tracking, but the banner and the policy it links to exist regardless —
 * an operator who adds analytics later needs this disclosure already in
 * place, not bolted on afterwards.
 */
export function CookieConsent() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  // the terminal is full-bleed and suppresses every banner, same as
  // MaintenanceBanner/AnnouncementBanner in the authenticated shell
  const isTerminal = useLocation().pathname.startsWith('/trade');

  useEffect(() => {
    setVisible(!alreadyAccepted());
  }, []);

  const accept = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* a browser with storage denied just asks again next visit */
    }
    setVisible(false);
  };

  if (!visible || isTerminal) return null;

  return (
    <div
      role="region"
      aria-label={t('cookieConsent.ariaLabel')}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-ink-600 bg-ink-800 p-4 shadow-xl"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-slate-400">
          <Trans
            i18nKey="cookieConsent.message"
            components={{
              link: <Link to="/legal/cookie-policy" className="text-accent hover:underline" />,
            }}
          />
        </p>
        <button onClick={accept} className="btn-primary shrink-0 !px-4 !py-2 text-sm">
          {t('cookieConsent.accept')}
        </button>
      </div>
    </div>
  );
}
