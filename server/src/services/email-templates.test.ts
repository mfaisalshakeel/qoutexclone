import { describe, expect, it } from 'vitest';
import {
  adminMessage,
  depositCredited,
  kycResult,
  newDeviceAlert,
  ordinalOf,
  resetPassword,
  tournamentResult,
  twoFactorChanged,
  verifyEmail,
  withdrawalUpdate,
} from './email-templates.js';

const URL = 'https://quantex.example/wallet';

describe('ordinalOf', () => {
  it('names a place the way a person would', () => {
    expect([1, 2, 3, 4, 21, 22, 23].map(ordinalOf)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '21st',
      '22nd',
      '23rd',
    ]);
  });

  it('gets the teens right, which is where the pattern breaks', () => {
    expect([11, 12, 13, 111, 112].map(ordinalOf)).toEqual(['11th', '12th', '13th', '111th', '112th']);
  });
});

describe('templates', () => {
  const every = [
    verifyEmail({ name: 'Amelia', url: URL, hours: 48 }),
    newDeviceAlert({
      name: 'Amelia',
      device: 'Chrome on Windows',
      ip: '81.2.69.142',
      at: new Date(0),
      url: URL,
    }),
    twoFactorChanged({ name: 'Amelia', enabled: true, url: URL }),
    resetPassword({ name: 'Amelia', url: URL, minutes: 30 }),
    depositCredited({
      name: 'Amelia',
      amount: 25_000,
      bonus: 0,
      currency: 'USDT',
      network: 'TRC-20',
      url: URL,
    }),
    withdrawalUpdate({ name: 'Amelia', status: 'COMPLETED', amount: 10_000, note: null, url: URL }),
    kycResult({ name: 'Amelia', approved: true, reason: null, url: URL }),
    tournamentResult({ name: 'Amelia', tournament: 'Friday Sprint', place: 2, prize: 5_000, url: URL }),
  ];

  it('always has a subject, an HTML body and a text alternative', () => {
    for (const message of every) {
      expect(message.subject.length).toBeGreaterThan(0);
      expect(message.html).toContain('<html');
      expect(message.text.length).toBeGreaterThan(0);
      expect(message.html).toContain(URL);
      expect(message.text).toContain(URL);
    }
  });

  it('carries the risk warning in every message', () => {
    for (const message of every) expect(message.html).toContain('you can lose the money');
  });

  it('shows money in dollars, never in the cents it is stored as', () => {
    const deposit = depositCredited({
      name: 'Amelia',
      amount: 25_000,
      bonus: 2_500,
      currency: 'USDT',
      network: 'TRC-20',
      url: URL,
    });
    expect(deposit.text).toContain('$250.00');
    expect(deposit.text).toContain('$25.00');
    expect(deposit.subject).toBe('$250.00 credited to your Quantex account');
  });

  it('leaves the bonus out when there was not one', () => {
    const plain = depositCredited({
      name: 'Amelia',
      amount: 25_000,
      bonus: 0,
      currency: 'USDT',
      network: 'TRC-20',
      url: URL,
    });
    expect(plain.text).not.toContain('bonus');
  });

  it('escapes anything a person could have typed', () => {
    const message = verifyEmail({ name: '<script>alert(1)</script>', url: URL, hours: 1 });
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });

  it('says what happened to a withdrawal in words, not a status code', () => {
    expect(
      withdrawalUpdate({ name: 'A', status: 'REJECTED', amount: 1, note: 'Bad address', url: URL }).subject,
    ).toContain('declined');
    expect(
      withdrawalUpdate({ name: 'A', status: 'REJECTED', amount: 1, note: 'Bad address', url: URL }).text,
    ).toContain('Bad address');
  });

  it('congratulates a prize and stays plain without one', () => {
    const won = tournamentResult({ name: 'A', tournament: 'Sprint', place: 1, prize: 10_000, url: URL });
    const lost = tournamentResult({ name: 'A', tournament: 'Sprint', place: 9, prize: 0, url: URL });
    expect(won.subject).toContain('1st');
    expect(won.text).toContain('$100.00');
    expect(lost.subject).toBe('Sprint has finished');
    expect(lost.text).toContain('9th');
  });
});

describe('adminMessage', () => {
  it('carries the subject and body an admin wrote, verbatim in the text version', () => {
    const message = adminMessage({ name: 'Amelia', subject: 'About your account', body: 'Everything checks out.' });
    expect(message.subject).toBe('About your account');
    expect(message.html).toContain('<html');
    expect(message.text).toContain('Everything checks out.');
    expect(message.html).toContain('you can lose the money');
  });

  it('keeps paragraph breaks and escapes what the admin typed', () => {
    const message = adminMessage({
      name: 'Amelia',
      subject: 'Note',
      body: 'First line.\n\n<script>alert(1)</script>',
    });
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
    expect(message.html).toContain('First line.');
  });
});
