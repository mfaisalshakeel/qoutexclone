import http from 'node:http';
import { createApp } from './app.js';
import { env } from './env.js';
import { prisma } from './lib/prisma.js';
import { log } from './lib/logger.js';
import { marketFeed } from './engine/feed.js';
import { settlementEngine } from './engine/settlement.js';
import { chainWatcher } from './engine/chain-watcher.js';
import { attachWebsocket } from './ws.js';
import { settings } from './services/settings.js';
import { marketHours } from './services/market-hours.js';

/** How long a shutdown may take before in-flight work is abandoned. */
const SHUTDOWN_GRACE_MS = 15_000;

async function main() {
  // runtime configuration first: services read it synchronously afterwards
  await settings.load();
  await marketHours.load();

  const assets = await prisma.asset.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' } });
  if (assets.length === 0) {
    log.boot.warn('no assets found — run `npm run seed --workspace=server` to load the default markets');
  }

  marketFeed.load(
    assets.map((asset) => ({
      symbol: asset.symbol,
      feedSymbol: asset.feedSymbol,
      basePrice: asset.basePrice,
      volatility: asset.volatility,
      precision: asset.precision,
    })),
  );
  // a closed exchange stops printing prices; OTC and crypto never close
  const sessionByAsset = new Map(assets.map((asset) => [asset.symbol, asset.scheduleId]));
  marketFeed.setSessionResolver((symbol) => marketHours.stateFor(sessionByAsset.get(symbol) ?? null).isOpen);
  marketFeed.start();
  settlementEngine.start();
  chainWatcher.start();

  const app = createApp();
  const server = http.createServer(app);
  const ws = attachWebsocket(server);

  server.listen(env.port, () => {
    log.boot.info(
      { port: env.port, feed: marketFeed.provider, markets: assets.length, env: env.nodeEnv },
      'API listening',
    );
  });

  let shuttingDown = false;

  /**
   * Drains in order: stop accepting connections, stop the sweepers (so no
   * settlement starts that cannot finish), close sockets, then release the
   * database. A second signal, or the grace timer, forces the exit.
   */
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      log.boot.warn({ signal }, 'second signal received, exiting immediately');
      process.exit(1);
    }
    shuttingDown = true;
    log.boot.info({ signal }, 'shutting down');

    const force = setTimeout(() => {
      log.boot.error({ graceMs: SHUTDOWN_GRACE_MS }, 'shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    force.unref();

    try {
      server.closeIdleConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      // the settlement loop finishes its current pass before stopping
      await settlementEngine.drain();
      chainWatcher.stop();
      marketFeed.stop();
      ws.close();
      await prisma.$disconnect();
      clearTimeout(force);
      log.boot.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      log.boot.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => log.boot.error({ err: reason }, 'unhandled rejection'));
  process.on('uncaughtException', (err) => {
    log.boot.fatal({ err }, 'uncaught exception');
    void shutdown('uncaughtException');
  });
}

main().catch((err) => {
  log.boot.fatal({ err }, 'failed to start');
  process.exit(1);
});
