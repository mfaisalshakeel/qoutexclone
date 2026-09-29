import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { renderMarkdown } from '../../lib/markdown';
import { money, price, percent } from '../../lib/format';
import { useSettings } from '../../store/settings';
import { changeLanguage, TRANSLATED_LANGUAGES } from '../../i18n';
import { Avatar } from '../Avatar';
import { RowSkeletons } from '../Skeleton';
import type { Asset, FaqEntry, Testimonial, Tournament } from '../../lib/types';

export interface SectionCopy {
  title: string | null;
  subtitle: string | null;
  body: string | null;
  /** True until the CMS fetch resolves. A skeleton line holds the subtitle/body's
   *  rough shape while `true`, so a section published with either never shifts the
   *  layout of everything below it the moment its copy arrives — the same "no CLS
   *  from late-loading content" rule the rest of the page's own skeletons follow. */
  loading: boolean;
}

const EMPTY_COPY: Omit<SectionCopy, 'loading'> = { title: null, subtitle: null, body: null };

/** Section copy comes from the CMS; this only fills a gap left by a section nobody has published yet. */
export function copyFor(
  sections: Record<string, Omit<SectionCopy, 'loading'>> | null,
  key: string,
  fallbackTitle: string,
): SectionCopy {
  if (sections === null) return { ...EMPTY_COPY, title: fallbackTitle, loading: true };
  return { ...(sections[key] ?? { ...EMPTY_COPY, title: fallbackTitle }), loading: false };
}

function Prose({
  body,
  loading = false,
  className = '',
}: {
  body: string | null;
  loading?: boolean;
  className?: string;
}) {
  if (loading) return <div aria-hidden className={`skeleton h-16 ${className}`} />;
  if (!body) return null;
  return (
    <div
      className={`markdown-body text-sm text-slate-400 ${className}`}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
    />
  );
}

export function SectionSubtitle({ copy, center = true }: { copy: SectionCopy; center?: boolean }) {
  if (copy.loading) {
    return <div aria-hidden className={`skeleton mt-3 h-5 w-2/3 ${center ? 'mx-auto' : ''}`} />;
  }
  if (!copy.subtitle) return null;
  return <p className="mt-3 text-base text-slate-400">{copy.subtitle}</p>;
}

