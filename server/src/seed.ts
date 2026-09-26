import crypto from 'node:crypto';
import './lib/load-env.js';
import bcrypt from 'bcryptjs';
import { prisma } from './lib/prisma.js';
import { MARKETS, MARKET_COUNTS } from './data/markets.js';
import { SCHEDULES, scheduleKeyFor } from './data/schedules.js';
import { DEFAULT_MARKETPLACE_ITEMS } from './data/marketplace.js';
import { DEFAULT_BONUS_OFFERS } from './data/bonus-offers.js';
import { DEFAULT_PAYMENT_METHODS } from './data/payment-methods.js';
import { DEFAULT_LEGAL_PAGES } from './data/legal-pages.js';
import { DEFAULT_FAQ } from './data/faq.js';
import { DEFAULT_HOMEPAGE_SECTIONS } from './data/homepage-sections.js';
import { LEGAL_PAGES, HOMEPAGE_SECTIONS } from './services/content.js';

async function main() {
  // schedules first: markets reference them
  const scheduleIds = new Map<string, string>();
  for (const seed of SCHEDULES) {
    const schedule = await prisma.tradingSchedule.upsert({
      where: { key: seed.key },
      update: { name: seed.name, note: seed.note },
      create: { key: seed.key, name: seed.name, note: seed.note },
    });
    scheduleIds.set(seed.key, schedule.id);

    // windows are replaced wholesale: they describe one calendar, not a history
    await prisma.scheduleWindow.deleteMany({ where: { scheduleId: schedule.id } });
    await prisma.scheduleWindow.createMany({
      data: seed.windows.map((window) => ({ ...window, scheduleId: schedule.id })),
    });

    for (const holiday of seed.holidays) {
      await prisma.marketHoliday.upsert({
        where: { scheduleId_date: { scheduleId: schedule.id, date: holiday.date } },
        update: { name: holiday.name },
        create: { scheduleId: schedule.id, date: holiday.date, name: holiday.name },
      });
    }
  }

  for (const [index, market] of MARKETS.entries()) {
    const shared = {
      name: market.name,
      pair: market.pair,
      assetClass: market.assetClass,
      base: market.base,
      quote: market.quote,
      feedSymbol: market.feedSymbol,
      isOtc: market.isOtc,
      payoutPct: market.payoutPct,
      precision: market.precision,
      pipSize: market.pipSize,
      basePrice: market.basePrice,
      volatility: market.volatility,
      icon: market.icon,
      sortOrder: index,
      scheduleId: scheduleIds.get(scheduleKeyFor(market) ?? '') ?? null,
    };

    // upsert keeps operator edits to stake limits and enabled flags intact
    await prisma.asset.upsert({
      where: { symbol: market.symbol },
      update: shared,
      create: {
        symbol: market.symbol,
        minStake: market.minStake ?? 100,
        maxStake: market.maxStake ?? 500000,
        ...shared,
      },
    });
  }

  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@quotexclone.dev';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'Admin123!';
  // admin access requires a second factor (RBAC's "admin users are managed
  // with 2FA required"), so the seeded account is enrolled with a fixed
  // secret rather than left unable to sign in to its own back office. e2e
  // logs in with the matching code — see ADMIN.twoFactorSecret in e2e/helpers.ts.
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      role: 'ADMIN',
      adminRole: 'SUPER_ADMIN',
      twoFactorSecret: 'JBSWY3DPEHPK3PXP',
      twoFactorEnabledAt: new Date(),
    },
    create: {
      email: adminEmail,
      name: 'Platform Admin',
      passwordHash: await bcrypt.hash(adminPassword, 10),
      role: 'ADMIN',
      adminRole: 'SUPER_ADMIN',
      referralCode: crypto.randomBytes(4).toString('hex').toUpperCase(),
      realBalance: 0,
      twoFactorSecret: 'JBSWY3DPEHPK3PXP',
      twoFactorEnabledAt: new Date(),
    },
  });

  const demoEmail = 'trader@quotexclone.dev';
  await prisma.user.upsert({
    where: { email: demoEmail },
    update: {},
    create: {
      email: demoEmail,
      name: 'Demo Trader',
      passwordHash: await bcrypt.hash('Trader123!', 10),
      referralCode: crypto.randomBytes(4).toString('hex').toUpperCase(),
      realBalance: 25000, // $250 starting real balance for the walkthrough
      totalDeposited: 25000,
    },
  });

  // the marketplace opens with a catalogue rather than an empty shelf; an
  // operator edits or disables these, and `upsert` keeps their edits
  for (const item of DEFAULT_MARKETPLACE_ITEMS) {
    await prisma.marketplaceItem.upsert({
      where: { key: item.key },
      update: {},
      create: item,
    });
  }

  for (const method of DEFAULT_PAYMENT_METHODS) {
    await prisma.paymentMethod.upsert({ where: { key: method.key }, update: {}, create: method });
  }

  for (const offer of DEFAULT_BONUS_OFFERS) {
    await prisma.bonusOffer.upsert({ where: { key: offer.key }, update: {}, create: offer });
  }

  // content CMS: seeded already published, since this is the platform's own
  // shipped copy rather than a draft in progress — an operator edits and
  // republishes from the back office when they have their own copy ready
  const now = new Date();
  for (const { slug, title } of LEGAL_PAGES) {
    const body = DEFAULT_LEGAL_PAGES[slug];
    await prisma.legalPage.upsert({
      where: { slug },
      update: {},
      create: { slug, title, draftBody: body, publishedBody: body, publishedAt: now },
    });
  }

  for (const { key } of HOMEPAGE_SECTIONS) {
    const section = DEFAULT_HOMEPAGE_SECTIONS[key];
    await prisma.homepageSection.upsert({
      where: { key },
      update: {},
      create: {
        key,
        draftTitle: section.title,
        draftSubtitle: section.subtitle ?? null,
        draftBody: section.body ?? null,
        publishedTitle: section.title,
        publishedSubtitle: section.subtitle ?? null,
        publishedBody: section.body ?? null,
        publishedAt: now,
      },
    });
  }

  for (const entry of DEFAULT_FAQ) {
    const existing = await prisma.faqEntry.findFirst({
      where: { category: entry.category, question: entry.question },
    });
    if (!existing) {
      await prisma.faqEntry.create({ data: { ...entry, published: true } });
    }
  }

  const byClass = Object.entries(MARKET_COUNTS.byClass)
    .map(([assetClass, count]) => `${assetClass.toLowerCase()} ${count}`)
    .join(', ');
  console.log(`Seeded ${MARKET_COUNTS.total} markets (${byClass}; ${MARKET_COUNTS.otc} OTC).`);
  console.log(`Seeded ${SCHEDULES.length} trading schedules.`);
  console.log(`Seeded ${DEFAULT_MARKETPLACE_ITEMS.length} marketplace items.`);
  console.log(`Seeded ${DEFAULT_BONUS_OFFERS.length} bonus offers.`);
  console.log(`Seeded ${DEFAULT_PAYMENT_METHODS.length} payment methods.`);
  console.log(`Seeded ${LEGAL_PAGES.length} legal pages, ${HOMEPAGE_SECTIONS.length} homepage sections, ${DEFAULT_FAQ.length} FAQ entries.`);
  console.log(`Admin:  ${adminEmail} / ${adminPassword}`);
  console.log(`Trader: ${demoEmail} / Trader123!`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
