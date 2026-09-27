import { Link } from 'react-router-dom';
import { money } from '../../lib/format';
import { useSettings } from '../../store/settings';
import { PublicHeader } from '../../components/home/PublicHeader';
import { SiteFooter } from '../../components/home/Sections';

/** How status levels work, built entirely from the same public settings the terminal reads. */
export function PublicStatusLevels() {
  const values = useSettings((s) => s.values);
  const enabled = values['growth.statusEnabled'] !== false;

  const levels = [
    { name: 'Standard', threshold: 0, payoutBonus: 0, depositBonus: 0, priority: false },
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
        <h1 className="text-3xl font-bold tracking-tight">Status levels</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          The more you trade, the more you keep. Status is based on your lifetime deposits and is applied
          automatically — no forms to fill in, no request to make.
        </p>

        {!enabled && (
          <p className="card mt-8 p-6 text-sm text-slate-400">
            Status levels are not currently active on this platform.
          </p>
        )}

        {enabled && (
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-3">
            {levels.map((level, i) => (
              <div key={level.name} className={`card p-6 ${i === levels.length - 1 ? 'border-accent' : ''}`}>
                <p className="text-lg font-bold">{level.name}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {level.threshold === 0
                    ? 'From your first trade'
                    : `From ${money(level.threshold)} lifetime deposits`}
                </p>
                <ul className="mt-5 space-y-2.5 text-sm text-slate-300">
                  <li>+{level.payoutBonus}% payout bonus on every trade</li>
                  {level.depositBonus > 0 && <li>+{level.depositBonus}% bonus on future deposits</li>}
                  {level.priority && <li>Priority withdrawal review</li>}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="card p-5">
            <p className="text-sm font-semibold">How it's calculated</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Your level is based on how much you have deposited in total, ever — not your balance, and not
              what you have traded. It only ever moves up.
            </p>
          </div>
          <div className="card p-5">
            <p className="text-sm font-semibold">What the payout bonus does</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              It is applied to your own position from your level alone. The market's own payout is unchanged,
              and nothing about it depends on what you or anyone else is trading.
            </p>
          </div>
        </div>

        <div className="mt-10 text-center">
          <Link to="/register" className="btn-primary !px-6 !py-3">
            Start building your status
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
