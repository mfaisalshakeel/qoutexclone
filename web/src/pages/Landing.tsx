import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { IconLogo } from '../components/Icons';
import { HomeChart } from '../components/home/HomeChart';
import {
  FaqAccordionSection,
  FeaturesGridSection,
  FinalCtaSection,
  HowItWorksSection,
  MarketsStripSection,
  PaymentMethodsSection,
  PlatformShowcaseSection,
  SecuritySection,
  SiteFooter,
  StatusLevelsSection,
  TestimonialsSection,
  TournamentsTeaserSection,
  copyFor,
  type SectionCopy,
} from '../components/home/Sections';
import type { Asset, FaqEntry, PublicHomepageSections, Testimonial, Tournament } from '../lib/types';

type PaymentMethodSummary = {
  key: string;
  label: string;
  provider: string;
  currency: string;
  network: string | null;
};

/**
 * The marketing homepage. Every section pulls real data — live markets, real
 * tournaments, the CMS's own published copy — rather than a mock of what
 * those will eventually say; a section whose data has not loaded yet shows a
 * skeleton, never a placeholder dressed up as the real thing.
 */
export function Landing() {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [sections, setSections] = useState<PublicHomepageSections | null>(null);
  const [faq, setFaq] = useState<FaqEntry[] | null>(null);
  const [testimonials, setTestimonials] = useState<Testimonial[] | null>(null);
  const [methods, setMethods] = useState<PaymentMethodSummary[] | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);

  useEffect(() => {
    api
      .get<{ assets: Asset[] }>('/market/assets')
      .then(({ assets: list }) => setAssets(list.slice(0, 8)))
      .catch(() => setAssets([]));
    api
      .get<{ sections: PublicHomepageSections }>('/content/homepage')
      .then(({ sections: data }) => setSections(data))
      .catch(() => setSections({}));
    api
      .get<{ entries: FaqEntry[] }>('/content/faq')
      .then(({ entries }) => setFaq(entries))
      .catch(() => setFaq([]));
    api
      .get<{ testimonials: Testimonial[] }>('/content/testimonials')
      .then(({ testimonials: list }) => setTestimonials(list))
      .catch(() => setTestimonials([]));
    api
      .get<{ methods: PaymentMethodSummary[] }>('/content/payment-methods')
      .then(({ methods: list }) => setMethods(list))
      .catch(() => setMethods([]));
    api
      .get<{ tournaments: Tournament[] }>('/tournaments')
      .then(({ tournaments: list }) => setTournaments(list))
      .catch(() => setTournaments([]));
  }, []);

  const hero = copyFor(sections, 'hero', 'Trade the next tick, not the next quarter');

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

      <HeroSection copy={hero} />

      <MarketsStripSection
        copy={copyFor(sections, 'markets_strip', 'Live markets, live payouts')}
        assets={assets}
      />
      <HowItWorksSection copy={copyFor(sections, 'how_it_works', 'Three steps, start to finish')} />
      <PlatformShowcaseSection copy={copyFor(sections, 'platform_showcase', 'One terminal, every screen')} />
      <FeaturesGridSection
        copy={copyFor(sections, 'features_grid', 'Built for traders who watch the clock')}
      />
      <StatusLevelsSection
        copy={copyFor(sections, 'status_levels', 'The more you trade, the more you keep')}
      />
      <TournamentsTeaserSection
        copy={copyFor(sections, 'tournaments_teaser', 'Trade the leaderboard, not just the market')}
        tournaments={tournaments}
      />
      <PaymentMethodsSection
        copy={copyFor(sections, 'payment_methods', 'Deposit your way')}
        methods={methods}
      />
      <SecuritySection copy={copyFor(sections, 'security', 'Trade with your eyes open')} />
      <TestimonialsSection
        copy={copyFor(sections, 'testimonials', 'What traders say')}
        testimonials={testimonials}
      />
      <FaqAccordionSection copy={copyFor(sections, 'faq_accordion', 'Questions, answered')} entries={faq} />
      <FinalCtaSection copy={copyFor(sections, 'final_cta', 'Your first trade is on the house')} />
      <SiteFooter copy={copyFor(sections, 'footer', 'Quantex')} />
    </div>
  );
}

function HeroSection({ copy }: { copy: SectionCopy }) {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-14 pt-8 sm:pt-16">
      <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
        <div className="min-w-0">
          <span className="chip bg-accent-soft text-accent">Fixed-payout trading</span>
          <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{copy.title}</h1>
          {copy.subtitle && (
            <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-400">{copy.subtitle}</p>
          )}
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/register" className="btn-primary !px-5 !py-3">
              Create free account
            </Link>
            <Link to="/login" className="btn-ghost !px-5 !py-3">
              I already have one
            </Link>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            No deposit required to use the $10,000 practice account.
          </p>
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-ink-600 px-4 py-3">
            <p className="text-sm font-semibold">BTC/USDT · live</p>
            <p className="text-xs text-slate-500">Real ticks from the platform's own feed</p>
          </div>
          <div className="p-4">
            <HomeChart className="h-[160px] w-full" />
          </div>
          {copy.body && (
            <p className="border-t border-ink-700 px-4 py-3 text-xs leading-relaxed text-slate-500">
              {copy.body}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
