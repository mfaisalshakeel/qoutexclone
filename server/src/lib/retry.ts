import { Prisma } from '@prisma/client';

/**
 * Retries a write that lost a race for the row.
 *
 * MySQL can refuse one of two transactions touching the same row at the same
 * instant (Prisma reports P2034). For a *preference* — a chart layout, a set of
 * studies — that is not a failure worth showing anyone: the trader changed a
 * setting while a trade happened to settle against the same account row, and
 * the write simply needs asking again.
 *
 * Only for writes that are safe to repeat. Money never comes through here: a
 * ledger entry that lost its race must fail loudly rather than be replayed.
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

/** P2034 is Prisma's "write conflict or deadlock, please retry". */
export function isConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';
}
