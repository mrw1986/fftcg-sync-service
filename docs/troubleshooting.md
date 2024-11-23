# Troubleshooting Guide

## Quick Diagnosis

### System Status Check

```bash
# Check service health
curl https://${REGION}-${PROJECT_ID}.cloudfunctions.net/healthCheck

# Expected Response
{
  "status": "healthy",
  "timestamp": "2024-11-22T01:47:16.617Z",
  "version": "1.0.0"
}
```

### Log Analysis

```typescript
// View recent logs
firebase functions:log

// Filter for errors
firebase functions:log --only errors

// View specific function logs
firebase functions:log --only syncCards
```

## Common Issues

### Synchronization Failures

#### Cards Not Syncing

**Symptoms:**

- Missing card data
- Outdated information
- Sync operation completes without updates

**Solutions:**

1. Check API access:

```typescript
// Test API connection
const response = await makeRequest<{ results: any[] }>(
  `${FFTCG_CATEGORY_ID}/groups`,
  {metadata: {operation: "fetchGroups"}}
);
```

1. Verify hash comparison:

```typescript
// Force sync by clearing hashes
await db.collection(COLLECTION.CARD_HASHES).doc(groupId).delete();
```

1. Check rate limits:

```typescript
// Monitor rate limit logs
await logInfo("Rate limit status", {
  remaining: rateLimiter.tokens,
  nextRefill: rateLimiter.nextRefillTime
});
```

#### Price Updates Failed

**Symptoms:**

- Outdated prices
- Partial updates
- Sync metadata shows errors

**Solutions:**

1. Validate price data:

```typescript
const priceResult = await validateCollection(
  db,
  COLLECTION.PRICES,
  (data) => {
    return (
      data.lastUpdated instanceof Timestamp &&
      (!data.normal || typeof data.normal.midPrice === "number") &&
      (!data.foil || typeof data.foil.midPrice === "number")
    );
  }
);
```

1. Force price sync:

```typescript
await syncPrices({
  dryRun: false,
  groupId: specificGroupId,
  forceUpdate: true
});
```

### Image Processing Issues

#### Image Upload Failures

**Symptoms:**

- Missing images in storage
- Failed compression attempts
- Storage quota errors

**Solutions:**

1. Check image validation:

```typescript
const validationResult = await ImageValidator.validateImage(buffer);
if (validationResult) {
  console.error("Validation failed:", validationResult.message);
}
```

1. Verify storage permissions:

```typescript
try {
  await storage.bucket(STORAGE.BUCKETS.CARD_IMAGES).file(path).save(buffer);
} catch (error) {
  console.error("Storage access error:", error);
}
```

1. Monitor storage quota:

```typescript
const [usage] = await storage.bucket().getMetadata();
console.log("Storage usage:", usage.size);
```

#### Image Compression Problems

**Symptoms:**

- Large file sizes
- Poor image quality
- Processing timeouts

**Solutions:**

1. Adjust compression settings:

```typescript
const compressionOptions = {
  quality: ImageCompressor.QUALITY.HIGH_RES,
  progressive: true,
  mozjpeg: true
};
```

1. Debug compression process:

```typescript
const result = await ImageCompressor.compress(buffer, false);
console.log("Compression results:", {
  originalSize: buffer.length,
  compressedSize: result.buffer.length,
  ratio: result.buffer.length / buffer.length
});
```

### Database Issues

#### Write Operations Failed

**Symptoms:**

- Timeout errors
- Batch operation failures
- Inconsistent data state

**Solutions:**

1. Check batch size:

```typescript
// Reduce batch size
const batchOptions = {
  batchSize: 100,  // Decrease from default 500
  delayBetweenBatches: 1000
};
```

1. Monitor write operations:

```typescript
const stats = {
  attempted: 0,
  successful: 0,
  failed: 0
};

await processBatch(items, async (batch) => {
  try {
    await writeBatch.commit();
    stats.successful += batch.length;
  } catch (error) {
    stats.failed += batch.length;
    await logError(error, "writeBatch");
  }
  stats.attempted += batch.length;
});
```

#### Cache Inconsistency

**Symptoms:**

- Stale data
- Memory usage spikes
- Inconsistent results

**Solutions:**

1. Clear caches:

```typescript
// Clear specific cache
imageCache.clear();
cardCache.clear();

// Clear all caches
await Promise.all([
  imageCache.clear(),
  cardCache.clear(),
  db.clearPersistence()
]);
```

1. Verify cache settings:

```typescript
const cacheOptions = {
  max: 500,
  ttl: 1000 * 60 * 60, // 1 hour
  updateAgeOnGet: true
};
```

