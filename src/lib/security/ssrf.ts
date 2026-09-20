import net from 'net';
import dns from 'dns/promises';

export interface UrlValidationResult {
  safe: boolean;
  reason?: string;
  url?: URL;
}

export class SsrfSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfSecurityError';
  }
}

export function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true;
  }

  const [o1, o2, o3] = parts;

  if (o1 === 0) return true;
  if (o1 === 10) return true;
  if (o1 === 127) return true;
  if (o1 === 169 && o2 === 254) return true;
  if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;
  if (o1 === 192 && o2 === 168) return true;
  if (o1 === 100 && o2 >= 64 && o2 <= 127) return true;
  if (o1 === 192 && o2 === 0 && o3 === 0) return true;
  if (o1 === 192 && o2 === 0 && o3 === 2) return true;
  if (o1 === 198 && o2 === 51 && o3 === 100) return true;
  if (o1 === 203 && o2 === 0 && o3 === 113) return true;
  if (o1 >= 224) return true;

  return false;
}

export function isPrivateOrReservedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;

  if (lower.startsWith('::ffff:')) {
    const mappedIpv4 = lower.replace('::ffff:', '');
    if (net.isIPv4(mappedIpv4)) {
      return isPrivateOrReservedIpv4(mappedIpv4);
    }
  }

  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true;
  }

  if (lower.startsWith('fc') || lower.startsWith('fd')) {
    return true;
  }

  if (lower.startsWith('ff')) {
    return true;
  }

  return false;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    return isPrivateOrReservedIpv4(ip);
  }
  if (net.isIPv6(ip)) {
    return isPrivateOrReservedIpv6(ip);
  }
  return true;
}

export async function validateSafeUrl(urlString: string): Promise<UrlValidationResult> {
  if (!urlString || typeof urlString !== 'string') {
    return { safe: false, reason: 'Empty or invalid URL input.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(urlString.trim());
  } catch {
    return { safe: false, reason: 'Malformed URL structure.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: `Disallowed protocol: ${parsed.protocol}. Only http: and https: are permitted.` };
  }

  const hostname = parsed.hostname.toLowerCase().trim();

  if (!hostname) {
    return { safe: false, reason: 'URL hostname cannot be empty.' };
  }

  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname === 'metadata.google.internal'
  ) {
    return { safe: false, reason: `Restricted hostname: ${hostname}.` };
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      return { safe: false, reason: `Private or reserved IP address blocked: ${hostname}.` };
    }
    return { safe: true, url: parsed };
  }

  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records || records.length === 0) {
      return { safe: false, reason: `Could not resolve DNS records for hostname: ${hostname}.` };
    }

    for (const record of records) {
      if (isPrivateOrReservedIp(record.address)) {
        return {
          safe: false,
          reason: `Hostname ${hostname} resolves to restricted IP: ${record.address}.`,
        };
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'DNS lookup failed';
    return { safe: false, reason: `DNS lookup failed for ${hostname}: ${message}` };
  }

  return { safe: true, url: parsed };
}

export async function safeFetch(
  input: string | URL,
  init?: RequestInit,
  maxRedirects = 3
): Promise<Response> {
  const currentUrlString = typeof input === 'string' ? input : input.toString();
  const validation = await validateSafeUrl(currentUrlString);

  if (!validation.safe || !validation.url) {
    throw new SsrfSecurityError(`SSRF Protection Block: ${validation.reason}`);
  }

  const response = await fetch(validation.url.toString(), {
    ...init,
    redirect: 'manual',
  });

  const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
  if (isRedirect) {
    const location = response.headers.get('location');
    if (!location) {
      return response;
    }

    if (maxRedirects <= 0) {
      throw new SsrfSecurityError('SSRF Protection Block: Too many redirects.');
    }

    const nextUrl = new URL(location, validation.url);
    return safeFetch(nextUrl.toString(), init, maxRedirects - 1);
  }

  return response;
}
