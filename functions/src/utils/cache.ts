// src/utils/cache.ts
export class Cache<T> {
  private cache = new Map<
    string,
    {
      data: T;
      timestamp: number;
    }
  >();
  private readonly ttl: number;
  private readonly maxSize: number;

  constructor(ttlMinutes = 15, maxSize = 5000) {
    this.ttl = ttlMinutes * 60 * 1000;
    this.maxSize = maxSize;
  }

  set(key: string, value: T): void {
    if (this.cache.size >= this.maxSize) {
      const entries = Array.from(this.cache.entries());
      const oldestEntries = entries
        .sort(([, a], [, b]) => a.timestamp - b.timestamp)
        .slice(0, Math.floor(this.maxSize * 0.1));

      oldestEntries.forEach(([key]) => this.cache.delete(key));
    }

    this.cache.set(key, {
      data: value,
      timestamp: Date.now(),
    });
  }

  setBulk(entries: Array<[string, T]>): void {
    entries.forEach(([key, value]) => this.set(key, value));
  }

  get(key: string): T | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  getBulk(keys: string[]): Map<string, T> {
    const results = new Map<string, T>();
    keys.forEach((key) => {
      const value = this.get(key);
      if (value !== null) {
        results.set(key, value);
      }
    });
    return results;
  }

  clear(): void {
    this.cache.clear();
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }
}
