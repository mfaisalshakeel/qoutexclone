import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../store/settings';
import { usePageMeta } from '../../hooks/usePageMeta';
import { PublicHeader } from '../../components/home/PublicHeader';
import { SiteFooter } from '../../components/home/Sections';

const STEP_KEYS = ['step1', 'step2', 'step3'] as const;

/** The referral programme, explained generically — the commission rate reads from the live platform setting. */
export function PublicAffiliate() {
  const { t } = useTranslation();
  const commissionPct =
    useSettings((s) => s.values['growth.referralCommissionPct'] as number | undefined) ?? 10;

  usePageMeta({
    title: t('affiliate.title'),
    description: t('affiliate.description', { pct: commissionPct }),
  });

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-4xl px-4 pb-20 pt-4">
        <h1 className="text-3xl font-bold tracking-tight">{t('affiliate.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          {t('affiliate.description', { pct: commissionPct })}
        </p>

        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {STEP_KEYS.map((key, i) => (
            <div key={key} className="card p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">
                {i + 1}
              </span>
              <p className="mt-3 text-sm font-semibold">{t(`affiliate.${key}Title`)}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{t(`affiliate.${key}Body`)}</p>
            </div>
          ))}
        </div>

        <div className="card mt-10 p-6">
          <p className="text-sm font-semibold">{t('affiliate.commissionTitle', { pct: commissionPct })}</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">{t('affiliate.commissionBody')}</p>
        </div>

        <div className="mt-10 text-center">
          <Link to="/register" className="btn-primary !px-6 !py-3">
            {t('affiliate.cta')}
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
