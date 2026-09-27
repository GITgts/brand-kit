import type {
  BrandErrorKind,
  BrandExtractionResult,
  ExtractRequest,
  MonogramRequest,
  MonogramResponse,
} from './contract';

export class BrandClientError extends Error {
  constructor(
    public readonly kind: BrandErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'BrandClientError';
  }
}

export interface BrandClient {
  extract(body: ExtractRequest, signal?: AbortSignal): Promise<BrandExtractionResult>;
  monogram(body: MonogramRequest, signal?: AbortSignal): Promise<MonogramResponse>;
}

export interface BrandClientOptions {
  /**
   * Where the brand endpoints live, without trailing slash.
   * - App backend → brand-service: `https://brand.example.internal/v1/brand`
   * - Browser → own app backend proxy: `/api/brand`
   */
  baseUrl: string;
  /** Extra headers per request (auth, tenant). Called for every request. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Custom fetch (tests, SSR, instrumented clients). */
  fetch?: typeof fetch;
  /** Client-side timeout; the service's own limit is ~45 s. */
  timeoutMs?: number;
}

/**
 * Isomorphic client (browser + Node 18+). The same code runs in the app
 * backend that calls brand-service and in the UI that calls the app backend.
 */
export function createBrandClient(options: BrandClientOptions): BrandClient {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 60_000;

  async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? anySignal([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await doFetch(`${options.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await options.headers?.()) },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (err) {
      if (signal?.aborted) throw err; // caller cancelled: let the AbortError through
      if (timeout.aborted) throw new BrandClientError('timeout', 'De analyse duurde te lang.');
      throw new BrandClientError('network', 'De merkservice is niet bereikbaar.');
    }
    if (res.ok) return (await res.json()) as T;

    const payload = (await res.json().catch(() => null)) as { message?: unknown } | null;
    const message = typeof payload?.message === 'string' ? payload.message : undefined;
    throw new BrandClientError(kindFor(res.status), message ?? defaultMessage(res.status), res.status);
  }

  return {
    extract: (body, signal) => post<BrandExtractionResult>('/extract', body, signal),
    monogram: (body, signal) => post<MonogramResponse>('/monogram', body, signal),
  };
}

function kindFor(status: number): BrandErrorKind {
  if (status === 400) return 'invalid-request';
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 422) return 'invalid-website';
  if (status === 429) return 'rate-limited';
  if (status === 504) return 'timeout';
  return 'server';
}

function defaultMessage(status: number): string {
  switch (kindFor(status)) {
    case 'invalid-website':
      return 'Dit is geen publiek bereikbare website.';
    case 'timeout':
      return 'De website reageerde te traag.';
    case 'rate-limited':
      return 'Te veel analyses kort na elkaar. Probeer het zo meteen opnieuw.';
    case 'unauthorized':
      return 'Geen toegang tot de merkservice.';
    case 'invalid-request':
      return 'Ongeldige aanvraag.';
    default:
      return 'De analyse is mislukt.';
  }
}

/** AbortSignal.any with a fallback for older runtimes. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (anyFn) return anyFn(signals);
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) return AbortSignal.abort(s.reason);
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}
