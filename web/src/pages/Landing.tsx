import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { percent, price } from '../lib/format';
import { IconLogo } from '../components/Icons';
import type { Asset } from '../lib/types';

const FEATURES = [
  {
    title: 'Fixed-payout trading',
    body: 'Pick a market, pick an expiry from 30 seconds to an hour, and know your exact profit before you commit.',
  },
  {
    title: 'Crypto in, crypto out',
    body: 'Fund with BTC, ETH or USDT on ERC-20 and TRC-20. Withdrawals are quoted with fees up front, no surprises.',
  },
  {
    title: 'Practice with $10,000',
    body: 'Every account ships with a demo balance on the same live prices and the same engine as the real thing.',
  },
];

export function Landing() {
  const [assets, setAssets] = useState<Asset[]>([]);

  useEffect(() => {
    api
      .get<{ assets: Asset[] }>('/market/assets')
      .then(({ assets: list }) => setAssets(list.slice(0, 6)))
      .catch(() => undefined);
  }, []);

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center px-4 py-5">
        <span className="flex items-center gap-2">
          <IconLogo className="h-8 w-8" />
          <span className="text-lg font-bold tracking-tight">Quantex</span>
        </span>
        <nav className="ml-auto flex items-center gap-2">
          <Link to="/login" className="btn-ghost !px-3 !py-2">
            Sign in
          </Link>
          <Link to="/register" className="btn-primary !px-3 !py-2">
            Start trading
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-14 pt-8 sm:pt-16">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <span className="chip bg-accent-soft text-accent">Crypto binary options</span>
            <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Trade the direction.
              <span className="block text-accent">Know the payout.</span>
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-400">
              Up or down on BTC, ETH, SOL and more. Fixed payouts up to 87%, expiries from 30 seconds, deposits and
              withdrawals settled in crypto.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/register" className="btn-primary !px-5 !py-3">
                Create free account
              </Link>
              <Link to="/login" className="btn-ghost !px-5 !py-3">
                I already have one
              </Link>
            </div>
            <p className="mt-4 text-xs text-slate-500">No deposit required to use the $10,000 practice account.</p>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-ink-600 px-4 py-3">
              <p className="text-sm font-semibold">Live markets</p>
              <p className="text-xs text-slate-500">Payouts update with market conditions</p>
            </div>
            <ul className="divide-y divide-ink-700">
              {assets.map((asset) => (
                <li key={asset.symbol} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-600 text-[10px] font-bold text-slate-300">
                    {asset.base}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{asset.name}</span>
                    <span className="block text-[11px] text-slate-500">{asset.symbol}</span>
                  </span>
                  <span className="text-right">
                    <span className="tabular block text-sm font-semibold">{price(asset.price, asset.precision)}</span>
                    <span className={`tabular block text-[11px] ${asset.changePct >= 0 ? 'text-up' : 'text-down'}`}>
                      {percent(asset.changePct)}
                    </span>
                  </span>
                  <span className="chip bg-up-soft text-up">{asset.payoutPct}%</span>
                </li>
              ))}
              {assets.length === 0 && <li className="px-4 py-10 text-center text-sm text-slate-500">Loading markets…</li>}
            </ul>
          </div>
        </div>
      </section>

      <section className="border-y border-ink-700 bg-ink-800/40">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-12 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title}>
              <h2 className="text-base font-semibold">{feature.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 py-10 text-xs leading-relaxed text-slate-500">
        <p className="font-semibold text-slate-400">Risk warning</p>
        <p className="mt-2 max-w-3xl">
          Binary options are high-risk instruments. You can lose your entire investment on a single trade. This platform
          is a reference implementation built for education and development — run it against your own infrastructure and
          comply with the regulations that apply to you before accepting real customer funds.
        </p>
        <p className="mt-6">© {new Date().getFullYear()} Quantex. All rights reserved.</p>
      </footer>
    </div>
  );
}
