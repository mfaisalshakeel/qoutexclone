import crypto from 'node:crypto';
import './lib/load-env.js';
import bcrypt from 'bcryptjs';
import { prisma } from './lib/prisma.js';
import { MARKETS, MARKET_COUNTS } from './data/markets.js';
import { SCHEDULES, scheduleKeyFor } from './data/schedules.js';
import { DEFAULT_MARKETPLACE_ITEMS } from './data/marketplace.js';
import { DEFAULT_BONUS_OFFERS } from './data/bonus-offers.js';
import { DEFAULT_PAYMENT_METHODS } from './data/payment-methods.js';

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
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: 'ADMIN' },
    create: {
      email: adminEmail,
      name: 'Platform Admin',
      passwordHash: await bcrypt.hash(adminPassword, 10),
      role: 'ADMIN',
      referralCode: crypto.randomBytes(4).toString('hex').toUpperCase(),
      realBalance: 0,
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

  const byClass = Object.entries(MARKET_COUNTS.byClass)
    .map(([assetClass, count]) => `${assetClass.toLowerCase()} ${count}`)
    .join(', ');
  console.log(`Seeded ${MARKET_COUNTS.total} markets (${byClass}; ${MARKET_COUNTS.otc} OTC).`);
  console.log(`Seeded ${SCHEDULES.length} trading schedules.`);
  console.log(`Seeded ${DEFAULT_MARKETPLACE_ITEMS.length} marketplace items.`);
  console.log(`Seeded ${DEFAULT_BONUS_OFFERS.length} bonus offers.`);
  console.log(`Seeded ${DEFAULT_PAYMENT_METHODS.length} payment methods.`);
  console.log(`Admin:  ${adminEmail} / ${adminPassword}`);
  console.log(`Trader: ${demoEmail} / Trader123!`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
