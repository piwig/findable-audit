import { describe, it, expect } from 'vitest';
import { isBlockedAddress } from '../src/ssrf.js';

// Representative IPs per range. This is the canonical predicate shared by the
// crawler guard and the web app; the web app re-tests the same logic through
// its own import, but the source of truth is here.
describe('isBlockedAddress', () => {
  it('blocks loopback (127.0.0.0/8, ::1)', () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('127.9.9.9')).toBe(true);
    expect(isBlockedAddress('::1')).toBe(true);
  });

  it('blocks RFC1918 private ranges', () => {
    expect(isBlockedAddress('10.0.0.1')).toBe(true);
    expect(isBlockedAddress('10.255.255.255')).toBe(true);
    expect(isBlockedAddress('172.16.0.1')).toBe(true);
    expect(isBlockedAddress('172.31.255.255')).toBe(true);
    expect(isBlockedAddress('192.168.0.1')).toBe(true);
    expect(isBlockedAddress('192.168.255.255')).toBe(true);
  });

  it('does NOT block 172.15/172.32 (outside 172.16/12)', () => {
    expect(isBlockedAddress('172.15.0.1')).toBe(false);
    expect(isBlockedAddress('172.32.0.1')).toBe(false);
  });

  it('blocks link-local incl. cloud metadata 169.254.169.254', () => {
    expect(isBlockedAddress('169.254.0.1')).toBe(true);
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
    expect(isBlockedAddress('fe80::1')).toBe(true);
  });

  it('blocks unspecified addresses (0.0.0.0, ::)', () => {
    expect(isBlockedAddress('0.0.0.0')).toBe(true);
    expect(isBlockedAddress('::')).toBe(true);
  });

  it('blocks carrier-grade NAT 100.64/10 (and not its neighbours)', () => {
    expect(isBlockedAddress('100.64.0.1')).toBe(true);
    expect(isBlockedAddress('100.127.255.255')).toBe(true);
    expect(isBlockedAddress('100.63.255.255')).toBe(false);
    expect(isBlockedAddress('100.128.0.1')).toBe(false);
  });

  it('blocks IETF-assignments, benchmarking, multicast, reserved', () => {
    expect(isBlockedAddress('192.0.0.1')).toBe(true); // 192.0.0.0/24
    expect(isBlockedAddress('198.18.0.1')).toBe(true); // 198.18.0.0/15
    expect(isBlockedAddress('224.0.0.1')).toBe(true); // multicast
    expect(isBlockedAddress('255.255.255.255')).toBe(true); // broadcast (240/4)
  });

  it('blocks IPv6 unique-local and multicast', () => {
    expect(isBlockedAddress('fc00::1')).toBe(true);
    expect(isBlockedAddress('fd12:3456::1')).toBe(true);
    expect(isBlockedAddress('ff02::1')).toBe(true);
  });

  it('unwraps IPv4-mapped / NAT64 IPv6 to catch internal targets', () => {
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isBlockedAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isBlockedAddress('64:ff9b::127.0.0.1')).toBe(true);
    // A mapped *public* address is still allowed.
    expect(isBlockedAddress('::ffff:93.184.216.34')).toBe(false);
  });

  it('allows normal public addresses', () => {
    expect(isBlockedAddress('93.184.216.34')).toBe(false);
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('1.1.1.1')).toBe(false);
    expect(isBlockedAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
  });

  it('treats non-IP input as blocked (defensive default)', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
  });
});
