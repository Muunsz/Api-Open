import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as dns from 'node:dns/promises';
import * as net from 'node:net';

/**
 * Checks whether an IPv4 address falls into private, loopback, link-local,
 * or otherwise non-public ranges to prevent SSRF.
 */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // Multicast & reserved

  return false;
}

/**
 * Checks whether an IPv6 address is loopback, link-local, unique-local,
 * or an IPv4-mapped address pointing to a private IPv4 range.
 */
function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // fc00::/7
  if (normalized.startsWith('fe80:')) return true; // fe80::/10 link-local

  if (normalized.startsWith('::ffff:')) {
    const v4 = normalized.slice(7);
    if (net.isIPv4(v4)) {
      return isPrivateIpv4(v4);
    }
  }

  return false;
}

function isPrivateIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true;
}

/**
 * Validates that the target URL uses http/https and does not resolve to
 * internal/private network addresses unless ALLOW_LOCAL_PROXY=true.
 */
export async function validateTargetUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BadRequestException('Invalid target URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('Only http and https protocols are supported');
  }

  if (process.env.ALLOW_LOCAL_PROXY === 'true') {
    return parsed;
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new ForbiddenException('Requests to private or local IP addresses are blocked');
    }
    return parsed;
  }

  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new BadRequestException(`Could not resolve hostname: ${hostname}`);
  }

  if (!records.length || records.some((r) => isPrivateIp(r.address))) {
    throw new ForbiddenException('Target host resolves to a private or blocked IP address');
  }

  return parsed;
}
