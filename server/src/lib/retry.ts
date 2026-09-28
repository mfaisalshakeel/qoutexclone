import { Prisma } from '@prisma/client';

/**
 * Retries a write that lost a race for the row.
 *
 * MySQL can refuse one of two transactions touching the same row at the same
 * instant (Prisma reports P2034). A P2034 means the whole transaction rolled
 * back — nothing it did committed — so asking again is safe for *any* write
 * this wraps, money included, as long as the write has no effect outside the
 * transaction itself that something else could have already observed. A
 * preference (a chart layout, a set of studies) trivially satisfies that. So
 * do `placeTrade` and `settleTrade`'s transactions: each only emits its event
 * after the `$transaction` call resolves, so a conflict there means no trade,
 * no ledger entry and no event either — there is nothing to double up by
 * trying again. Never wrap a transaction whose callback does something
 * irreversible before returning (an external API call, a side effect other
 * code could read mid-transaction) — retrying that would repeat the part
 * that already happened.
 */
export async function retryOnConflict<T>(
  write: () => Promise<T>,
  options: { attempts?: number; waitMs?: (attempt: number) => number } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const waitMs = options.waitMs ?? ((attempt: number) => 20 * 2 ** attempt);

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await write();
    } catch (err) {
      if (!isConflict(err) || attempt >= attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, waitMs(attempt)));
    }
  }
}

/**
 * P2034 is Prisma's own "write conflict or deadlock, please retry" for an
 * interactive transaction. A `SELECT ... FOR UPDATE` (see `applyLedger`,
 * `adjustEntryBalance`) goes through `$queryRaw` instead, so MySQL's own
 * deadlock (1213) and lock-wait-timeout (1205) errors surface as Prisma's
 * generic "raw query failed" (P2010) wrapping the driver's error code —
 * still the same thing: the transaction rolled back, nothing committed,
 * asking again is exactly correct.
 */
export function isConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code === 'P2034') return true;
  if (err.code === 'P2010') {
    const meta = err.meta as { code?: string } | undefined;
    return meta?.code === '1213' || meta?.code === '1205';
  }
  return false;
}
