import { lookup as dnsLookup, LookupAddress } from 'node:dns';
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

/**
 * SSRF protection. Customer URLs are user input and we render them server-side,
 * so every hostname must resolve exclusively to public addresses — otherwise a
 * "website" of http://169.254.169.254/ would read cloud metadata, and
 * http://localhost:3000/admin would hit our own services.
 */

export class BlockedAddressError extends Error {
  constructor(host: string, address?: string) {
    super(`Blocked non-public address for ${host}${address ? ` (${address})` : ''}`);
    this.name = 'BlockedAddressError';
  }
}

export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPublicV4(ip);
  if (family === 6) return isPublicV6(ip);
  return false;
}

function isPublicV4(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return false; // this-network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF assignments, TEST-NET-1
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast + reserved + broadcast
  return true;
}

function isPublicV6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === '::' || s === '::1') return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return isPublicV4(mapped[1]);
  if (/^f[cd]/.test(s)) return false; // unique local fc00::/7
  if (/^fe[89ab]/.test(s)) return false; // link-local fe80::/10
  if (/^ff/.test(s)) return false; // multicast
  if (s.startsWith('64:ff9b:')) return false; // NAT64 can reach IPv4 internals
  if (s.startsWith('2001:db8')) return false; // documentation
  return true;
}

/** Resolves a host and throws unless every address is public. */
export async function assertPublicHost(host: string, allowPrivate = false): Promise<void> {
  if (allowPrivate) return;
  const h = host.replace(/^\[|\]$/g, '');
  if (isIP(h)) {
    if (!isPublicAddress(h)) throw new BlockedAddressError(host, h);
    return;
  }
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    throw new BlockedAddressError(host);
  }
  const addrs = await dns.lookup(h, { all: true, verbatim: true });
  if (addrs.length === 0) throw new BlockedAddressError(host);
  for (const { address } of addrs) {
    if (!isPublicAddress(address)) throw new BlockedAddressError(host, address);
  }
}

/**
 * A `dns.lookup`-compatible function that rejects private results. Used as the
 * socket-level lookup for our HTTP client so the check happens at connect time,
 * which closes the DNS-rebinding gap between "check" and "connect".
 */
export function createGuardedLookup(allowPrivate = false) {
  return (hostname: string, options: any, callback: (...args: any[]) => void) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
      if (err) return callback(err);
      const bad = addresses.find((a) => !allowPrivate && !isPublicAddress(a.address));
      if (bad) return callback(new BlockedAddressError(hostname, bad.address));
      if (options?.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}
