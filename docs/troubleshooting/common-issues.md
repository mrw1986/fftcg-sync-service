# Common Issues and Solutions

## Overview

This guide covers common issues encountered in the FFTCG Sync Service and their
 solutions, including synchronization problems, image processing errors,
  and performance issues.

## Synchronization Issues

### 1. Sync Operation Timeouts

**Symptoms:**

- Function execution timeouts
- Incomplete synchronization
- Missing card data

**Solutions:**

```typescript
// Implement batch processing with proper sizing
const batchOptions = {
  batchSize: 100,  // Reduce from default 500
  delayBetweenBatches: 1000,
  onBatchComplete: async (stats) => {
    console.log(`Processed ${stats.processed}/${stats.total}`);
  }
};

// Use proper timeouts
export const runtimeOpts = {
  timeoutSeconds: 540,  // Increase if needed
  memory: "1GiB"
};
```

### 2. Data Inconsistency

**Symptoms:**

- Mismatched card data
- Missing prices
- Incorrect image URLs

**Solutions:**

```typescript
// Validate data integrity
async function validateData(groupId: string): Promise<void> {
  const cards = await db.collection(COLLECTION.CARDS)
    .where("groupId", "==", groupId)
    .get();

  const prices = await db.collection(COLLECTION.PRICES)
    .where("groupId", "==", groupId)
    .get();

  // Cross-reference and fix inconsistencies
  for (const card of cards.docs) {
    const cardData = card.data();
    const priceDoc = prices.docs
      .find(doc => doc.id === cardData.productId.toString());

    if (!priceDoc) {
      await logError(
        new Error(`Missing price data for card ${cardData.productId}`),
        "dataValidation"
      );
    }
  }
}
```

## Image Processing Issues

### 1. Image Download Failures

**Symptoms:**

- Failed image downloads
- Timeout errors
- Missing images

**Solutions:**

```typescript
// Implement retry logic with exponential backoff
async function downloadImageWithRetry(
  url: string,
  maxRetries: number = 3
): Promise<Buffer> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 30000,
      });
      return Buffer.from(response.data);
    } catch (error) {
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error(`Failed to download image after ${maxRetries} attempts`);
}
```

### 2. Storage Quota Issues

**Symptoms:**

- Storage quota exceeded
- Failed image uploads
- Missing processed images

**Solutions:**

```typescript
// Implement storage cleanup
async function cleanupOldImages(): Promise<void> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);

  const [files] = await storage
    .bucket(STORAGE.BUCKETS.CARD_IMAGES)
    .getFiles();

  for (const file of files) {
    const metadata = file.metadata;
    if (new Date(metadata.timeCreated) < cutoffDate) {
      await file.delete();
    }
  }
}
```

## Performance Issues

### 1. High Memory Usage

**Symptoms:**

- Out of memory errors
- Function crashes
- Slow processing

**Solutions:**

```typescript
// Implement memory monitoring and cleanup
function monitorMemory(): void {
  const memoryUsage = process.memoryUsage();
  const threshold = 900 * 1024 * 1024; // 900MB

  if (memoryUsage.heapUsed > threshold) {
    // Clear caches
    imageCache.clear();
    cardCache.clear();
    
    // Force garbage collection if available
    global.gc?.();
    
    logWarning("High memory usage detected", {
      usage: memoryUsage.heapUsed,
      threshold
    });
  }
}
```

### 2. Slow Database Operations

**Symptoms:**

- Slow query responses
- Transaction timeouts
- Operation failures

**Solutions:**

```typescript
// Optimize queries and implement monitoring
async function optimizeQuery<T>(
  queryFn: () => Promise<T>,
  context: string
): Promise<T> {
  const start = Date.now();
  try {
    const result = await queryFn();
    const duration = Date.now() - start;

    if (duration > 1000) {
      await logWarning("Slow query detected", {
        context,
        duration,
        timestamp: new Date()
      });
    }

    return result;
  } catch (error) {
    await logError(error, `${context}:query`);
    throw error;
  }
}
```

## Authentication Issues

### 1. Token Expiration

**Symptoms:**

- Authentication failures
- 401 errors
- Unauthorized access

**Solutions:**

```typescript
// Implement token refresh
async function getValidToken(): Promise<string> {
  const auth = getAuth();
  const user = auth.currentUser;
  
  if (!user) {
    throw new Error("No authenticated user");
  }

  try {
    return await user.getIdToken(true);  // Force refresh
  } catch (error) {
    await logError(error, "tokenRefresh");
    throw error;
  }
}
```

### 2. Permission Issues

**Symptoms:**

- Access denied errors
- 403 responses
- Failed operations

**Solutions:**

```typescript
// Verify and fix permissions
async function verifyPermissions(
  userId: string
): Promise<void> {
  const user = await admin.auth().getUser(userId);
  
  if (!user.customClaims?.admin) {
    await admin.auth().setCustomUserClaims(userId, {
      admin: true
    });
    
    await logInfo("Updated user permissions", {
      userId,
      claims: { admin: true }
    });
  }
}
```

## Rate Limiting Issues

### 1. API Rate Limits

**Symptoms:**

- 429 Too Many Requests
- Failed API calls
- Throttled operations

**Solutions:**

```typescript
// Implement rate limiting
class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  
  constructor(
    private maxTokens: number,
    private refillRate: number,
    private refillInterval: number
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<boolean> {
    this.refillTokens();
    
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    
    return false;
  }

  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = Math.floor(
      (elapsed / this.refillInterval) * this.refillRate
    );
    
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}
```

## Recovery Procedures

### 1. Data Recovery

```typescript
// Implement data recovery
async function recoverData(
  groupId: string,
  timestamp: Date
): Promise<void> {
  // Get backup data
  const backup = await db.collection("backups")
    .where("timestamp", "<=", timestamp)
    .orderBy("timestamp", "desc")
    .limit(1)
    .get();

  if (!backup.empty) {
    const backupData = backup.docs[0].data();
    await restoreFromBackup(backupData);
  }
}
```

### 2. Error Recovery

```typescript
// Implement error recovery
async function recoverFromError(
  error: Error,
  context: string
): Promise<void> {
  await logError(error, context);
  
  // Attempt recovery based on error type
  switch (error.name) {
    case "NetworkError":
      await retryOperation();
      break;
    case "DatabaseError":
      await validateAndRepair();
      break;
    default:
      await generalRecovery();
  }
}
```

## Diagnostic Tools

### 1. System Check

```typescript
async function runSystemCheck(): Promise<void> {
  // Check database connection
  await db.collection(COLLECTION.CARDS).limit(1).get();
  
  // Check storage access
  await storage.bucket(STORAGE.BUCKETS.CARD_IMAGES)
    .file("test.txt")
    .exists();
  
  // Check memory usage
  const memoryUsage = process.memoryUsage();
  console.log("Memory usage:", memoryUsage);
  
  // Check cache status
  console.log("Cache stats:", imageCache.getStats());
}
```

### 2. Log Analysis

```typescript
async function analyzeErrors(): Promise<void> {
  const errors = await db.collection(COLLECTION.LOGS)
    .where("level", "==", "ERROR")
    .orderBy("timestamp", "desc")
    .limit(100)
    .get();

  const errorPatterns = errors.docs.reduce((acc, doc) => {
    const error = doc.data();
    acc[error.message] = (acc[error.message] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log("Error patterns:", errorPatterns);
}
```

## Related Documentation

- [Monitoring Guide](/monitoring/)
- [Error Handling](/utils/error-handling)
- [Deployment Guide](/deployment/)
- [System Architecture](/architecture)
