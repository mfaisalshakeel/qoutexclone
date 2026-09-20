import { describe, expect, it } from 'vitest';
import { addressOf, describeDevice, fingerprint, networkOf } from './device.js';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const EDGE_WINDOWS = `${CHROME_WINDOWS} Edg/131.0.0.0`;

describe('describeDevice', () => {
  it('names the browser and the platform', () => {
    expect(describeDevice(CHROME_WINDOWS)).toBe('Chrome on Windows');
    expect(describeDevice(SAFARI_IPHONE)).toBe('Safari on iPhone');
  });

  it('prefers the specific browser over the engine it claims to be', () => {
    expect(describeDevice(EDGE_WINDOWS)).toBe('Edge on Windows');
  });

  it('never returns an empty label', () => {
    expect(describeDevice(undefined)).toBe('Unknown device');
    expect(describeDevice('   ')).toBe('Unknown device');
    expect(describeDevice('curl/8.4.0')).toBe('Unknown device');
  });
});

describe('networkOf', () => {
  it('keeps the network and drops the host, so a phone is not new every hour', () => {
    expect(networkOf('81.2.69.142')).toBe('81.2.69.0');
    expect(networkOf('81.2.69.7')).toBe('81.2.69.0');
  });

  it('keeps an IPv6 routing prefix', () => {
    expect(networkOf('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3:8d3');
  });

  it('unwraps the IPv4-in-IPv6 form Node hands over', () => {
    expect(networkOf('::ffff:81.2.69.142')).toBe('81.2.69.0');
  });

  it('has an answer for nothing at all', () => {
    expect(networkOf(undefined)).toBe('unknown');
  });
});

describe('fingerprint', () => {
  it('is the same browser from the same network', () => {
    expect(fingerprint({ userAgent: CHROME_WINDOWS, ip: '81.2.69.142' })).toBe(
      fingerprint({ userAgent: CHROME_WINDOWS, ip: '81.2.69.9' }),
    );
  });

  it('changes with the browser and with the network', () => {
    const base = fingerprint({ userAgent: CHROME_WINDOWS, ip: '81.2.69.142' });
    expect(fingerprint({ userAgent: SAFARI_IPHONE, ip: '81.2.69.142' })).not.toBe(base);
    expect(fingerprint({ userAgent: CHROME_WINDOWS, ip: '203.0.113.5' })).not.toBe(base);
  });

  it('does not carry the address around in the clear', () => {
    expect(fingerprint({ userAgent: CHROME_WINDOWS, ip: '81.2.69.142' })).not.toContain('81.2');
  });
});

describe('addressOf', () => {
  it('prefers what Express resolved', () => {
    expect(addressOf({ ip: '81.2.69.142', socket: { remoteAddress: '10.0.0.1' } })).toBe('81.2.69.142');
  });

  it('falls back to the socket, and then to a placeholder', () => {
    expect(addressOf({ socket: { remoteAddress: '::ffff:10.0.0.1' } })).toBe('10.0.0.1');
    expect(addressOf({})).toBe('unknown');
  });
});
