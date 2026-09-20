import { describe, it, expect } from 'vitest';
import {
  isPrivateOrReservedIpv4,
  isPrivateOrReservedIpv6,
  isPrivateOrReservedIp,
  validateSafeUrl,
} from '@/lib/security/ssrf';

describe('SSRF Protection Module', () => {
  it('identifies private and reserved IPv4 addresses', () => {
    expect(isPrivateOrReservedIpv4('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIpv4('127.0.0.2')).toBe(true);
    expect(isPrivateOrReservedIpv4('10.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIpv4('10.255.255.255')).toBe(true);
    expect(isPrivateOrReservedIpv4('172.16.0.1')).toBe(true);
    expect(isPrivateOrReservedIpv4('172.31.255.255')).toBe(true);
    expect(isPrivateOrReservedIpv4('192.168.1.1')).toBe(true);
    expect(isPrivateOrReservedIpv4('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIpv4('0.0.0.0')).toBe(true);
    expect(isPrivateOrReservedIpv4('224.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIpv4('240.0.0.1')).toBe(true);

    expect(isPrivateOrReservedIpv4('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIpv4('1.1.1.1')).toBe(false);
    expect(isPrivateOrReservedIpv4('93.184.216.34')).toBe(false);
  });

  it('identifies private and reserved IPv6 addresses', () => {
    expect(isPrivateOrReservedIpv6('::1')).toBe(true);
    expect(isPrivateOrReservedIpv6('0:0:0:0:0:0:0:1')).toBe(true);
    expect(isPrivateOrReservedIpv6('fe80::1')).toBe(true);
    expect(isPrivateOrReservedIpv6('fc00::1')).toBe(true);
    expect(isPrivateOrReservedIpv6('fd00::1')).toBe(true);
    expect(isPrivateOrReservedIpv6('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIpv6('::ffff:192.168.1.1')).toBe(true);

    expect(isPrivateOrReservedIpv6('2001:4860:4860::8888')).toBe(false);
  });

  it('correctly dispatches isPrivateOrReservedIp', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIp('not-an-ip')).toBe(true);
  });

  it('rejects disallowed protocols and dangerous hostnames in validateSafeUrl', async () => {
    const fileResult = await validateSafeUrl('file:///etc/passwd');
    expect(fileResult.safe).toBe(false);

    const ftpResult = await validateSafeUrl('ftp://example.com/file');
    expect(ftpResult.safe).toBe(false);

    const localResult = await validateSafeUrl('http://localhost:3000/api');
    expect(localResult.safe).toBe(false);

    const subLocalResult = await validateSafeUrl('http://app.localhost/admin');
    expect(subLocalResult.safe).toBe(false);

    const metaResult = await validateSafeUrl('http://169.254.169.254/latest/meta-data/');
    expect(metaResult.safe).toBe(false);

    const loopbackResult = await validateSafeUrl('http://127.0.0.1:8080');
    expect(loopbackResult.safe).toBe(false);
  });

  it('permits valid public HTTP/HTTPS URLs', async () => {
    const validResult = await validateSafeUrl('https://example.com');
    expect(validResult.safe).toBe(true);
    expect(validResult.url?.hostname).toBe('example.com');
  });
});
