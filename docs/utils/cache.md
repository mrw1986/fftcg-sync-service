# Cache System

## Overview

The Cache System provides efficient memory caching for card data, prices, and images. It implements an LRU (Least Recently Used) caching strategy and includes specialized caching for different data types.

## Components

The system consists of two main cache implementations:

1. Basic LRU Cache (`cache.ts`)
2. Specialized Image Cache (`imageCache.ts`)

## Basic Cache Implementation

### Configuration

```typescript
const options = {
  max: 500,                // Maximum number of items
  ttl: 1000 * 60 * 60,    // Time to live: 1 hour
};

export const cardCache = new LRUCache<string, CardProduct>(options);
```

### Basic Key Generation

```typescript
export type CacheType = "card" | "price" | "image";

export const getCacheKey = (type: CacheType, id: number): string => {
  return `${type}:${id}`;
};
```

## Image Cache Implementation

### Class Structure

```typescript
export class ImageCache {
  private metadataCache: LRUCache<string, ImageMetadata>;
  private bufferCache: LRUCache<string, Buffer>;
  private existsCache: LRUCache<string, boolean>;
  private stats: CacheStats;
}
```

### Cache Configuration

```typescript
constructor() {
  this.metadataCache = new LRUCache<string, ImageMetadata>({
    max: 1000,
    ttl: 1000 * 60 * 60,  // 1 hour
    updateAgeOnGet: true,
  });

  this.bufferCache = new LRUCache<string, Buffer>({
    max: 100,
    ttl: 1000 * 60 * 5,   // 5 minutes
    updateAgeOnGet: true,
    maxSize: 50 * 1024 * 1024,  // 50MB max cache size
    sizeCalculation: (buffer) => buffer.length,
  });

  this.existsCache = new LRUCache<string, boolean>({
    max: 1000,
    ttl: 1000 * 60 * 60,  // 1 hour
    updateAgeOnGet: true,
  });
}
```

## Usage Examples

### Basic Cache Usage

```typescript
// Store card data
const cardId = 477236;
const cacheKey = getCacheKey("card", cardId);
cardCache.set(cacheKey, cardData);

// Retrieve card data
const cachedCard = cardCache.get(cacheKey);
if (cachedCard) {
  return cachedCard;
}
```

### Image Cache Usage

```typescript
const imageCache = new ImageCache();

// Get metadata
const metadataKey = imageCache.getMetadataCacheKey(groupId, productId, false);
const metadata = await imageCache.getMetadata(metadataKey);

// Get image buffer
const bufferKey = imageCache.getBufferCacheKey(imageUrl);
const buffer = await imageCache.getBuffer(bufferKey);

// Check existence
const existsKey = imageCache.getExistsCacheKey(groupId, productId, false);
const exists = imageCache.getExists(existsKey);
```

## Image Cache Key Types

### Metadata Keys

```typescript
getMetadataCacheKey(
  groupId: string,
  productId: number,
  isHighRes: boolean
): string {
  return `metadata:${groupId}:${productId}:${isHighRes ? "high" : "original"}`;
}
```

### Buffer Keys

```typescript
getBufferCacheKey(url: string): string {
  return `buffer:${url}`;
}
```

### Existence Check Keys

```typescript
getExistsCacheKey(
  groupId: string,
  productId: number,
  isHighRes: boolean
): string {
  return `exists:${groupId}:${productId}:${isHighRes ? "high" : "original"}`;
}
```

## Statistics Tracking

```typescript
interface CacheStats {
  hits: number;
  misses: number;
  totalRequests: number;
}

getStats(): CacheStats {
  return {...this.stats};
}
```

## Cache Management

### Clearing Cache

```typescript
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
```

### Performance Monitoring

```typescript
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
```

## Best Practices

1. **Memory Management**:
   - Set appropriate cache sizes
   - Monitor memory usage
   - Implement TTL for all cached items

2. **Performance Optimization**:
   - Use buffer cache for frequently accessed images
   - Implement size limits for buffer cache
   - Track cache statistics

3. **Error Handling**:
   - Graceful degradation on cache misses
   - Monitor cache hit rates
   - Log cache operations

## Troubleshooting

### Common Issues

1. Memory Usage:
   - Monitor cache size
   - Adjust max entries
   - Check TTL settings

2. Cache Misses:
   - Verify key generation
   - Check TTL values
   - Monitor hit rates

3. Performance:
   - Analyze cache stats
   - Adjust cache sizes
   - Optimize key generation

## Related Components

- [Image Handler](./image-handler)
- [Logger](./logging)
- [Error Handling](./error-handling)
