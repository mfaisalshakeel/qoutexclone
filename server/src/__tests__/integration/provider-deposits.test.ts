/**
 * Card and e-wallet deposits against a real database.
 *
 * The signature maths is covered by `payments.test.ts`; what only shows up
 * across rows is whether a webhook actually finds and credits the right
 * deposit, whether a repeated delivery is a genuine no-op (idempotent
 * crediting), and whether every bonus rule that already applies to a crypto
 * deposit applies here too — since both paths end at `completeDeposit`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('provider deposits', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let providerDeposits: typeof import('../../services/provider-deposits.js');
  let payments: typeof import('../../services/payments.js');
  let cardProvider: (typeof import('../../services/providers/card.js'))['cardProvider'];
  let ewalletProvider: (typeof import('../../services/providers/ewallet.js'))['ewalletProvider'];

  const made: string[] = [];

  const makeUser = async (overrides: Record<string, unknown> = {}) => {
    const user = await prisma.user.create({
      data: {
        email: `pd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Sandbox Trader',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        kycStatus: 'APPROVED',
        ...overrides,
      },
    });
    made.push(user.id);
    return user;
  };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    providerDeposits = await import('../../services/provider-deposits.js');
    payments = await import('../../services/payments.js');
    cardProvider = (await import('../../services/providers/card.js')).cardProvider;
    ewalletProvider = (await import('../../services/providers/ewallet.js')).ewalletProvider;
    payments.registerProvider(cardProvider);
    payments.registerProvider(ewalletProvider);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.transaction.deleteMany({ where: { userId: { in: made } } });
    await prisma.deposit.deleteMany({ where: { userId: { in: made } } });
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    await prisma.$disconnect();
  });

  it('opens a checkout session, credits on the signed webhook, and is idempotent', async () => {
    const user = await makeUser();
    const deposit = await providerDeposits.createProviderDeposit({
      userId: user.id,
      methodKey: 'card-usd',
      usdAmount: 75,
    });
    expect(deposit.status).toBe('AWAITING_PAYMENT');
    expect(deposit.network).toBe('CARD');

    await providerDeposits.simulateProviderPayment(user.id, deposit.id);
    const credited = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(credited.status).toBe('COMPLETED');
    expect(credited.creditedAmount).toBe(7_500);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.realBalance).toBe(7_500);

    // a real provider eventually retries a webhook delivery; the second one
    // must not pay again
    await providerDeposits.simulateProviderPayment(user.id, deposit.id).catch(() => undefined);
    const rows = await prisma.transaction.findMany({ where: { userId: user.id, type: 'DEPOSIT' } });
    expect(rows).toHaveLength(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).realBalance).toBe(7_500);
  });

  it('refuses a webhook whose signature does not verify', async () => {
    const user = await makeUser();
    const deposit = await providerDeposits.createProviderDeposit({
      userId: user.id,
      methodKey: 'ewallet-usd',
      usdAmount: 40,
    });

    const body = Buffer.from(JSON.stringify({ externalId: deposit.externalRef, amountCents: 4_000 }));
    await expect(
      providerDeposits.processPaymentWebhook('EWALLET', { 'x-quantex-signature': 'sha256=deadbeef' }, body),
    ).rejects.toMatchObject({ code: 'bad_signature' });

    expect((await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } })).status).toBe(
      'AWAITING_PAYMENT',
    );
  });

  it('refuses a genuinely signed webhook for a deposit that does not exist', async () => {
    const { body, headers } = payments.buildSandboxWebhook('CARD', {
      externalId: 'card_never_created',
      amountCents: 1_000,
    });
    await expect(providerDeposits.processPaymentWebhook('CARD', headers, body)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('carries every bonus rule a crypto deposit gets, since both end at completeDeposit', async () => {
    const user = await makeUser({ totalDeposited: 2_000_000 }); // already VIP
    const deposit = await providerDeposits.createProviderDeposit({
      userId: user.id,
      methodKey: 'card-usd',
      usdAmount: 100,
    });
    await providerDeposits.simulateProviderPayment(user.id, deposit.id);

    const bonusRows = await prisma.bonus.findMany({ where: { userId: user.id, source: 'status' } });
    expect(bonusRows).toHaveLength(1);
    expect(bonusRows[0].amount).toBeGreaterThan(0);
  });

  it('never lets a checkout be paid for a method that is disabled', async () => {
    const user = await makeUser();
    await prisma.paymentMethod.update({ where: { key: 'card-usd' }, data: { enabled: false } });
    try {
      await expect(
        providerDeposits.createProviderDeposit({ userId: user.id, methodKey: 'card-usd', usdAmount: 50 }),
      ).rejects.toMatchObject({ code: 'method_disabled' });
    } finally {
      await prisma.paymentMethod.update({ where: { key: 'card-usd' }, data: { enabled: true } });
    }
  });

  it('e-wallet pays out; card refuses, since a card cannot receive an arbitrary payout', async () => {
    const method = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: 'ewallet-usd' } });
    const result = await ewalletProvider.payout({
      method,
      amountCents: 5_000,
      destination: 'trader@example.test',
      reference: 'wd_test',
    });
    expect(result.status).toBe('SENT');

    const cardMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: 'card-usd' } });
    await expect(
      cardProvider.payout({ method: cardMethod, amountCents: 5_000, destination: 'x', reference: 'wd_test' }),
    ).rejects.toMatchObject({ code: 'payout_unsupported' });
  });
});
