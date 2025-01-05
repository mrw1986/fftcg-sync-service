// src/utils/cache.ts
import { logger } from "./logger";

export class Cache<T> {
  private cache = new Map<
    string,
    {
      data: T;
      timestamp: number;
      lastAccessed: number;
    }
  >();
  private readonly ttl: number;
  private readonly maxSize: number;
  private readonly statistics = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(ttlMinutes = 15, maxSize = 5000) {
    this.ttl = ttlMinutes * 60 * 1000;
    this.maxSize = maxSize;
    this.startPeriodicCleanup();
  }

  private startPeriodicCleanup(): void {
    setInterval(() => {
      this.evictExpired();
      this.logStatistics();
    }, Math.min(this.ttl / 2, 5 * 60 * 1000)); // Run every 5 minutes or half TTL, whichever is shorter
  }

  private evictExpired(): void {
    const now = Date.now();
    let evicted = 0;

    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.ttl) {
        this.cache.delete(key);
        evicted++;
        this.statistics.evictions++;
      }
    }

    if (evicted > 0) {
      logger.info(`Cache cleanup: evicted ${evicted} expired items`);
    }
  }

  private evictLRU(): void {
    const entries = Array.from(this.cache.entries());
    const toEvict = entries
      .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed)
      .slice(0, Math.floor(this.maxSize * 0.2)); // Evict 20% of oldest entries

    toEvict.forEach(([key]) => {
      this.cache.delete(key);
      this.statistics.evictions++;
    });

    logger.info(`Cache LRU eviction: removed ${toEvict.length} items`);
  }

  set(key: string, value: T): void {
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    this.cache.set(key, {
      data: value,
      timestamp: Date.now(),
      lastAccessed: Date.now(),
    });
  }

  setBulk(entries: Array<[string, T]>): void {
    entries.forEach(([key, value]) => this.set(key, value));
  }

  get(key: string): T | null {
    const cached = this.cache.get(key);
    if (!cached) {
      this.statistics.misses++;
      return null;
    }

    if (Date.now() - cached.timestamp > this.ttl) {
      this.cache.delete(key);
      this.statistics.evictions++;
      this.statistics.misses++;
      return null;
    }

    cached.lastAccessed = Date.now();
    this.statistics.hits++;
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
    this.resetStatistics();
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  private resetStatistics(): void {
    this.statistics.hits = 0;
    this.statistics.misses = 0;
    this.statistics.evictions = 0;
  }

  private logStatistics(): void {
    const total = this.statistics.hits + this.statistics.misses;
    const hitRate = total > 0 ? (this.statistics.hits / total) * 100 : 0;

    logger.info("Cache statistics", {
      size: this.cache.size,
      hits: this.statistics.hits,
      misses: this.statistics.misses,
      evictions: this.statistics.evictions,
      hitRate: `${hitRate.toFixed(2)}%`,
    });
  }

  getStatistics() {
    return { ...this.statistics };
  }
}
