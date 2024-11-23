# FFTCG Sync Service Usage Guide

## Overview

This guide provides comprehensive instructions for using the FFTCG Sync Service, including setup, operations, and best practices.

## Quick Start

### Prerequisites

- Node.js 18 or higher
- Firebase CLI installed (`npm install -g firebase-tools`)
- Firebase project created
- Service account key configured

### Initial Setup

1. Clone the repository

```bash
git clone https://github.com/yourusername/fftcg-sync-service.git
cd fftcg-sync-service
```

1. Install dependencies

```bash
npm install
```

1. Initialize Firebase

```bash
firebase login
firebase init
```

## API Reference

### Card Management Endpoints

#### Test Card Sync

```http
GET /testCardSync?limit=5&dryRun=true&groupId=23783
```

#### Manual Card Sync

```http
GET /manualCardSync
```

### Price Management Endpoints

#### Test Price Sync

```http
GET /testPriceSync?limit=5&dryRun=true&groupId=23783
```

#### Manual Price Sync

```http
GET /manualPriceSync
```

## Synchronization Features

### Card Data Synchronization

```typescript
// Test sync with limited cards
const options = {
  dryRun: true,
  limit: 5,
  groupId: "23783" // Optional: specific group
};

await syncCards(options);
```

### Price Data Synchronization

```typescript
// Test price sync for specific cards
const options = {
  dryRun: true,
  limit: 10,
  groupId: "23783",
  productId: 477236 // Optional: specific card
};

await syncPrices(options);
```

## Image Management

### Basic Image Processing

```typescript
const imageHandler = new ImageHandler();

const result = await imageHandler.processImage(
  imageUrl,
  groupId,
  productId
);
```

### Image Processing Options

```typescript
const options = {
  skipImages: false,    // Skip image processing
  retryFailedImages: true,    // Retry failed images
  batchSize: 25        // Batch size for processing
};
```

## Batch Operations

### Standard Batch Processing

```typescript
const batchOptions = {
  batchSize: 100,
  delayBetweenBatches: 1000,
  onBatchComplete: async (stats) => {
    console.log(`Processed: ${stats.processed}/${stats.total}`);
  }
};

await processBatch(items, processor, batchOptions);
```

## Logging System

### Core Logging Operations

```typescript
// Info logging
await logInfo("Operation started", {
  context: "syncOperation",
  timestamp: new Date()
});

// Warning logging
await logWarning("Retry required", {
  attempt: 2,
  maxRetries: 3
});

// Error logging
await logError(error, "operationName");
```

### Sync Status Logging

```typescript
const logger = new SyncLogger({
  type: "manual",
  limit: 10,
  dryRun: true
});

await logger.start();
await logger.logGroupDetails(groupId, products.length, prices.length);
await logger.finish();
```

## Testing Infrastructure

### Image System Testing

```typescript
// Run the image processing test suite
npm run test:images

// Test specific image handling
const testCase = {
  imageUrl: "https://example.com/card.jpg",
  groupId: "23783",
  productId: 477236
};

await testImageProcessing(testCase);
```

### Sync System Testing

```bash
# Basic validation
npm run validate-sync

# Advanced validation with options
npm run validate-sync -- --limit 10 --verbose --groupId 23783
```

## System Observation

### Health Monitoring

```typescript
// Endpoint: GET /healthCheck
const healthResponse = {
  status: "healthy",
  timestamp: "2024-11-22T01:47:16.617Z",
  version: "1.0.0"
};
```

### Runtime Monitoring

```typescript
// Monitor sync operations
const syncStats = {
  processedItems: 0,
  totalItems: 100,
  startTime: Date.now(),
  errors: []
};

// Update monitoring stats
function updateStats(processed: number): void {
  syncStats.processedItems = processed;
  const elapsed = Date.now() - syncStats.startTime;
  const rate = processed / (elapsed / 1000);
  console.log(`Processing rate: ${rate.toFixed(2)} items/second`);
}
```

## Operational Procedures

### Sync Process Workflow

1. Initialize sync operation

```typescript
const syncOptions = {
  dryRun: false,
  limit: undefined,
  groupId: undefined
};
```

1. Fetch and validate data

```typescript
const rawData = await fetchData();
const validatedData = await validateData(rawData);
```

1. Process updates

```typescript
await processBatch(validatedData, async (batch) => {
  await updateDatabase(batch);
});
```

1. Handle image processing

```typescript
await processImages(validatedData, {
  compression: true,
  validateMetadata: true
});
```

1. Update cache system

```typescript
await updateCacheEntries(processedData);
```

### Image Pipeline Workflow

#### Image Acquisition and Validation

```typescript
const imageHandler = new ImageHandler();
const validator = new ImageValidator();

const buffer = await imageHandler.downloadImage(url);
const validationResult = await validator.validateImage(buffer);
```

