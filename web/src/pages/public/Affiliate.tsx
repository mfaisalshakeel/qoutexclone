import { Link } from 'react-router-dom';
import { useSettings } from '../../store/settings';
import { usePageMeta } from '../../hooks/usePageMeta';
import { PublicHeader } from '../../components/home/PublicHeader';
import { SiteFooter } from '../../components/home/Sections';

const STEPS = [
  {
    title: 'Create your account',
    body: 'Every account gets its own referral code, ready to share from day one.',
  },
  {
    title: 'Share your link',
    body: 'Send it to anyone — friends, a community, a following. There is no cap on how many people you can refer.',
  },
  {
    title: 'They trade, you earn',
    body: 'A commission on what they deposit lands in your own balance automatically, no monthly claim or minimum.',
  },
];

/** The referral programme, explained generically — the commission rate reads from the live platform setting. */
export function PublicAffiliate() {
  usePageMeta({
    title: 'Affiliate programme',
    description:
      'Earn a commission on every trader you refer, credited automatically with no minimum audience.',
  });

  const commissionPct =
    useSettings((s) => s.values['growth.referralCommissionPct'] as number | undefined) ?? 10;

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-4xl px-4 pb-20 pt-4">
        <h1 className="text-3xl font-bold tracking-tight">Affiliate programme</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          Earn {commissionPct}% of what the traders you refer deposit — for as long as they keep trading. No
          approval process, no minimum audience.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.title} className="card p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">
                {i + 1}
              </span>
              <p className="mt-3 text-sm font-semibold">{step.title}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{step.body}</p>
            </div>
          ))}
        </div>

        <div className="card mt-10 p-6">
          <p className="text-sm font-semibold">{commissionPct}% commission, straight to your balance</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            There is nothing to apply for and nothing to claim: once someone registers with your link and
            deposits, your commission is credited automatically. Your own account page shows every trader
            you've referred and what you've earned from each of them.
          </p>
        </div>

        <div className="mt-10 text-center">
          <Link to="/register" className="btn-primary !px-6 !py-3">
            Create an account and get your link
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
