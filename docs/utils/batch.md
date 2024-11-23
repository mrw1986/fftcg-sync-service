# Batch Processing Utility

## Overview

The Batch Processor (`batch.ts`) manages efficient processing of large data sets through controlled batching. It provides configurable batch sizes, concurrent processing, and progress tracking for synchronization operations.

## Core Features

- Configurable batch sizes
- Concurrent processing
- Progress tracking
- Error handling
- Memory management
- Rate limiting

## Main Interfaces

### Batch Options

```typescript
interface BatchOptions {
  batchSize?: number;
  concurrency?: number;
  retries?: number;
  backoff?: number;
  onProgress?: (progress: BatchProgress) => void;
  abortSignal?: AbortSignal;
}
```

### Progress Interface

```typescript
interface BatchProgress {
  total: number;
  processed: number;
  failed: number;
  currentBatch: number;
  totalBatches: number;
  percentage: number;
  estimatedTimeRemaining?: number;
}
```

## Core Methods

### Batch Processing

```typescript
export async function processBatch<T>(
  items: T[],
  processor: (batch: T[]) => Promise<void>,
  options: BatchOptions = {}
): Promise<BatchResult> {
  const {
    batchSize = 100,
    concurrency = 1,
    retries = 3,
    onProgress
  } = options;

  const batches = chunk(items, batchSize);
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < batches.length; i++) {
    try {
      await processor(batches[i]);
      processed += batches[i].length;
    } catch (error) {
      failed += batches[i].length;
      await handleBatchError(error, retries);
    }

    if (onProgress) {
      onProgress({
        total: items.length,
        processed,
        failed,
        currentBatch: i + 1,
        totalBatches: batches.length,
        percentage: (processed + failed) / items.length * 100
      });
    }
  }

  return { processed, failed };
}
```

## Implementation Examples

### Basic Usage

```typescript
const items = await fetchItems();
const result = await processBatch(
  items,
  async (batch) => {
    await processItems(batch);
  },
  {
    batchSize: 50,
    onProgress: (progress) => {
      console.log(
        `Processed ${progress.processed}/${progress.total} items`
      );
    }
  }
);
```

### With Concurrency

```typescript
const processConcurrentBatches = async <T>(
  items: T[],
  processor: (item: T) => Promise<void>
): Promise<void> => {
  await processBatch(items, async (batch) => {
    await Promise.all(
      batch.map(item => processor(item))
    );
  }, {
    batchSize: 25,
    concurrency: 3
  });
};
```

## Error Management

### Retry Logic

```typescript
async function handleBatchError(
  error: unknown,
  retriesLeft: number,
  backoff: number = 1000
): Promise<void> {
  if (retriesLeft <= 0) {
    throw error;
  }

  await new Promise(resolve => 
    setTimeout(resolve, backoff * (4 - retriesLeft))
  );
 
  return handleBatchError(
    error,
    retriesLeft - 1,
    backoff
  );
}
```

### Error Collection

```typescript
interface BatchError {
  batchIndex: number;
  items: unknown[];
  error: Error;
}

const collectErrors = async <T>(
  items: T[],
  processor: (batch: T[]) => Promise<void>
): Promise<BatchError[]> => {
  const errors: BatchError[] = [];
 
  await processBatch(items, async (batch, index) => {
    try {
      await processor(batch);
    } catch (error) {
      errors.push({
        batchIndex: index,
        items: batch,
        error: error instanceof Error ? error : new Error(String(error))
      });
    }
  });

  return errors;
};
```

## Memory Management

### Chunking Function

```typescript
function chunk<T>(
  items: T[], 
  size: number
): T[][] {
  const chunks: T[][] = [];
 
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
 
  return chunks;
}
```

### Resource Cleanup

```typescript
async function processWithCleanup<T>(
  items: T[],
  processor: (batch: T[]) => Promise<void>
): Promise<void> {
  let currentBatch: T[] = [];
 
  try {
    await processBatch(items, async (batch) => {
      currentBatch = batch;
      await processor(batch);
      currentBatch = [];
    });
  } finally {
    currentBatch = [];
  }
}
```

## Progress Tracking

### Progress Calculator

```typescript
function calculateProgress(
  processed: number,
  total: number,
  startTime: number
): BatchProgress {
  const elapsed = Date.now() - startTime;
  const rate = processed / (elapsed / 1000);
  const remaining = total - processed;
 
  return {
    processed,
    total,
    percentage: (processed / total) * 100,
    estimatedTimeRemaining: remaining / rate
  };
}
```

## Best Practices

### Batch Size Selection

- Consider memory constraints
- Balance throughput and overhead
- Monitor processing times

### Error Handling

- Implement proper retries
- Log batch failures
- Maintain item context

### Resource Management

- Clean up after processing
- Monitor memory usage
- Handle aborted operations

## Related Components

- [Progress Tracker](./progress)
- [Error Handler](./error-handling)
- [Logger](./logging)

## Troubleshooting

### Common Issues

1. Memory Problems:
   - Reduce batch size
   - Implement cleanup
   - Monitor heap usage

2. Performance Issues:
   - Adjust concurrency
   - Optimize batch size
   - Monitor processing rates

3. Error Handling:
   - Check retry logic
   - Verify error collection
   - Monitor failure patterns
