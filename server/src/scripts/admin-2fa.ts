/**
 * Turns the admin two-factor requirement on or off from a shell.
 *
 * The setting itself lives in the back office, which is exactly what the
 * requirement gates — so an operator with no authenticator to hand has no way
 * in through the UI. This is that way in.
 *
 *   npm run admin:2fa -- off
 *   npm run admin:2fa -- on
 *   npm run admin:2fa            # prints the current value
 */
import '../lib/load-env.js';
import { prisma } from '../lib/prisma.js';
import { settings } from '../services/settings.js';

const KEY = 'security.adminTwoFactorRequired' as const;

async function main(): Promise<void> {
  const arg = process.argv[2]?.toLowerCase();
  await settings.load();

  if (!arg) {
    console.log(`Admin two-factor is ${settings.get(KEY) ? 'REQUIRED' : 'not required'}.`);
    console.log('Pass "on" or "off" to change it.');
    return;
  }

  if (arg !== 'on' && arg !== 'off') {
    console.error(`Unknown argument "${arg}". Use "on" or "off".`);
    process.exitCode = 1;
    return;
  }

  await settings.set(KEY, arg === 'on');
  console.log(
    arg === 'on'
      ? 'Admin two-factor is now REQUIRED. Admins without it are sent to Account → Security.'
      : 'Admin two-factor is no longer required. Turn it back on before this platform handles real money.',
  );
}

await main();
await prisma.$disconnect();
