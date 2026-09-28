/**
 * Removes a load test's trader pool and everything they traded. Pass the run
 * tag `prepare-traders.ts` printed (the timestamp all its emails share), or
 * omit it to remove every `k6-*@loadtest.dev` account this script has ever
 * left behind.
 *
 * Usage: npx tsx --env-file=server/.env k6/cleanup-traders.ts [runTag]
 */
import { prisma } from '../server/src/lib/prisma.js';

async function main() {
  const runTag = process.argv[2];
  const emailFilter = runTag ? `k6-${runTag}-` : 'k6-';
  const traders = await prisma.user.findMany({
    where: { email: { contains: emailFilter, endsWith: '@loadtest.dev' } },
    select: { id: true },
  });
  const ids = traders.map((t) => t.id);
  console.log(`Removing ${ids.length} load-test traders and their trades…`);
  if (ids.length === 0) return;

  await prisma.transaction.deleteMany({ where: { userId: { in: ids } } });
  await prisma.trade.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log('Done.');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
