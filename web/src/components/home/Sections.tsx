import { useState } from 'react';
import { Link } from 'react-router-dom';
import { renderMarkdown } from '../../lib/markdown';
import { money, price, percent } from '../../lib/format';
import { useSettings } from '../../store/settings';
import { Avatar } from '../Avatar';
import { RowSkeletons } from '../Skeleton';
import type { Asset, FaqEntry, Testimonial, Tournament } from '../../lib/types';

export interface SectionCopy {
  title: string | null;
  subtitle: string | null;
  body: string | null;
}

const EMPTY_COPY: SectionCopy = { title: null, subtitle: null, body: null };

/** Section copy comes from the CMS; this only fills a gap left by a section nobody has published yet. */
export function copyFor(
  sections: Record<string, SectionCopy> | null,
  key: string,
  fallbackTitle: string,
): SectionCopy {
  return sections?.[key] ?? { ...EMPTY_COPY, title: fallbackTitle };
}

function Prose({ body, className = '' }: { body: string | null; className?: string }) {
  if (!body) return null;
  return (
    <div
      className={`markdown-body text-sm text-slate-400 ${className}`}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
    />
  );
}

function SectionHead({ copy, center = true }: { copy: SectionCopy; center?: boolean }) {
  return (
    <div className={center ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{copy.title}</h2>
      {copy.subtitle && <p className="mt-3 text-base text-slate-400">{copy.subtitle}</p>}
    </div>
  );
}

/* ------------------------------ markets strip ------------------------------ */

export function MarketsStripSection({ copy, assets }: { copy: SectionCopy; assets: Asset[] | null }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <SectionHead copy={copy} />
      <Prose body={copy.body} className="mx-auto mt-2 max-w-2xl text-center" />
      <div className="card mt-8 overflow-hidden">
        <ul
          aria-label="Live markets"
          className="grid grid-cols-1 divide-y divide-ink-700 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4"
        >
          {assets === null &&
            Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="p-4">
                <RowSkeletons rows={1} avatar />
              </li>
            ))}
          {assets !== null && assets.length === 0 && (
            <li className="col-span-full p-6 text-center text-sm text-slate-500">
              Markets are loading — check back in a moment.
            </li>
          )}
          {assets?.map((asset) => (
            <li key={asset.symbol} className="flex items-center gap-3 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-600 text-[10px] font-bold text-slate-300">
                {asset.base}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{asset.pair}</span>
                <span
                  className={`tabular block text-[11px] ${asset.changePct >= 0 ? 'text-up' : 'text-down'}`}
                >
                  {price(asset.price, asset.precision)} · {percent(asset.changePct)}
                </span>
              </span>
              <span className="chip shrink-0 bg-up-soft text-up">{asset.payoutPct}%</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------ how it works ------------------------------ */

const STEPS = [
  { n: 1, title: 'Pick a market and a direction' },
  { n: 2, title: 'Set your stake and an expiry' },
  { n: 3, title: 'Watch it settle' },
];

export function HowItWorksSection({ copy }: { copy: SectionCopy }) {
  return (
    <section className="border-y border-ink-700 bg-ink-800/40">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <SectionHead copy={copy} />
        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.n} className="card p-5 text-center">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-lg font-bold text-accent">
                {step.n}
              </span>
              <p className="mt-3 text-sm font-semibold">{step.title}</p>
            </div>
          ))}
        </div>
        {copy.body && <Prose body={copy.body} className="mx-auto mt-6 max-w-2xl text-center" />}
      </div>
    </section>
  );
}

/* --------------------------- platform showcase --------------------------- */

