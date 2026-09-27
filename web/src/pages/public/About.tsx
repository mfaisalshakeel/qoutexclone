import { Link } from 'react-router-dom';
import { PublicHeader } from '../../components/home/PublicHeader';
import { SiteFooter } from '../../components/home/Sections';

const VALUES = [
  {
    title: 'Prices belong to the market, not to your position',
    body: 'Our pricing engine never reads a trade, a position or an exposure to decide where a quote goes. What you are holding never moves the price of what you are holding.',
  },
  {
    title: 'Know the payout before you commit',
    body: 'Every trade shows its exact payout percentage before you confirm it, and that figure is locked in the moment your position opens — not adjusted after the fact.',
  },
  {
    title: 'Practice on the real thing',
    body: 'The practice account runs on the same engine, the same prices and the same terminal as live trading. What you learn there is what you will actually see.',
  },
];

/** Original copy about the product and how it approaches trading — no borrowed branding or screenshots. */
export function PublicAbout() {
  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 pb-20 pt-4">
        <h1 className="text-3xl font-bold tracking-tight">About Quantex</h1>
        <p className="mt-4 text-base leading-relaxed text-slate-400">
          Quantex is a fixed-payout trading platform: pick a direction, set a stake, and know your exact
          profit before you trade. We built it around one idea — a trader should be able to see the whole
          shape of a decision, the risk and the reward, before they make it.
        </p>
        <p className="mt-4 text-base leading-relaxed text-slate-400">
          The platform covers currencies, crypto, commodities, stocks and indices, including broker-priced OTC
          markets that trade around the clock. Every account starts with a free practice balance on the same
          engine as live trading, so there is a real way to learn the platform before any money is at risk.
        </p>

        <h2 className="mt-10 text-xl font-bold tracking-tight">What we build around</h2>
        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {VALUES.map((value) => (
            <div key={value.title} className="card p-5">
              <p className="text-sm font-semibold">{value.title}</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">{value.body}</p>
            </div>
          ))}
        </div>

        <div className="card mt-10 p-6">
          <p className="text-sm font-semibold">A serious risk warning, not a footnote</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            Fixed-payout trading is high-risk. You can lose your entire stake on a single trade, and past
            results never guarantee future ones. We put the risk warning where you'll actually read it — on
            every public page and in the terminal itself — because a platform that hides the downside is not
            one we would want to trade on either.
          </p>
        </div>

        <div className="mt-10 text-center">
          <Link to="/register" className="btn-primary !px-6 !py-3">
            Try the practice account
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