#### Image Processing and Storage

```typescript
const compressor = new ImageCompressor();
const result = await compressor.compress(buffer, {
  quality: 85,
  maxWidth: 800
});

await storageService.uploadImage(result.buffer, {
  metadata: result.info
});
```

## System Optimization

### Database Performance

```typescript
// Use batch operations for multiple updates
const batch = db.batch();
updates.forEach(update => {
  const ref = db.collection('cards').doc(update.id);
  batch.update(ref, update.data);
});
await batch.commit();
```

### Resource Management

```typescript
// Implement cleanup for large operations
async function cleanupResources(): Promise<void> {
  await imageCache.clear();
  global.gc && global.gc();
}
```

### Request Rate Management

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

## Security Controls

### Input Validation

```typescript
// Implement strict type checking
function validateSyncOptions(options: unknown): asserts options is SyncOptions {
  if (!options || typeof options !== "object") {
    throw new Error("Invalid options object");
  }

  const opts = options as Record<string, unknown>;
 
  if (opts.limit && typeof opts.limit !== "number") {
    throw new Error("Limit must be a number");
  }

  if (opts.groupId && typeof opts.groupId !== "string") {
    throw new Error("GroupId must be a string");
  }
}
```

### Authentication

```typescript
// Verify Firebase authentication
async function verifyAuth(req: Request): Promise<void> {
  const token = req.headers.authorization?.split("Bearer ")[1];
  if (!token) {
    throw new Error("No authentication token provided");
  }

  try {
    await admin.auth().verifyIdToken(token);
  } catch (error) {
    throw new Error("Invalid authentication token");
  }
}
```

## Advanced Patterns

### Custom Synchronization

```typescript
// Implement custom sync logic
async function customSync<T extends BaseEntity>(
  fetcher: DataFetcher<T>,
  processor: DataProcessor<T>,
  options: SyncOptions
): Promise<SyncMetadata> {
  const logger = new SyncLogger({
    type: "custom",
    ...options
  });

  await logger.start();
 
  try {
    const data = await fetcher.fetch();
    const processed = await processor.process(data);
    return {
      status: "success",
      processed: processed.length,
      timestamp: new Date()
    };
  } catch (error) {
    await logger.logError(error);
    throw error;
  } finally {
    await logger.finish();
  }
}
```

### Advanced Caching

```typescript
// Implement hierarchical caching
class HierarchicalCache<T> {
  private l1Cache = new Map<string, T>();
  private l2Cache: LRUCache<string, T>;

  constructor(options: CacheOptions) {
    this.l2Cache = new LRUCache<string, T>({
      max: options.maxSize,
      ttl: options.ttl
    });
  }

  async get(key: string): Promise<T | undefined> {
    // Check L1 cache first
    const l1Result = this.l1Cache.get(key);
    if (l1Result) return l1Result;

    // Check L2 cache
    const l2Result = this.l2Cache.get(key);
    if (l2Result) {
      this.l1Cache.set(key, l2Result);
      return l2Result;
    }

    return undefined;
  }
}
```

### Advanced Batch Processing

```typescript
// Implement adaptive batch sizing
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
     
      const duration = Date.now() - start;
      this.adjustBatchSize(duration);
    }
  }

  private adjustBatchSize(lastProcessingTime: number): void {
    this.processingTimes.push(lastProcessingTime);
    if (this.processingTimes.length >= 5) {
      const avgTime = this.calculateAverage(this.processingTimes);
      if (avgTime > 1000) {
        this.optimalBatchSize = Math.max(10, this.optimalBatchSize * 0.8);
      } else if (avgTime < 500) {
        this.optimalBatchSize = Math.min(1000, this.optimalBatchSize * 1.2);
      }
      this.processingTimes = [];
    }
  }
}
```

### Recovery Strategies

```typescript
// Implement progressive retry with backoff
class RetryStrategy {
  private static readonly MAX_RETRIES = 3;
  private static readonly BASE_DELAY = 1000;

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    let lastError: Error;
   
    for (let attempt = 0; attempt < RetryStrategy.MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const delay = Math.pow(2, attempt) * RetryStrategy.BASE_DELAY;
       
        await logWarning(
          `Operation failed, attempting retry ${attempt + 1}/${RetryStrategy.MAX_RETRIES}`,
          { context, error: lastError.message }
        );
       
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
   
    throw lastError!;
  }
}
```

## Reference Materials

### CLI Commands

```bash
# Build the project
npm run build

# Run linting
npm run lint

# Fix linting issues
npm run lint:fix

# Run tests
npm run test:images

# Deploy functions
npm run deploy
```

### Documentation Links

- [Architecture Overview](./architecture.md)
- [API Documentation](./api/index.md)
- [Troubleshooting Guide](./troubleshooting.md)
- [Security Guidelines](./security.md)
- [Performance Guide](./performance.md)
