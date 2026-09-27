import { computed, getCurrentScope, onScopeDispose, ref, shallowRef } from 'vue';
import {
  BrandClient,
  BrandClientError,
  BrandExtractionResult,
} from '@wisemen/brand-kit';

export type AnalysisStatus = 'idle' | 'analyzing' | 'ready' | 'failed';

/**
 * Progress hints while the (single) request runs. They follow the real
 * pipeline order and typical timings; they are hints, not server events.
 */
const PHASES = [
  { afterMs: 0, label: 'Website openen' },
  { afterMs: 4000, label: 'Logo zoeken in de sitekop' },
  { afterMs: 9000, label: 'Kleuren van knoppen en logo vergelijken' },
  { afterMs: 14000, label: 'Logo beoordelen op leesbaarheid' },
  { afterMs: 24000, label: 'Bijna klaar' },
];

export function useBrandExtraction(api: BrandClient) {
  const status = ref<AnalysisStatus>('idle');
  const result = shallowRef<BrandExtractionResult | null>(null);
  const error = shallowRef<BrandClientError | null>(null);
  const elapsedMs = ref(0);

  let controller: AbortController | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let runId = 0;

  const phaseLabel = computed(() => {
    let label = PHASES[0].label;
    for (const p of PHASES) if (elapsedMs.value >= p.afterMs) label = p.label;
    return label;
  });

  function stopTicker() {
    if (ticker) clearInterval(ticker);
    ticker = null;
  }

  async function analyze(website: string, companyName?: string, opts: { force?: boolean } = {}) {
    controller?.abort();
    controller = new AbortController();
    const id = ++runId;

    status.value = 'analyzing';
    error.value = null;
    elapsedMs.value = 0;
    const started = Date.now();
    stopTicker();
    ticker = setInterval(() => (elapsedMs.value = Date.now() - started), 250);

    try {
      const r = await api.extract({ website, companyName, force: opts.force }, controller.signal);
      if (id !== runId) return null;
      result.value = r;
      status.value = 'ready';
      return r;
    } catch (err) {
      if (id !== runId || (err as Error).name === 'AbortError') return null;
      error.value =
        err instanceof BrandClientError ? err : new BrandClientError('server', 'De analyse is mislukt.');
      status.value = 'failed';
      return null;
    } finally {
      if (id === runId) stopTicker();
    }
  }

  function cancel() {
    runId++;
    controller?.abort();
    stopTicker();
    if (status.value === 'analyzing') status.value = result.value ? 'ready' : 'idle';
  }

  if (getCurrentScope()) onScopeDispose(cancel);

  return { status, result, error, phaseLabel, elapsedMs, analyze, cancel };
}