### Performance Issues

#### High Memory Usage

**Symptoms:**

- Function timeouts
- Out of memory errors
- Slow processing

**Solutions:**

1. Monitor memory usage:

```typescript
const used = process.memoryUsage();
await logInfo("Memory usage", {
  heapUsed: `${Math.round(used.heapUsed / 1024 / 1024 * 100) / 100} MB`,
  heapTotal: `${Math.round(used.heapTotal / 1024 / 1024 * 100) / 100} MB`,
});
```

1. Implement cleanup:

```typescript
async function cleanupResources(): Promise<void> {
  await imageCache.clear();
  global.gc && global.gc();
}
```

#### Slow Synchronization

**Symptoms:**

- Long sync duration
- Timeout errors
- Queue buildup

**Solutions:**

1. Enable progress tracking:

```typescript
const progress = new EnhancedProgressTracker(
  totalItems,
  "Processing Cards",
  { updateInterval: 1000 }
);

// Monitor progress
progress.update(1);
const stats = progress.getProgress();
```

1. Optimize batch processing:

```typescript
const optimizedBatch = new AdaptiveBatchProcessor();
await optimizedBatch.processBatch(items, processor);
```

### Network Issues

#### API Connection Failures

**Symptoms:**

- Request timeouts
- Connection refused
- DNS resolution failed

**Solutions:**

1. Implement retry logic:

```typescript
const requestWithRetry = async () => {
  const retryStrategy = new RetryStrategy();
  return retryStrategy.executeWithRetry(
    operation,
    "API_REQUEST"
  );
};
```

1. Check network status:

```typescript
async function checkConnectivity(): Promise<boolean> {
  try {
    await axios.get(BASE_URL, { timeout: 5000 });
    return true;
  } catch (error) {
    await logError(error, "connectivityCheck");
    return false;
  }
}
```

## Debugging Tools

### Logging and Diagnostics

```typescript
// Enable detailed logging
const logger = new SyncLogger({
  type: "manual",
  limit: 10,
  dryRun: true,
  verbose: true
});

// Track specific operations
await logger.logGroupDetails(groupId, products.length, prices.length);
```

### Validation Tools

```typescript
// Validate sync state
await validateSync({
  limit: 100,
  verbose: true,
  groupId: "test_group"
});

// Check data integrity
const integrityCheck = await validateCollection(db, COLLECTION.CARDS);
console.log("Integrity check results:", integrityCheck);
```

### Performance Monitoring

```typescript
// Track operation timing
const timer = {
  start: Date.now(),
  checkPoint(operation: string) {
    const duration = Date.now() - this.start;
    console.log(`${operation}: ${duration}ms`);
  }
};

// Monitor async operations
async function trackAsyncOperation<T>(
  operation: () => Promise<T>,
  name: string
): Promise<T> {
  const start = Date.now();
  try {
    const result = await operation();
    const duration = Date.now() - start;
    await logInfo(`${name} completed`, { duration });
    return result;
  } catch (error) {
    await logError(error, name);
    throw error;
  }
}
```

## Recovery Procedures

### Data Recovery

1. Backup verification:

```typescript
async function verifyBackups(): Promise<boolean> {
  const backups = await db.collection('backups').get();
  return backups.size > 0;
}
```

1. Restore procedure:

```typescript
async function restoreData(timestamp: Date): Promise<void> {
  const backup = await db.collection('backups')
    .where('timestamp', '<=', timestamp)
    .orderBy('timestamp', 'desc')
    .limit(1)
    .get();
   
  if (!backup.empty) {
    await restoreFromBackup(backup.docs[0]);
  }
}
```

### Error Recovery

1. Clear error state:

```typescript
async function clearErrorState(): Promise<void> {
  await db.collection(COLLECTION.SYNC_METADATA)
    .where('status', '==', 'failed')
    .get()
    .then(snapshot => {
      const batch = db.batch();
      snapshot.forEach(doc => {
        batch.update(doc.ref, { status: 'ready' });
      });
      return batch.commit();
    });
}
```

1. Reset sync state:

```typescript
async function resetSyncState(): Promise<void> {
  await Promise.all([
    db.collection(COLLECTION.CARD_HASHES).get()
      .then(snapshot => {
        const batch = db.batch();
        snapshot.forEach(doc => batch.delete(doc.ref));
        return batch.commit();
      }),
    db.collection(COLLECTION.PRICE_HASHES).get()
      .then(snapshot => {
        const batch = db.batch();
        snapshot.forEach(doc => batch.delete(doc.ref));
        return batch.commit();
      })
  ]);
}
```
