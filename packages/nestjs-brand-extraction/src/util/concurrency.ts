export class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    // A released slot is handed directly to the next waiter, so `active` never overshoots.
    if (this.active >= this.max) await new Promise<void>((resolve) => this.queue.push(resolve));
    else this.active++;
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Collapses concurrent calls for the same key into one in-flight promise. */
export class InFlight<V> {
  private readonly pending = new Map<string, Promise<V>>();

  run(key: string, fn: () => Promise<V>): Promise<V> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const p = fn().finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }
}
