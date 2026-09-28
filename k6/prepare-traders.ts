/**
 * Provisions the trader pool a k6 run trades against, straight through
 * Prisma and the same JWT signer the API uses — never through the HTTP
 * `/register` or `/login` routes. Those sit behind `authLimiter` (an
 * IP-keyed rate limit, correctly so — see Security review) and bcrypt
 * hashing/comparison, both of which a load test firing from one source IP
 * would hit long before reaching 1,000 traders. Neither is what a "1,000
 * concurrent traders placing trades" load test is trying to measure — that
 * is the trading path itself — so this script mints the pool out of band,
 * exactly like a real operator running a load test against their own
 * platform would.
 *
 * Usage (from the repo root, server env already migrated/seeded):
 *   npx tsx --env-file=server/.env k6/prepare-traders.ts [count]
 *
 * Writes k6/traders.json: an array of { id, email, accessToken }, read by
 * trade-load.js via k6's SharedArray.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../server/src/lib/prisma.js';
import { signAccessToken } from '../server/src/lib/jwt.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const count = Number(process.argv[2] ?? 1000);
const RUN_TAG = Date.now();

async function main() {
  console.log(`Provisioning ${count} trader accounts (run tag ${RUN_TAG})…`);
  const traders: { id: string; email: string; accessToken: string }[] = [];

  // batched, not one at a time — this is a one-off setup cost, not the thing
  // being measured, but there is no reason to make it needlessly slow either
  const BATCH = 50;
  for (let start = 0; start < count; start += BATCH) {
    const batch = Array.from({ length: Math.min(BATCH, count - start) }, (_, i) => start + i);
    const created = await Promise.all(
      batch.map((i) =>
        prisma.user.create({
          data: {
            email: `k6-${RUN_TAG}-${i}@loadtest.dev`,
            name: `Load Test Trader ${i}`,
            // never logged in with, so the hash's cost doesn't matter — a
            // fixed cheap placeholder keeps provisioning fast
            passwordHash: 'k6-load-test-no-login',
            referralCode: `K6${RUN_TAG}${i}`.slice(0, 20).toUpperCase(),
            demoBalance: 10_000_000, // $100,000 demo — never runs out mid-run
          },
          select: { id: true, email: true },
        }),
      ),
    );
    for (const user of created) {
      traders.push({
        id: user.id,
        email: user.email,
        accessToken: signAccessToken({ sub: user.id, role: 'TRADER', email: user.email }),
      });
    }
    process.stdout.write(`\r  ${traders.length}/${count}`);
  }
  console.log('');

  const outFile = path.join(dir, 'traders.json');
  fs.writeFileSync(outFile, JSON.stringify(traders));
  console.log(`Wrote ${traders.length} traders to ${outFile}`);
  console.log(`Clean up afterwards with: npx tsx --env-file=server/.env k6/cleanup-traders.ts ${RUN_TAG}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
