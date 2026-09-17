import http from 'node:http';
import { createApp } from './app.js';
import { env } from './env.js';
import { prisma } from './lib/prisma.js';
import { marketFeed } from './engine/feed.js';
import { settlementEngine } from './engine/settlement.js';
import { chainWatcher } from './engine/chain-watcher.js';
import { attachWebsocket } from './ws.js';

async function main() {
  const assets = await prisma.asset.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' } });
  if (assets.length === 0) {
    console.warn(
      '[boot] no assets found — run `npm run seed --workspace=server` to load the default markets',
    );
  }
  marketFeed.load(
    assets.map((a) => ({
      symbol: a.symbol,
      feedSymbol: a.feedSymbol,
      basePrice: a.basePrice,
      volatility: a.volatility,
      precision: a.precision,
    })),
  );
  marketFeed.start();
  settlementEngine.start();
  chainWatcher.start();

  const app = createApp();
  const server = http.createServer(app);
  const ws = attachWebsocket(server);

  server.listen(env.port, () => {
    console.log(`[boot] API listening on http://localhost:${env.port} (feed: ${marketFeed.provider})`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[boot] ${signal} received, shutting down`);
    ws.close();
    settlementEngine.stop();
    chainWatcher.stop();
    marketFeed.stop();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[boot] failed to start:', err);
  process.exit(1);
});
