import crypto from 'node:crypto';
import './lib/load-env.js';
import bcrypt from 'bcryptjs';
import { prisma } from './lib/prisma.js';
import { MARKETS, MARKET_COUNTS } from './data/markets.js';

async function main() {
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

  const byClass = Object.entries(MARKET_COUNTS.byClass)
    .map(([assetClass, count]) => `${assetClass.toLowerCase()} ${count}`)
    .join(', ');
  console.log(`Seeded ${MARKET_COUNTS.total} markets (${byClass}; ${MARKET_COUNTS.otc} OTC).`);
  console.log(`Admin:  ${adminEmail} / ${adminPassword}`);
  console.log(`Trader: ${demoEmail} / Trader123!`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
