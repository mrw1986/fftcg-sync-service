// src/utils/imageCache.ts

import LRUCache from "lru-cache";
import {ImageMetadata} from "../types";
import {logInfo} from "./logger";

interface CacheStats {
  hits: number;
  misses: number;
  totalRequests: number;
}

export class ImageCache {
  private metadataCache: LRUCache<string, ImageMetadata>;
  private bufferCache: LRUCache<string, Buffer>;
  private existsCache: LRUCache<string, boolean>;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    totalRequests: 0,
  };

  constructor() {
    this.metadataCache = new LRUCache<string, ImageMetadata>({
      max: 1000,
      ttl: 1000 * 60 * 60, // 1 hour
      updateAgeOnGet: true,
    });

    this.bufferCache = new LRUCache<string, Buffer>({
      max: 100,
      ttl: 1000 * 60 * 5, // 5 minutes
      updateAgeOnGet: true,
      maxSize: 50 * 1024 * 1024, // 50MB max cache size
      sizeCalculation: (buffer) => buffer.length,
    });

    this.existsCache = new LRUCache<string, boolean>({
      max: 1000,
      ttl: 1000 * 60 * 60, // 1 hour
      updateAgeOnGet: true,
    });
  }

  getMetadataCacheKey(
    groupId: string,
    productId: number,
    cardNumber: string,
    isHighRes: boolean
  ): string {
    return `metadata:${groupId}:${productId}:${cardNumber}:${
      isHighRes ? "high" : "original"
    }`;
  }

  getBufferCacheKey(url: string): string {
    return `buffer:${url}`;
  }

  getExistsCacheKey(
    groupId: string,
    productId: number,
    cardNumber: string,
    isHighRes: boolean
  ): string {
    return `exists:${groupId}:${productId}:${cardNumber}:${
      isHighRes ? "high" : "original"
    }`;
  }

  async getMetadata(key: string): Promise<ImageMetadata | undefined> {
    this.stats.totalRequests++;
    const value = this.metadataCache.get(key);
    if (value) {
      this.stats.hits++;
      await logInfo("Cache hit: metadata", {
        key,
        timestamp: new Date().toISOString(),
      });
    } else {
      this.stats.misses++;
    }
    return value;
  }

  async getBuffer(key: string): Promise<Buffer | undefined> {
    this.stats.totalRequests++;
    const value = this.bufferCache.get(key);
    if (value) {
      this.stats.hits++;
      await logInfo("Cache hit: buffer", {
        key,
        size: value.length,
        timestamp: new Date().toISOString(),
      });
    } else {
      this.stats.misses++;
    }
    return value;
  }

  getExists(key: string): boolean | undefined {
    this.stats.totalRequests++;
    const value = this.existsCache.get(key);
    if (value !== undefined) {
      this.stats.hits++;
    } else {
      this.stats.misses++;
    }
    return value;
  }

  setMetadata(key: string, value: ImageMetadata): void {
    this.metadataCache.set(key, value);
  }

  setBuffer(key: string, value: Buffer): void {
    this.bufferCache.set(key, value);
  }

  setExists(key: string, value: boolean): void {
    this.existsCache.set(key, value);
  }

  clear(): void {
    this.metadataCache.clear();
    this.bufferCache.clear();
    this.existsCache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      totalRequests: 0,
    };
  }

  getStats(): CacheStats {
    return {...this.stats};
  }
}

export const imageCache = new ImageCache();
