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
import { emailOverrideCache } from './services/content.js';
import { marketHours } from './services/market-hours.js';
import { StatePersister, loadStates } from './services/otc-state.js';
import { candleStore } from './services/candles.js';
import { payouts } from './services/payouts.js';
import { sentiment } from './services/sentiment.js';
import { leaderboard } from './services/leaderboard.js';
import { startNotifications, stopNotifications } from './services/notifications.js';
import { loadRevocations, pruneRevocations } from './services/revocations.js';
import { configureMailer, watchMailSettings } from './services/mailer.js';
import { attachEmailNotifications } from './services/email-notifications.js';
import { attachProgression } from './services/progression.js';
import { registerProvider } from './services/payments.js';
import { cryptoProvider } from './services/providers/crypto.js';
import { cardProvider } from './services/providers/card.js';
import { ewalletProvider } from './services/providers/ewallet.js';
import { expireStale } from './services/marketplace.js';
import type { OtcParams } from './engine/otc.js';

/** How long a shutdown may take before in-flight work is abandoned. */
const SHUTDOWN_GRACE_MS = 15_000;

async function main() {
  // runtime configuration first: services read it synchronously afterwards
  await settings.load();
  await emailOverrideCache.load();
  await marketHours.load();
  await payouts.load();
  // a restart must not quietly un-revoke a device someone signed out
  await loadRevocations();
  // email last of the configuration: it reads the settings that just loaded
  configureMailer();
  watchMailSettings();
  registerProvider(cryptoProvider);
  registerProvider(cardProvider);
  registerProvider(ewalletProvider);
  const revocationSweeper = setInterval(pruneRevocations, 15 * 60 * 1000);
  revocationSweeper.unref();

  const assets = await prisma.asset.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' } });
  if (assets.length === 0) {
    log.boot.warn('no assets found — run `npm run seed --workspace=server` to load the default markets');
  }

  const symbols = new Set(assets.map((asset) => asset.symbol));
  marketFeed.load(
    assets.map((asset) => ({
      symbol: asset.symbol,
      feedSymbol: asset.feedSymbol,
      basePrice: asset.basePrice,
      volatility: asset.volatility,
      precision: asset.precision,
      assetClass: asset.assetClass,
      isOtc: asset.isOtc,
      otcConfig: (asset.otcConfig as Partial<OtcParams> | null) ?? null,
      // an OTC market may track its spot twin while that market is open
      spotSymbol:
        asset.isOtc && symbols.has(asset.symbol.replace('_OTC', ''))
          ? asset.symbol.replace('_OTC', '')
          : null,
    })),
  );

  // continue each market's price path from where the last process left it
  marketFeed.resume(await loadStates([...symbols]));

  // the store owns durable history; the feed hands it every closed candle
  for (const asset of assets) {
    candleStore.register(asset.symbol, {
      basePrice: asset.basePrice,
      volatility: asset.volatility,
      precision: asset.precision,
      otcConfig: (asset.otcConfig as Partial<OtcParams> | null) ?? null,
      // generated history is pinned to the price the market trades at now
      priceNow: () => marketFeed.getPrice(asset.symbol),
    });
  }
  marketFeed.on('candleClosed', ({ symbol, timeframe, candle }) =>
    candleStore.record(symbol, timeframe, candle),
  );
  // and the buckets still open, so a restart never leaves a hole in the chart
  candleStore.setLiveSource(() => marketFeed.openCandles());
  // pick up whatever the last process was in the middle of printing
  marketFeed.primeCandles(await candleStore.openBuckets([...symbols]));
  candleStore.start();
  payouts.start();
  sentiment.start();
  leaderboard.start();
  startNotifications();
  attachEmailNotifications();
  attachProgression();
  // an item whose window has closed must not go on working; the sweeper keeps
  // the inventory honest even for a trader who never opens the page
  const marketplaceSweeper = setInterval(() => void expireStale(), 60_000);
  marketplaceSweeper.unref();
  // a closed exchange stops printing prices; OTC and crypto never close
  const sessionByAsset = new Map(assets.map((asset) => [asset.symbol, asset.scheduleId]));
  marketFeed.setSessionResolver((symbol) => marketHours.stateFor(sessionByAsset.get(symbol) ?? null).isOpen);
  marketFeed.start();
  settlementEngine.start();
  chainWatcher.start();

  const persister = new StatePersister(() => marketFeed.snapshot());
  persister.start();

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
      // persist prices last, so the snapshot is the final one
      await persister.flush();
      payouts.stop();
      sentiment.stop();
      leaderboard.stop();
      stopNotifications();
      candleStore.stop();
      await candleStore.flush();
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