export function PlatformShowcaseSection({ copy }: { copy: SectionCopy }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
        <div className="min-w-0">
          <SectionHead copy={copy} center={false} />
          {copy.body && <Prose body={copy.body} className="mt-4" />}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="card aspect-[4/3] min-w-0 p-4">
            <p className="text-xs font-semibold text-slate-400">Desktop terminal</p>
            <div className="mt-2 h-full rounded-lg border border-ink-600 bg-ink-900/60" />
          </div>
          <div className="card mx-auto aspect-[9/16] w-2/3 min-w-0 p-3 sm:w-full">
            <p className="text-xs font-semibold text-slate-400">Mobile terminal</p>
            <div className="mt-2 h-full rounded-lg border border-ink-600 bg-ink-900/60" />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ features grid ------------------------------ */

const FEATURES = [
  { title: 'Fast crypto deposits', body: 'Fund with BTC, ETH or USDT and start trading within minutes.' },
  { title: 'OTC markets, 24/7', body: 'Broker-priced OTC twins never close, weekends included.' },
  {
    title: '20+ chart indicators',
    body: 'SMA, RSI, MACD, Bollinger Bands and more, built into the terminal.',
  },
  {
    title: 'Live tournaments',
    body: 'Trade a fresh stack of chips against the field for a real prize pool.',
  },
  {
    title: 'Free practice account',
    body: '$10,000 in simulated funds on the exact same engine as live trading.',
  },
  {
    title: 'A mobile terminal that keeps up',
    body: 'Every tool from the desktop terminal, reflowed for a phone.',
  },
];

export function FeaturesGridSection({ copy }: { copy: SectionCopy }) {
  return (
    <section className="border-y border-ink-700 bg-ink-800/40">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <SectionHead copy={copy} />
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="card p-5">
              <p className="text-sm font-semibold">{feature.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{feature.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- status levels ------------------------------ */

export function StatusLevelsSection({ copy }: { copy: SectionCopy }) {
  const values = useSettings((s) => s.values);
  const enabled = values['growth.statusEnabled'] !== false;
  if (!enabled) return null;

  const levels = [
    { name: 'Standard', threshold: 0, payoutBonus: 0, depositBonus: 0 },
    {
      name: (values['growth.statusProName'] as string) ?? 'Pro',
      threshold: (values['growth.statusProThreshold'] as number) ?? 100_000,
      payoutBonus: (values['growth.statusProPayoutBonus'] as number) ?? 2,
      depositBonus: (values['growth.statusProDepositBonus'] as number) ?? 0,
    },
    {
      name: (values['growth.statusVipName'] as string) ?? 'VIP',
      threshold: (values['growth.statusVipThreshold'] as number) ?? 1_000_000,
      payoutBonus: (values['growth.statusVipPayoutBonus'] as number) ?? 4,
      depositBonus: (values['growth.statusVipDepositBonus'] as number) ?? 5,
    },
  ];

  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <SectionHead copy={copy} />
      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
        {levels.map((level, i) => (
          <div key={level.name} className={`card p-5 ${i === 2 ? 'border-accent' : ''}`}>
            <p className="text-sm font-semibold">{level.name}</p>
            <p className="mt-1 text-xs text-slate-500">
              {level.threshold === 0
                ? 'From your first trade'
                : `From ${money(level.threshold)} lifetime deposits`}
            </p>
            <ul className="mt-4 space-y-2 text-sm text-slate-400">
              <li>+{level.payoutBonus}% payout bonus</li>
              {level.depositBonus > 0 && <li>+{level.depositBonus}% deposit bonus</li>}
              {i > 0 && <li>Priority withdrawals</li>}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------- tournaments teaser ---------------------------- */

export function TournamentsTeaserSection({
  copy,
  tournaments,
}: {
  copy: SectionCopy;
  tournaments: Tournament[] | null;
}) {
  const upcoming =
    tournaments?.filter((t) => t.status === 'SCHEDULED' || t.status === 'RUNNING').slice(0, 3) ?? [];

  return (
    <section className="border-y border-ink-700 bg-ink-800/40">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <SectionHead copy={copy} />
        <div className="mt-10">
          {tournaments === null && <RowSkeletons rows={3} className="space-y-3" rowClassName="card p-4" />}
          {tournaments !== null && upcoming.length === 0 && (
            <p className="text-center text-sm text-slate-500">
              New tournaments are announced regularly — check back soon, or create an account to be notified.
            </p>
          )}
          {upcoming.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {upcoming.map((t) => (
                <div key={t.id} className="card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{t.name}</p>
                    <span className="chip bg-accent-soft text-accent">
                      {t.status === 'RUNNING' ? 'Live' : 'Soon'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Prize pool {money(t.prizePool)}</p>
                  <p className="text-xs text-slate-500">{t.entrants} entered</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="mt-8 text-center">
          <Link to="/register" className="btn-ghost !px-5 !py-2.5">
            Join a tournament
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ payment methods ------------------------------ */

export function PaymentMethodsSection({
  copy,
  methods,
}: {
  copy: SectionCopy;
  methods:
    { key: string; label: string; provider: string; currency: string; network: string | null }[] | null;
}) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <SectionHead copy={copy} />
      <Prose body={copy.body} className="mx-auto mt-2 max-w-2xl text-center" />
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {methods === null &&
          Array.from({ length: 4 }, (_, i) => <div key={i} aria-hidden className="skeleton h-11 w-32" />)}
        {methods !== null && methods.length === 0 && (
          <p className="text-sm text-slate-500">Payment methods are being configured.</p>
        )}
        {methods?.map((method) => (
          <span
            key={method.key}
            className="chip flex items-center gap-2 !rounded-xl border border-ink-600 bg-ink-800 !px-4 !py-2.5 text-sm"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink-600 text-[9px] font-bold">
              {method.currency.slice(0, 3)}
            </span>
            {method.label}
          </span>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------ security / risk ------------------------------ */

export function SecuritySection({ copy }: { copy: SectionCopy }) {
  return (
    <section className="border-y border-ink-700 bg-ink-800/40">
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{copy.title}</h2>
        <Prose body={copy.body} className="mt-4" />
      </div>
    </section>
  );
}

/* -------------------------------- testimonials -------------------------------- */

export function TestimonialsSection({
  copy,
  testimonials,
}: {
  copy: SectionCopy;
  testimonials: Testimonial[] | null;
}) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <SectionHead copy={copy} />
      <div className="mt-10">
        {testimonials === null && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="card p-5">
                <RowSkeletons rows={1} avatar />
              </div>
            ))}
          </div>
        )}
        {testimonials !== null && testimonials.length === 0 && (
          <p className="text-center text-sm text-slate-500">Trader stories are on their way.</p>
        )}
        {testimonials !== null && testimonials.length > 0 && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {testimonials.map((t) => (
              <figure key={t.id} className="card flex flex-col p-5">
                <div className="flex items-center gap-3">
                  <Avatar name={t.name} avatar={t.avatar} />
                  <div className="min-w-0">
                    <figcaption className="truncate text-sm font-semibold">{t.name}</figcaption>
                    <p className="truncate text-xs text-slate-500">{t.role}</p>
                  </div>
                </div>
                <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-slate-400">
                  “{t.quote}”
                </blockquote>
                <p
                  aria-label={`${t.rating} out of 5 stars`}
                  className="mt-3 text-amber-400"
                  aria-hidden="false"
                >
                  {'★'.repeat(t.rating)}
                  <span className="text-ink-500">{'★'.repeat(5 - t.rating)}</span>
                </p>
              </figure>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* -------------------------------- FAQ accordion -------------------------------- */

export function FaqAccordionSection({ copy, entries }: { copy: SectionCopy; entries: FaqEntry[] | null }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section id="faq" className="scroll-mt-4 border-y border-ink-700 bg-ink-800/40">
      <div className="mx-auto max-w-3xl px-4 py-16">
        <SectionHead copy={copy} />
        <div className="mt-8 divide-y divide-ink-700 rounded-xl border border-ink-700 bg-ink-800">
          {entries === null && <RowSkeletons rows={4} rowClassName="p-4" />}
          {entries !== null && entries.length === 0 && (
            <p className="p-6 text-center text-sm text-slate-500">
              Answers are being written up — try Help & Support.
            </p>
          )}
          {entries?.map((entry) => {
            const open = openId === entry.id;
            return (
              <div key={entry.id}>
                <button
                  onClick={() => setOpenId(open ? null : entry.id)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between gap-3 p-4 text-left text-sm font-semibold hover:bg-ink-700/40"
                >
                  {entry.question}
                  <span aria-hidden className="text-slate-500">
                    {open ? '−' : '+'}
                  </span>
                </button>
                {open && (
                  <div className="px-4 pb-4">
                    <Prose body={entry.answer} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          Can't find yours?{' '}
          <Link to="/register" className="text-accent hover:underline">
            Sign in to reach support
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

/* --------------------------------- final CTA --------------------------------- */

export function FinalCtaSection({ copy }: { copy: SectionCopy }) {
  return (
    <section className="mx-auto max-w-4xl px-4 py-20 text-center">
      <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{copy.title}</h2>
      {copy.subtitle && <p className="mt-3 text-base text-slate-400">{copy.subtitle}</p>}
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link to="/register" className="btn-primary !px-6 !py-3">
          Create free account
        </Link>
        <Link to="/login" className="btn-ghost !px-6 !py-3">
          I already have one
        </Link>
      </div>
    </section>
  );
}

/* ----------------------------------- footer ----------------------------------- */

const LEGAL_LINKS: { slug: string; label: string }[] = [
  { slug: 'terms', label: 'Terms of Service' },
  { slug: 'privacy', label: 'Privacy Policy' },
  { slug: 'risk-disclosure', label: 'Risk Disclosure' },
  { slug: 'aml-kyc', label: 'AML / KYC Policy' },
  { slug: 'cookie-policy', label: 'Cookie Policy' },
];

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Español',
  pt: 'Português',
  fr: 'Français',
  ar: 'العربية',
  ur: 'اردو',
  hi: 'हिन्दी',
};

export function SiteFooter({ copy }: { copy: SectionCopy }) {
  const values = useSettings((s) => s.values);
  const languages = (values['localisation.enabledLanguages'] as string[] | undefined) ?? ['en'];
  const [chosen, setChosen] = useState(languages[0] ?? 'en');

  return (
    <footer className="border-t border-ink-700">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-xs leading-relaxed text-slate-500">
          {copy.body ?? 'Trading fixed-payout options carries risk and you can lose the money you put in.'}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
          {LEGAL_LINKS.map((link) => (
            <Link key={link.slug} to={`/legal/${link.slug}`} className="hover:text-slate-200 hover:underline">
              {link.label}
            </Link>
          ))}
          <a href="#faq" className="hover:text-slate-200 hover:underline">
            Help centre
          </a>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} {copy.title ?? 'Quantex'}. All rights reserved.
          </p>
          {languages.length > 1 ? (
            <div className="text-right">
              <label className="flex items-center gap-2 text-xs text-slate-500">
                Language
                <select
                  aria-label="Interface language"
                  value={chosen}
                  onChange={(e) => setChosen(e.target.value)}
                  className="field !w-auto !py-1 text-xs"
                >
                  {languages.map((code) => (
                    <option key={code} value={code}>
                      {LANGUAGE_NAMES[code] ?? code}
                    </option>
                  ))}
                </select>
              </label>
              {chosen !== 'en' && (
                <p className="mt-1 text-[11px] text-slate-500">
                  Full {LANGUAGE_NAMES[chosen] ?? chosen} translation is on the way — the interface stays in
                  English until then.
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-500">{LANGUAGE_NAMES[languages[0]] ?? languages[0]}</p>
          )}
        </div>
      </div>
    </footer>
  );
}
