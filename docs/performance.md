# Performance Guide

## Optimization Overview

This guide covers performance optimization strategies implemented in the FFTCG Sync Service, including caching, batch processing, memory management, and monitoring.

## Resource Management

### Memory Allocation

```typescript
// Default runtime options
const runtimeOpts = {
  timeoutSeconds: 540,
  memory: "1GiB"
} as const;
```

Memory optimization techniques:

- Batch processing to control memory usage
- Automatic garbage collection
- Resource cleanup after operations
- Stream processing for large datasets

### Resource Cleanup

```typescript
async function cleanupResources(): Promise<void> {
  // Clear image cache
  await imageCache.clear();
 
  // Force garbage collection if available
  global.gc && global.gc();
 
  // Clear other caches
  cardCache.clear();
}
```

## Caching Strategy

### Multi-Level Caching

```typescript
// L1 Cache (Memory)
private l1Cache = new Map<string, T>();

// L2 Cache (LRU)
private l2Cache: LRUCache<string, T> = new LRUCache<string, T>({
  max: options.maxSize,
  ttl: options.ttl
});
```

Cache hierarchy:

1. In-memory cache for frequent access
2. LRU cache for larger datasets
3. Persistent storage for backups

### Cache Configuration

```typescript
const cacheOptions = {
  // Card cache settings
  cardCache: {
    max: 500,
    ttl: 1000 * 60 * 60 // 1 hour
  },
 
  // Image cache settings
  imageCache: {
    metadata: {
      max: 1000,
      ttl: 1000 * 60 * 60 // 1 hour
    },
    buffer: {
      max: 100,
      ttl: 1000 * 60 * 5, // 5 minutes
      maxSize: 50 * 1024 * 1024 // 50MB
    }
  }
};
```

## Batch Processing

### Adaptive Batch Processing

```typescript
class AdaptiveBatchProcessor {
  private optimalBatchSize: number = 100;
  private processingTimes: number[] = [];

  async processBatch<T>(
    items: T[],
    processor: (batch: T[]) => Promise<void>
  ): Promise<void> {
    for (let i = 0; i < items.length; i += this.optimalBatchSize) {
      const start = Date.now();
      const batch = items.slice(i, i + this.optimalBatchSize);
     
      await processor(batch);
     
      this.adjustBatchSize(Date.now() - start);
    }
  }

  private adjustBatchSize(lastProcessingTime: number): void {
    // Dynamically adjust batch size based on processing time
    if (lastProcessingTime > 1000) {
      this.optimalBatchSize = Math.max(10, this.optimalBatchSize * 0.8);
    } else if (lastProcessingTime < 500) {
      this.optimalBatchSize = Math.min(1000, this.optimalBatchSize * 1.2);
    }
  }
}
```

### Batch Size Optimization

```typescript
const batchOptions = {
  batchSize: 100,
  delayBetweenBatches: 1000,
  onBatchComplete: async (stats) => {
    console.log(`Processed: ${stats.processed}/${stats.total}`);
  }
};
```

## Image Processing Optimization

### Compression Settings

```typescript
const compressionOptions = {
  quality: {
    HIGH_RES: 90,
    LOW_RES: 85
  },
  dimensions: {
    HIGH_RES: 400,
    LOW_RES: 200
  }
};
```

### Progressive Loading

```typescript
const imageProcessingOptions = {
  progressive: true,
  mozjpeg: true,
  optimizationLevel: 3
};
```

## Database Optimization

### Batch Operations

```typescript
async function batchWrite(updates: any[]): Promise<void> {
  const batch = db.batch();
  updates.forEach(update => {
    const ref = db.collection('cards').doc(update.id);
    batch.update(ref, update.data);
  });
  await batch.commit();
}
```

### Index Optimization

```json
{
  "indexes": [
    {
      "collectionGroup": "cards",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "groupId", "order": "ASCENDING" },
        { "fieldPath": "lastUpdated", "order": "DESCENDING" }
      ]
    }
  ]
}
```

## Rate Limiting

### Token Bucket Implementation

```typescript
const rateLimiter = {
  tokens: 100,
  refillRate: 10,
  interval: 1000,

  async acquire(): Promise<boolean> {
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    return false;
  }
};
```

### Request Throttling

```typescript
async function makeThrottledRequest<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  if (!await rateLimiter.acquire()) {
    throw new Error("Rate limit exceeded");
  }
  return makeRequest<T>(endpoint, options);
}
```

## Performance Monitoring

### Progress Tracking

```typescript
export class EnhancedProgressTracker {
  private calculateStats(): ProgressStats {
    const now = Date.now();
    const elapsed = (now - this.startTime) / 1000;
    const percent = (this.current / this.total) * 100;
    const rate = this.current / elapsed;
   
    return {
      current: this.current,
      total: this.total,
      percent,
      elapsed,
      rate,
      remaining: this.total - this.current,
      eta: (this.total - this.current) / rate
    };
  }
}
```

### Performance Metrics

```typescript
interface PerformanceMetrics {
  timestamp: Date;
  operation: string;
  duration: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
  };
  success: boolean;
}

async function trackPerformance(
  operation: string,
  task: () => Promise<void>
): Promise<void> {
  const start = Date.now();
  const startMemory = process.memoryUsage();
 
  try {
    await task();
    const endMemory = process.memoryUsage();
   
    await logInfo("Performance metrics", {
      operation,
      duration: Date.now() - start,
      memoryDelta: {
        heapUsed: endMemory.heapUsed - startMemory.heapUsed,
        heapTotal: endMemory.heapTotal - startMemory.heapTotal
      }
    });
  } catch (error) {
    await logError(error, "performanceTracking");
    throw error;
  }
}
```

## Best Practices

### Memory Management

1. Use streams for large file operations
2. Implement cleanup routines
3. Monitor memory usage
4. Set appropriate cache limits
5. Use batch processing

### Network Optimization

1. Implement request caching
2. Use compression
3. Batch API requests
4. Handle rate limits
5. Implement retry strategies

### Database Efficiency

1. Use batch operations
2. Optimize indexes
3. Implement caching
4. Monitor query performance
5. Use appropriate batch sizes

### Image Processing

1. Use progressive loading
2. Implement size limits
3. Optimize compression
4. Cache processed images
5. Use appropriate quality settings

## Monitoring and Alerts

### Key Metrics

```typescript
interface SystemMetrics {
  syncDuration: number;
  memoryUsage: number;
  processedItems: number;
  errorRate: number;
  cacheHitRate: number;
}

async function monitorSystem(): Promise<SystemMetrics> {
  return {
    syncDuration: calculateSyncDuration(),
    memoryUsage: process.memoryUsage().heapUsed,
    processedItems: getProcessedCount(),
    errorRate: calculateErrorRate(),
    cacheHitRate: calculateCacheHitRate()
  };
}
```

### Alert Thresholds

```typescript
const alertThresholds = {
  syncDuration: 1000 * 60 * 30, // 30 minutes
  memoryUsage: 900 * 1024 * 1024, // 900MB
  errorRate: 0.05, // 5%
  cacheHitRate: 0.7 // 70%
};
```
