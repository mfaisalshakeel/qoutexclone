import { prisma } from '../lib/prisma.js';
import { env } from '../env.js';
import { mockTxHash } from '../lib/crypto-networks.js';
import { completeDeposit, depositEvents, expireStaleDeposits, markSeen } from '../services/deposits.js';
import { log } from '../lib/logger.js';

const POLL_MS = 5000;

/**
 * Stands in for a real blockchain listener.
 *
 * With a real node or custody webhook you would call `markSeen` when the
 * transaction hits the mempool and `completeDeposit` once it has enough
 * confirmations — exactly what this watcher does, just against a timer instead
 * of a chain. Disable with MOCK_CHAIN_WATCHER=false and drive the same two
 * functions from your provider's webhook.
 */
export class ChainWatcher {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  start(): void {
    if (this.timer) return;
    if (env.mockChainWatcher) {
      log.chain.warn(
        'mock watcher enabled: pending deposits auto-confirm (MOCK_CHAIN_WATCHER=false to disable)',
      );
    }
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await expireStaleDeposits();
      if (!env.mockChainWatcher) return;

      const awaiting = await prisma.deposit.findMany({
        where: {
          status: 'AWAITING_PAYMENT',
          createdAt: { lte: new Date(Date.now() - env.mockChainConfirmMs) },
        },
        take: 50,
      });
      for (const deposit of awaiting) {
        await markSeen(deposit.id, mockTxHash(deposit.network, deposit.id));
      }

      const confirming = await prisma.deposit.findMany({ where: { status: 'CONFIRMING' }, take: 50 });
      for (const deposit of confirming) {
        const step = Math.max(1, Math.ceil(deposit.requiredConf / 4));
        const confirmations = deposit.confirmations + step;
        if (confirmations >= deposit.requiredConf) {
          await completeDeposit(deposit.id);
        } else {
          const updated = await prisma.deposit.update({ where: { id: deposit.id }, data: { confirmations } });
          depositEvents.emit('updated', updated);
        }
      }
    } catch (err) {
      log.chain.error({ err }, 'watcher pass failed');
    } finally {
      this.busy = false;
    }
  }
}

export const chainWatcher = new ChainWatcher();
