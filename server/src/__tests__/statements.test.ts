import { describe, expect, it } from 'vitest';
import type { Transaction } from '@prisma/client';
import { renderStatementCsv } from '../services/statements.js';

function row(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx_1',
    userId: 'u1',
    accountType: 'REAL',
    type: 'DEPOSIT',
    amount: 10_000,
    balanceAfter: 10_000,
    refType: null,
    refId: null,
    note: null,
    createdAt: new Date('2026-01-15T10:30:00.000Z'),
    ...overrides,
  } as Transaction;
}

describe('renderStatementCsv', () => {
  it('writes one header row and one row per transaction', () => {
    const csv = renderStatementCsv([row(), row({ id: 'tx_2', amount: -5_000, balanceAfter: 5_000 })]);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('Date (UTC),Type,Note,Amount (USD),Balance after (USD)');
  });

  it('formats cents as dollars with two decimal places', () => {
    const csv = renderStatementCsv([row({ amount: 12_345, balanceAfter: 99_999 })]);
    expect(csv).toContain('123.45,999.99');
  });

  it('title-cases the underscored type', () => {
    const csv = renderStatementCsv([row({ type: 'WITHDRAWAL_HOLD' })]);
    expect(csv).toContain('Withdrawal hold');
  });

  it('quotes a note containing a comma, and leaves a plain one bare', () => {
    const withComma = renderStatementCsv([row({ note: 'Bonus, staged' })]);
    expect(withComma).toContain('"Bonus, staged"');

    const plain = renderStatementCsv([row({ note: 'Deposit credited' })]);
    expect(plain).toContain(',Deposit credited,');
  });

  it('escapes an embedded quote by doubling it', () => {
    const csv = renderStatementCsv([row({ note: 'Say "hi"' })]);
    expect(csv).toContain('"Say ""hi"""');
  });

  it('writes an empty string for a null note, never the word null', () => {
    const csv = renderStatementCsv([row({ note: null })]);
    expect(csv).not.toMatch(/null/i);
  });

  it('produces only the header row when there are no transactions', () => {
    const csv = renderStatementCsv([]);
    expect(csv.trim().split('\r\n')).toHaveLength(1);
  });
});
