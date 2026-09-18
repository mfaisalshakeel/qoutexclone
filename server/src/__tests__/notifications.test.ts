import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  depositCredited,
  supportReply,
  tournamentFinished,
  tournamentStarted,
  tradeSettled,
  withdrawalUpdated,
  type SettledTrade,
} from '../engine/notifications.js';

const trade = (over: Partial<SettledTrade> = {}): SettledTrade => ({
  id: 'trd_1',
  symbol: 'EURUSD',
  pair: 'EUR/USD',
  direction: 'UP',
  status: 'WON',
  stake: 1_000,
  profit: 850,
  accountType: 'REAL',
  ...over,
});

describe('what a notification says', () => {
  it('is written without a database, a clock or a random number', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/engine/notifications.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bimport\b/);
    for (const forbidden of ['prisma', 'process.', 'date.now', 'math.random', 'password', 'email']) {
      expect(code.toLowerCase(), `mentions ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('tells a winner what came back and what of it was profit', () => {
    const draft = tradeSettled(trade())!;
    expect(draft.title).toBe('EUR/USD Higher won');
    expect(draft.body).toContain('$10.00');
    expect(draft.body).toContain('$18.50');
    expect(draft.body).toContain('$8.50');
    expect(draft.href).toBe('/history');
    expect(draft.key).toBe('trade:trd_1:settled');
  });

  it('never says "won" on a loss, whatever the numbers', () => {
    for (const profit of [-1_000, 0, 500]) {
      const draft = tradeSettled(trade({ status: 'LOST', direction: 'DOWN', profit }))!;
      expect(draft.title).toBe('EUR/USD Lower lost');
      expect(draft.body.toLowerCase(), `profit ${profit}`).not.toContain('won');
      expect(draft.body.toLowerCase()).not.toContain('profit');
    }
  });

  it('calls a tie what it is', () => {
    const draft = tradeSettled(trade({ status: 'REFUNDED', profit: 0 }))!;
    expect(draft.title).toContain('refunded');
    expect(draft.body).toContain('returned in full');
  });

  it('leaves practice results out unless an operator asks for them', () => {
    const practice = trade({ accountType: 'DEMO' });
    expect(tradeSettled(practice)).toBeNull();

    const asked = tradeSettled(practice, { practiceResults: true })!;
    expect(asked.body).toContain('on practice');
  });

  it('sends a tournament result to the tournament, not to history', () => {
    const draft = tradeSettled(trade({ accountType: 'TOURNAMENT' }))!;
    expect(draft.href).toBe('/tournaments');
    expect(draft.body).toContain('in the tournament');
  });

  it('falls back to the symbol when a market has no pair', () => {
    expect(tradeSettled(trade({ pair: null }))!.title).toBe('EURUSD Higher won');
  });

  it('keys each event once, so the same settlement cannot be told twice', () => {
    expect(tradeSettled(trade())!.key).toBe(tradeSettled(trade({ status: 'LOST' }))!.key);
    expect(depositCredited({ id: 'dep_1', creditedAmount: 20_000, currency: 'USDT' }).key).toBe(
      'deposit:dep_1:credited',
    );
  });

  it('announces money in, and the bonus that came with it', () => {
    const deposit = depositCredited({ id: 'dep_1', creditedAmount: 20_000, currency: 'USDT' });
    expect(deposit.title).toBe('Deposit credited');
    expect(deposit.body).toContain('$200.00');
    expect(deposit.body).toContain('USDT');
    expect(deposit.body).not.toContain('bonus');

    const withBonus = depositCredited({
      id: 'dep_2',
      creditedAmount: 20_000,
      bonusAmount: 5_000,
      currency: 'USDT',
    });
    expect(withBonus.body).toContain('$50.00 bonus');
  });

  it('announces money out, in the units it actually left in', () => {
    const sent = withdrawalUpdated({
      id: 'w1',
      amount: 5_000,
      netAmount: 4_900,
      cryptoAmount: '0.00123456',
      status: 'COMPLETED',
      currency: 'BTC',
    })!;
    expect(sent.title).toBe('Withdrawal sent');
    // the fee is already out, so it is the net that travels
    expect(sent.body).toContain('0.00123456 BTC');
    expect(sent.body).toContain('$49.00');

    const declined = withdrawalUpdated({
      id: 'w1',
      amount: 5_000,
      netAmount: 4_900,
      status: 'REJECTED',
      currency: 'BTC',
    })!;
    expect(declined.title).toBe('Withdrawal declined');
    // the whole debit comes back, fee included
    expect(declined.body).toContain('$50.00');
    expect(declined.body).toContain('returned to your balance');
    // the two are different events, so they are keyed apart
    expect(declined.key).not.toBe(sent.key);
  });

  it('says nothing about a withdrawal still working its way through', () => {
    for (const status of ['PENDING', 'APPROVED', 'PROCESSING', 'CANCELLED']) {
      expect(
        withdrawalUpdated({ id: 'w1', amount: 100, netAmount: 90, status, currency: 'BTC' }),
        status,
      ).toBeNull();
    }
  });

  it('places a tournament finisher in plain English', () => {
    const cup = { id: 'tr_1', name: 'Friday Cup' };
    expect(tournamentStarted(cup).title).toBe('Friday Cup has started');

    const winner = tournamentFinished(cup, { rank: 1, prize: 25_000 });
    expect(winner.body).toContain('1st');
    expect(winner.body).toContain('$250.00');

    for (const [rank, reads] of [
      [2, '2nd'],
      [3, '3rd'],
      [4, '4th'],
      [11, '11th'],
      [12, '12th'],
      [13, '13th'],
      [21, '21st'],
      [22, '22nd'],
      [23, '23rd'],
      [111, '111th'],
    ] as const) {
      expect(tournamentFinished(cup, { rank, prize: 0 }).body, `rank ${rank}`).toContain(reads);
    }
  });

  it('does not pretend a prize was won when there was none', () => {
    const draft = tournamentFinished({ id: 'tr_1', name: 'Friday Cup' }, { rank: 9, prize: 0 });
    expect(draft.body).toContain('No prize');
    expect(draft.body).not.toContain('$');
  });

  it('copes with an entrant who never got a rank', () => {
    const draft = tournamentFinished({ id: 'tr_1', name: 'Friday Cup' }, { rank: null, prize: 0 });
    expect(draft.body).toContain('final table');
    expect(draft.body).not.toContain('null');
  });

  it('previews a support reply in one line', () => {
    const draft = supportReply({ id: 'm1', body: '  Hello\n\nthere,   how   can we help?  ' });
    expect(draft.body).toBe('Hello there, how can we help?');
    expect(draft.href).toBeNull();

    const long = supportReply({ id: 'm1', body: 'x'.repeat(400) });
    expect(long.body).toHaveLength(140);
    expect(long.body.endsWith('…')).toBe(true);
  });
});
