import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from './lib/prisma.js';

// volatility is expressed as a per-minute standard deviation of returns
const ASSETS = [
  { symbol: 'BTCUSD', name: 'Bitcoin', base: 'BTC', feedSymbol: 'BTCUSDT', basePrice: 64250, volatility: 0.0012, precision: 2, payoutPct: 87 },
  { symbol: 'ETHUSD', name: 'Ethereum', base: 'ETH', feedSymbol: 'ETHUSDT', basePrice: 3145.5, volatility: 0.0016, precision: 2, payoutPct: 86 },
  { symbol: 'SOLUSD', name: 'Solana', base: 'SOL', feedSymbol: 'SOLUSDT', basePrice: 148.2, volatility: 0.0025, precision: 3, payoutPct: 84 },
  { symbol: 'BNBUSD', name: 'BNB', base: 'BNB', feedSymbol: 'BNBUSDT', basePrice: 592.4, volatility: 0.0015, precision: 2, payoutPct: 82 },
  { symbol: 'XRPUSD', name: 'XRP', base: 'XRP', feedSymbol: 'XRPUSDT', basePrice: 0.5271, volatility: 0.0022, precision: 5, payoutPct: 81 },
  { symbol: 'DOGEUSD', name: 'Dogecoin', base: 'DOGE', feedSymbol: 'DOGEUSDT', basePrice: 0.1284, volatility: 0.003, precision: 6, payoutPct: 80 },
  { symbol: 'ADAUSD', name: 'Cardano', base: 'ADA', feedSymbol: 'ADAUSDT', basePrice: 0.4382, volatility: 0.0025, precision: 5, payoutPct: 80 },
  { symbol: 'LTCUSD', name: 'Litecoin', base: 'LTC', feedSymbol: 'LTCUSDT', basePrice: 71.63, volatility: 0.0018, precision: 2, payoutPct: 79 },
  { symbol: 'TONUSD', name: 'Toncoin', base: 'TON', feedSymbol: 'TONUSDT', basePrice: 6.84, volatility: 0.0026, precision: 4, payoutPct: 78 },
  { symbol: 'AVAXUSD', name: 'Avalanche', base: 'AVAX', feedSymbol: 'AVAXUSDT', basePrice: 27.41, volatility: 0.0026, precision: 3, payoutPct: 78 },
];

async function main() {
  for (const [index, asset] of ASSETS.entries()) {
    await prisma.asset.upsert({
      where: { symbol: asset.symbol },
      update: {
        name: asset.name,
        payoutPct: asset.payoutPct,
        feedSymbol: asset.feedSymbol,
        basePrice: asset.basePrice,
        volatility: asset.volatility,
        precision: asset.precision,
        sortOrder: index,
      },
      create: {
        symbol: asset.symbol,
        name: asset.name,
        base: asset.base,
        quote: 'USD',
        feedSymbol: asset.feedSymbol,
        basePrice: asset.basePrice,
        volatility: asset.volatility,
        precision: asset.precision,
        payoutPct: asset.payoutPct,
        sortOrder: index,
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

  console.log(`Seeded ${ASSETS.length} assets.`);
  console.log(`Admin:  ${adminEmail} / ${adminPassword}`);
  console.log(`Trader: ${demoEmail} / Trader123!`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