function SectionHead({ copy, center = true }: { copy: SectionCopy; center?: boolean }) {
  return (
    <div className={center ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{copy.title}</h2>
      <SectionSubtitle copy={copy} center={center} />
    </div>
  );
}

/* ------------------------------ markets strip ------------------------------ */

export function MarketsStripSection({ copy, assets }: { copy: SectionCopy; assets: Asset[] | null }) {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <SectionHead copy={copy} />
      <Prose body={copy.body} loading={copy.loading} className="mx-auto mt-2 max-w-2xl text-center" />
      <div className="card mt-8 overflow-hidden">
        <ul
          aria-label={t('home.marketsStrip.ariaLabel')}
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
              {t('home.marketsStrip.loading')}
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

const STEP_KEYS = ['step1', 'step2', 'step3'] as const;

export function HowItWorksSection({ copy }: { copy: SectionCopy }) {
  const { t } = useTranslation();
  return (
    <section className="border-y border-ink-700 bg-ink-800/40">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <SectionHead copy={copy} />
        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {STEP_KEYS.map((key, i) => (
            <div key={key} className="card p-5 text-center">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-lg font-bold text-accent">
                {i + 1}
              </span>
              <p className="mt-3 text-sm font-semibold">{t(`home.howItWorks.${key}`)}</p>
            </div>
          ))}
        </div>
        <Prose body={copy.body} loading={copy.loading} className="mx-auto mt-6 max-w-2xl text-center" />
      </div>
    </section>
  );
}

/* --------------------------- platform showcase --------------------------- */

export function PlatformShowcaseSection({ copy }: { copy: SectionCopy }) {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
        <div className="min-w-0">
          <SectionHead copy={copy} center={false} />
          <Prose body={copy.body} loading={copy.loading} className="mt-4" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="card aspect-[4/3] min-w-0 p-4">
            <p className="text-xs font-semibold text-slate-400">
              {t('home.platformShowcase.desktopTerminal')}
            </p>
            <div className="mt-2 h-full rounded-lg border border-ink-600 bg-ink-900/60" />
          </div>
          <div className="card mx-auto aspect-[9/16] w-2/3 min-w-0 p-3 sm:w-full">
            <p className="text-xs font-semibold text-slate-400">
              {t('home.platformShowcase.mobileTerminal')}
            </p>
            <div className="mt-2 h-full rounded-lg border border-ink-600 bg-ink-900/60" />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ features grid ------------------------------ */

const FEATURE_KEYS = [1, 2, 3, 4, 5, 6] as const;

export function FeaturesGridSection({ copy }: { copy: SectionCopy }) {
  const { t } = useTranslation();
  return (
    <section className="border-y border-ink-700 bg-ink-800/40">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <SectionHead copy={copy} />
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURE_KEYS.map((n) => (
            <div key={n} className="card p-5">
              <p className="text-sm font-semibold">{t(`home.featuresGrid.feature${n}Title`)}</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                {t(`home.featuresGrid.feature${n}Body`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- status levels ------------------------------ */

export function StatusLevelsSection({ copy }: { copy: SectionCopy }) {
  const { t } = useTranslation();
  const values = useSettings((s) => s.values);
  const enabled = values['growth.statusEnabled'] !== false;
  if (!enabled) return null;

  const levels = [
    { name: t('home.statusLevels.standard'), threshold: 0, payoutBonus: 0, depositBonus: 0 },
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
                ? t('home.statusLevels.fromFirstTrade')
                : t('home.statusLevels.fromLifetimeDeposits', { amount: money(level.threshold) })}
            </p>
            <ul className="mt-4 space-y-2 text-sm text-slate-400">
              <li>{t('home.statusLevels.payoutBonus', { pct: level.payoutBonus })}</li>
              {level.depositBonus > 0 && (
                <li>{t('home.statusLevels.depositBonus', { pct: level.depositBonus })}</li>
              )}
              {i > 0 && <li>{t('home.statusLevels.priorityWithdrawals')}</li>}
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
  const { t } = useTranslation();
  const upcoming =
    tournaments?.filter((tt) => tt.status === 'SCHEDULED' || tt.status === 'RUNNING').slice(0, 3) ?? [];

  return (
    <section className="border-y border-ink-700 bg-ink-800/40">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <SectionHead copy={copy} />
        <div className="mt-10">
          {tournaments === null && <RowSkeletons rows={3} className="space-y-3" rowClassName="card p-4" />}
          {tournaments !== null && upcoming.length === 0 && (
            <p className="text-center text-sm text-slate-500">{t('home.tournamentsTeaser.empty')}</p>
          )}
          {upcoming.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {upcoming.map((tournament) => (
                <div key={tournament.id} className="card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{tournament.name}</p>
                    <span className="chip bg-accent-soft text-accent">
                      {tournament.status === 'RUNNING'
                        ? t('home.tournamentsTeaser.live')
                        : t('home.tournamentsTeaser.soon')}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {t('home.tournamentsTeaser.prizePool', { amount: money(tournament.prizePool) })}
                  </p>
                  <p className="text-xs text-slate-500">
                    {t('home.tournamentsTeaser.entered', { count: tournament.entrants })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="mt-8 text-center">
          <Link to="/register" className="btn-ghost !px-5 !py-2.5">
            {t('home.tournamentsTeaser.joinTournament')}
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
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <SectionHead copy={copy} />
      <Prose body={copy.body} loading={copy.loading} className="mx-auto mt-2 max-w-2xl text-center" />
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {methods === null &&
          Array.from({ length: 4 }, (_, i) => <div key={i} aria-hidden className="skeleton h-11 w-32" />)}
        {methods !== null && methods.length === 0 && (
          <p className="text-sm text-slate-500">{t('home.paymentMethods.loading')}</p>
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
        <Prose body={copy.body} loading={copy.loading} className="mt-4" />
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
  const { t } = useTranslation();
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
          <p className="text-center text-sm text-slate-500">{t('home.testimonials.empty')}</p>
        )}
        {testimonials !== null && testimonials.length > 0 && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {testimonials.map((testimonial) => (
              <figure key={testimonial.id} className="card flex flex-col p-5">
                <div className="flex items-center gap-3">
                  <Avatar name={testimonial.name} avatar={testimonial.avatar} />
                  <div className="min-w-0">
                    <figcaption className="truncate text-sm font-semibold">{testimonial.name}</figcaption>
                    <p className="truncate text-xs text-slate-500">{testimonial.role}</p>
                  </div>
                </div>
                <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-slate-400">
                  “{testimonial.quote}”
                </blockquote>
                <p
                  aria-label={`${testimonial.rating} out of 5 stars`}
                  className="mt-3 text-amber-400"
                  aria-hidden="false"
                >
                  {'★'.repeat(testimonial.rating)}
                  <span className="text-ink-500">{'★'.repeat(5 - testimonial.rating)}</span>
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
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section id="faq" className="scroll-mt-4 border-y border-ink-700 bg-ink-800/40">
      <div className="mx-auto max-w-3xl px-4 py-16">
        <SectionHead copy={copy} />
        <div className="mt-8 divide-y divide-ink-700 rounded-xl border border-ink-700 bg-ink-800">
          {entries === null && <RowSkeletons rows={4} rowClassName="p-4" />}
          {entries !== null && entries.length === 0 && (
            <p className="p-6 text-center text-sm text-slate-500">{t('home.faq.empty')}</p>
          )}
          {entries?.map((entry) => {
            const open = openId === entry.id;
            return (
              <div key={entry.id}>
                <button
                  onClick={() => setOpenId(open ? null : entry.id)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between gap-3 p-4 text-start text-sm font-semibold hover:bg-ink-700/40"
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
          {t('home.faq.cantFindYours')}{' '}
          <Link to="/help" className="text-accent hover:underline">
            {t('home.faq.searchHelpCentre')}
          </Link>{' '}
          {t('home.faq.or')}{' '}
          <Link to="/contact" className="text-accent hover:underline">
            {t('home.faq.contactUs')}
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

/* --------------------------------- final CTA --------------------------------- */

export function FinalCtaSection({ copy }: { copy: SectionCopy }) {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-4xl px-4 py-20 text-center">
      <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{copy.title}</h2>
      <SectionSubtitle copy={copy} />
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link to="/register" className="btn-primary !px-6 !py-3">
          {t('common.createFreeAccount')}
        </Link>
        <Link to="/login" className="btn-ghost !px-6 !py-3">
          {t('common.iAlreadyHaveOne')}
        </Link>
      </div>
    </section>
  );
}

/* ----------------------------------- footer ----------------------------------- */

const SITE_LINKS = [
  { to: '/markets', key: 'markets' },
  { to: '/tournaments/overview', key: 'tournaments' },
  { to: '/status', key: 'statusLevels' },
  { to: '/affiliate', key: 'affiliate' },
  { to: '/help', key: 'helpCentre' },
  { to: '/about', key: 'about' },
  { to: '/contact', key: 'contact' },
] as const;

const LEGAL_LINKS = [
  { slug: 'terms', key: 'terms' },
  { slug: 'privacy', key: 'privacy' },
  { slug: 'risk-disclosure', key: 'risk-disclosure' },
  { slug: 'aml-kyc', key: 'aml-kyc' },
  { slug: 'cookie-policy', key: 'cookie-policy' },
] as const;

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Español',
  pt: 'Português',
  fr: 'Français',
  ar: 'العربية',
  ur: 'اردو',
  hi: 'हिन्दी',
};

export function SiteFooter({ copy = { ...EMPTY_COPY, loading: false } }: { copy?: SectionCopy }) {
  const { t, i18n } = useTranslation();
  const values = useSettings((s) => s.values);
  const languages = (values['localisation.enabledLanguages'] as string[] | undefined) ?? ['en'];
  const [chosen, setChosen] = useState(
    languages.includes(i18n.language) ? i18n.language : (languages[0] ?? 'en'),
  );

  function selectLanguage(code: string) {
    setChosen(code);
    if (TRANSLATED_LANGUAGES.has(code)) changeLanguage(code);
  }

  return (
    <footer className="border-t border-ink-700">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-xs leading-relaxed text-slate-400">
          {copy.body ?? t('footer.riskWarningDefault')}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
          {SITE_LINKS.map((link) => (
            <Link key={link.to} to={link.to} className="hover:text-slate-200 hover:underline">
              {t(`nav.${link.key}`)}
            </Link>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
          {LEGAL_LINKS.map((link) => (
            <Link key={link.slug} to={`/legal/${link.slug}`} className="hover:text-slate-200 hover:underline">
              {t(`legalLinks.${link.key}`)}
            </Link>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} {copy.title ?? 'Quantex'}. {t('footer.allRightsReserved')}
          </p>
          {languages.length > 1 ? (
            <div className="text-end">
              <label className="flex items-center gap-2 text-xs text-slate-500">
                {t('footer.language')}
                <select
                  aria-label={t('footer.languageAriaLabel')}
                  value={chosen}
                  onChange={(e) => selectLanguage(e.target.value)}
                  className="field !w-auto !py-1 text-xs"
                >
                  {languages.map((code) => (
                    <option key={code} value={code}>
                      {LANGUAGE_NAMES[code] ?? code}
                    </option>
                  ))}
                </select>
              </label>
              {!TRANSLATED_LANGUAGES.has(chosen) && (
                <p className="mt-1 text-[11px] text-slate-500">
                  {t('footer.translationOnTheWay', { language: LANGUAGE_NAMES[chosen] ?? chosen })}
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
