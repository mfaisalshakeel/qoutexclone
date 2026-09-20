import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRevocations,
  isSessionRevoked,
  pruneRevocations,
  revocationCount,
  revokeSessions,
} from './revocations.js';

describe('session revocations', () => {
  beforeEach(clearRevocations);

  it('knows nothing about a session that was never revoked', () => {
    expect(isSessionRevoked('never')).toBe(false);
  });

  it('remembers a revoked session', () => {
    revokeSessions(['a', 'b']);
    expect(isSessionRevoked('a')).toBe(true);
    expect(isSessionRevoked('b')).toBe(true);
    expect(isSessionRevoked('c')).toBe(false);
  });

  it('forgets one once no access token could still be alive', () => {
    const longAgo = Date.now() - 3 * 60 * 60 * 1000;
    revokeSessions(['old'], longAgo);
    expect(isSessionRevoked('old')).toBe(false);
    // and reading it drops the entry rather than letting the map grow
    expect(revocationCount()).toBe(0);
  });

  it('prunes without being asked about each one', () => {
    revokeSessions(['old'], Date.now() - 3 * 60 * 60 * 1000);
    revokeSessions(['fresh']);
    expect(pruneRevocations()).toBe(1);
    expect(isSessionRevoked('fresh')).toBe(true);
  });
});
