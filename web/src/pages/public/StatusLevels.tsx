import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { money } from '../../lib/format';
import { useSettings } from '../../store/settings';
import { usePageMeta } from '../../hooks/usePageMeta';
import { PublicHeader } from '../../components/home/PublicHeader';
import { SiteFooter } from '../../components/home/Sections';

/** How status levels work, built entirely from the same public settings the terminal reads. */
export function PublicStatusLevels() {
  const { t } = useTranslation();
  usePageMeta({
    title: t('statusLevels.title'),
    description: t('statusLevels.description'),
  });

  const values = useSettings((s) => s.values);
  const enabled = values['growth.statusEnabled'] !== false;

  const levels = [
    { name: t('home.statusLevels.standard'), threshold: 0, payoutBonus: 0, depositBonus: 0, priority: false },
    {
      name: (values['growth.statusProName'] as string) ?? 'Pro',
      threshold: (values['growth.statusProThreshold'] as number) ?? 100_000,
      payoutBonus: (values['growth.statusProPayoutBonus'] as number) ?? 2,
      depositBonus: (values['growth.statusProDepositBonus'] as number) ?? 0,
      priority: true,
    },
    {
      name: (values['growth.statusVipName'] as string) ?? 'VIP',
      threshold: (values['growth.statusVipThreshold'] as number) ?? 1_000_000,
      payoutBonus: (values['growth.statusVipPayoutBonus'] as number) ?? 4,
      depositBonus: (values['growth.statusVipDepositBonus'] as number) ?? 5,
      priority: true,
    },
  ];

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-5xl px-4 pb-20 pt-4">
        <h1 className="text-3xl font-bold tracking-tight">{t('statusLevels.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">{t('statusLevels.description')}</p>

        {!enabled && <p className="card mt-8 p-6 text-sm text-slate-400">{t('statusLevels.notEnabled')}</p>}

        {enabled && (
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-3">
            {levels.map((level, i) => (
              <div key={level.name} className={`card p-6 ${i === levels.length - 1 ? 'border-accent' : ''}`}>
                <p className="text-lg font-bold">{level.name}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {level.threshold === 0
                    ? t('statusLevels.fromFirstTrade')
                    : t('statusLevels.fromLifetimeDeposits', { amount: money(level.threshold) })}
                </p>
                <ul className="mt-5 space-y-2.5 text-sm text-slate-300">
                  <li>{t('statusLevels.payoutBonusOnEveryTrade', { pct: level.payoutBonus })}</li>
                  {level.depositBonus > 0 && (
                    <li>{t('statusLevels.depositBonusOnFuture', { pct: level.depositBonus })}</li>
                  )}
                  {level.priority && <li>{t('statusLevels.priorityWithdrawalReview')}</li>}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="card p-5">
            <p className="text-sm font-semibold">{t('statusLevels.howCalculatedTitle')}</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              {t('statusLevels.howCalculatedBody')}
            </p>
          </div>
          <div className="card p-5">
            <p className="text-sm font-semibold">{t('statusLevels.payoutBonusTitle')}</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{t('statusLevels.payoutBonusBody')}</p>
          </div>
        </div>

        <div className="mt-10 text-center">
          <Link to="/register" className="btn-primary !px-6 !py-3">
            {t('statusLevels.startBuildingStatus')}
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
