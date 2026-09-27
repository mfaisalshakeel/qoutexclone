import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { usePageMeta } from '../hooks/usePageMeta';
import { useSettings } from '../store/settings';
import { organizationJsonLd, websiteJsonLd } from '../lib/structuredData';
import { HomeChart } from '../components/home/HomeChart';
import { PublicHeader } from '../components/home/PublicHeader';
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
  const { t } = useTranslation();
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

  const hero = copyFor(sections, 'hero', t('home.hero.title'));

  const settingsValues = useSettings((s) => s.values);
  const siteName = (settingsValues['general.siteName'] as string | undefined) ?? 'Quantex';
  const baseUrl = ((settingsValues['seo.canonicalBaseUrl'] as string | undefined) ?? '').replace(/\/$/, '');
  const metaDescription = settingsValues['seo.metaDescription'] as string | undefined;
  usePageMeta({
    title: t('home.hero.title'),
    description: metaDescription,
    jsonLd: [
      organizationJsonLd({ siteName, baseUrl, description: metaDescription ?? '' }),
      websiteJsonLd({ siteName, baseUrl }),
    ],
  });

  return (
    <div className="min-h-dvh">
      <PublicHeader />

      <main>
        <HeroSection copy={hero} />

        <MarketsStripSection
          copy={copyFor(sections, 'markets_strip', t('home.marketsStrip.fallbackTitle'))}
          assets={assets}
        />
        <HowItWorksSection copy={copyFor(sections, 'how_it_works', t('home.howItWorks.fallbackTitle'))} />
        <PlatformShowcaseSection
          copy={copyFor(sections, 'platform_showcase', t('home.platformShowcase.fallbackTitle'))}
        />
        <FeaturesGridSection
          copy={copyFor(sections, 'features_grid', t('home.featuresGrid.fallbackTitle'))}
        />
        <StatusLevelsSection
          copy={copyFor(sections, 'status_levels', t('home.statusLevels.fallbackTitle'))}
        />
        <TournamentsTeaserSection
          copy={copyFor(sections, 'tournaments_teaser', t('home.tournamentsTeaser.fallbackTitle'))}
          tournaments={tournaments}
        />
        <PaymentMethodsSection
          copy={copyFor(sections, 'payment_methods', t('home.paymentMethods.fallbackTitle'))}
          methods={methods}
        />
        <SecuritySection copy={copyFor(sections, 'security', t('home.security.fallbackTitle'))} />
        <TestimonialsSection
          copy={copyFor(sections, 'testimonials', t('home.testimonials.fallbackTitle'))}
          testimonials={testimonials}
        />
        <FaqAccordionSection
          copy={copyFor(sections, 'faq_accordion', t('home.faq.fallbackTitle'))}
          entries={faq}
        />
        <FinalCtaSection copy={copyFor(sections, 'final_cta', t('home.finalCta.fallbackTitle'))} />
      </main>
      <SiteFooter copy={copyFor(sections, 'footer', 'Quantex')} />
    </div>
  );
}

function HeroSection({ copy }: { copy: SectionCopy }) {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-6xl px-4 pb-14 pt-8 sm:pt-16">
      <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
        <div className="min-w-0">
          <span className="chip bg-accent-soft text-accent">{t('home.hero.badge')}</span>
          <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{copy.title}</h1>
          {copy.loading ? (
            <div aria-hidden className="skeleton mt-4 h-6 w-full max-w-lg" />
          ) : (
            copy.subtitle && (
              <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-400">{copy.subtitle}</p>
            )
          )}
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/register" className="btn-primary !px-5 !py-3">
              {t('common.createFreeAccount')}
            </Link>
            <Link to="/login" className="btn-ghost !px-5 !py-3">
              {t('common.iAlreadyHaveOne')}
            </Link>
          </div>
          <p className="mt-4 text-xs text-slate-500">{t('home.hero.noDeposit')}</p>
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-ink-600 px-4 py-3">
            <p className="text-sm font-semibold">{t('home.hero.liveLabel')}</p>
            <p className="text-xs text-slate-500">{t('home.hero.liveCaption')}</p>
          </div>
          <div className="p-4">
            <HomeChart className="h-[160px] w-full" />
          </div>
          {copy.loading ? (
            <div className="border-t border-ink-700 px-4 py-3">
              <div aria-hidden className="skeleton h-4 w-3/4" />
            </div>
          ) : (
            copy.body && (
              <p className="border-t border-ink-700 px-4 py-3 text-xs leading-relaxed text-slate-500">
                {copy.body}
              </p>
            )
          )}
        </div>
      </div>
    </section>
  );
}
