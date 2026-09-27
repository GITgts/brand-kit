/** Tiny in-process LRU with TTL. Swap for Redis if you run multiple API replicas. */
export class TtlCache<V> {
  private readonly map = new Map<string, { value: V; expires: number }>();

  constructor(private readonly ttlMs: number, private readonly maxEntries = 200) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key); // refresh LRU position
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
    while (this.map.size > this.maxEntries) this.map.delete(this.map.keys().next().value as string);
  }
}
