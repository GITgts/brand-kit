import { Agent, request } from 'undici';
import { BlockedAddressError, createGuardedLookup } from './address-guard';

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: string;
  allowPrivateNetwork?: boolean;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}

const agents = new Map<boolean, Agent>();
function agentFor(allowPrivate: boolean): Agent {
  let agent = agents.get(allowPrivate);
  if (!agent) {
    agent = new Agent({
      connect: { lookup: createGuardedLookup(allowPrivate) as any, timeout: 5_000 },
      headersTimeout: 8_000,
      bodyTimeout: 8_000,
    });
    agents.set(allowPrivate, agent);
  }
  return agent;
}

export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/**
 * Fetches a public http(s) resource with SSRF protection at socket level,
 * manual redirect handling (every hop is re-validated), a hard byte cap and
 * an overall timeout. Throws on failure; callers treat assets as optional.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const {
    timeoutMs = 10_000,
    maxBytes = 5 * 1024 * 1024,
    maxRedirects = 4,
    accept = '*/*',
    allowPrivateNetwork = false,
  } = opts;

  const signal = AbortSignal.timeout(timeoutMs);
  let url = new URL(rawUrl);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`Unsupported protocol ${url.protocol}`);
    if (url.username || url.password) throw new Error('Credentials in URL are not allowed');

    const res = await request(url, {
      method: 'GET',
      dispatcher: agentFor(allowPrivateNetwork),
      headers: { 'user-agent': BROWSER_UA, accept, 'accept-language': 'nl-BE,nl;q=0.9,en;q=0.8' },
      signal,
    });

    if (res.statusCode >= 300 && res.statusCode < 400) {
      const location = res.headers.location;
      await res.body.dump();
      if (!location || Array.isArray(location)) throw new Error(`Redirect without location from ${url}`);
      url = new URL(location, url);
      continue;
    }

    const declared = Number(res.headers['content-length'] ?? 0);
    if (declared > maxBytes) {
      await res.body.dump();
      throw new Error(`Response too large (${declared} bytes)`);
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > maxBytes) {
        res.body.destroy();
        throw new Error(`Response exceeded ${maxBytes} bytes`);
      }
      chunks.push(chunk as Buffer);
    }

    const ct = res.headers['content-type'];
    return {
      url: url.toString(),
      status: res.statusCode,
      contentType: (Array.isArray(ct) ? ct[0] : ct ?? '').split(';')[0].trim().toLowerCase(),
      body: Buffer.concat(chunks),
    };
  }
  throw new Error(`Too many redirects for ${rawUrl}`);
}

export { BlockedAddressError };
