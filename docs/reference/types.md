# Type Reference Guide

## Core Types

### Card Types

#### CardProduct

```typescript
interface CardProduct {
  productId: number;
  name: string;
  cleanName: string;
  imageUrl: string;
  storageImageUrl?: string;
  categoryId: number;
  groupId: number;
  url: string;
  modifiedOn: string;
  imageCount: number;
  imageMetadata?: ImageMetadata;
  extendedData: Array<{
    name: string;
    displayName: string;
    value: string;
  }>;
}
```

#### CardPrice

```typescript
interface CardPrice {
  productId: number;
  lowPrice: number;
  midPrice: number;
  highPrice: number;
  marketPrice: number | null;
  directLowPrice: number | null;
  subTypeName: "Normal" | "Foil";
}
```

### Synchronization Types

#### SyncOptions

```typescript
interface SyncOptions {
  dryRun?: boolean;
  limit?: number;
  groupId?: string;
  productId?: number;
  showAll?: boolean;
  skipImages?: boolean;
}
```

#### SyncMetadata

```typescript
interface SyncMetadata {
  lastSync: Date;
  status: "in_progress" | "success" | "failed" | "completed_with_errors";
  cardCount: number;
  type: "manual" | "scheduled";
  groupsProcessed: number;
  groupsUpdated: number;
  errors: string[];
  duration?: number;
  imagesProcessed?: number;
  imagesUpdated?: number;
}
```

### Image Processing Types

#### ImageMetadata

```typescript
interface ImageMetadata {
  contentType: string;
  size: number;
  updated: Date;
  hash: string;
  originalUrl: string;
  highResUrl: string;
  groupId?: string;
  productId?: number;
  lastUpdated?: Date;
  originalSize?: number;
  highResSize?: number;
}
```

#### ImageProcessingResult

```typescript
interface ImageProcessingResult {
  url: string;
  metadata: ImageMetadata;
  updated: boolean;
}
```

#### ImageValidationError

```typescript
interface ImageValidationError {
  code: "FILE_TOO_LARGE" | "INVALID_FORMAT" | "VALIDATION_ERROR";
  message: string;
}
```

### Error Handling Types

#### GenericError

```typescript
interface GenericError extends Error {
  code?: string;
  message: string;
  stack?: string;
}
```

#### ErrorReport

```typescript
interface ErrorReport {
  timestamp: Date;
  context: string;
  error: string;
  stackTrace?: string;
  metadata?: Record<string, unknown>;
  severity: "ERROR" | "WARNING" | "CRITICAL";
}
```

### Cache Types

#### CacheOptions

```typescript
interface CacheOptions {
  max: number;
  ttl: number;
}
```

#### CacheEntry

```typescript
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expires: number;
}
```

### Batch Processing Types

#### BatchProcessingStats

```typescript
interface BatchProcessingStats {
  total: number;
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
}
```

#### BatchOptions

```typescript
interface BatchOptions {
  batchSize?: number;
  delayBetweenBatches?: number;
  onBatchComplete?: (stats: BatchProcessingStats) => Promise<void>;
  skipImages?: boolean;
  retryFailedImages?: boolean;
}
```

## Type Usage Examples

### Using SyncOptions

```typescript
// Test sync with specific group
const options: SyncOptions = {
  dryRun: true,
  limit: 5,
  groupId: "23783"
};

await syncCards(options);
```

### Error Handling Example

```typescript
try {
  // Operation code
} catch (error) {
  const errorReport: ErrorReport = {
    timestamp: new Date(),
    context: "cardSync",
    error: error.message,
    stackTrace: error.stack,
    severity: "ERROR"
  };
  await logError(errorReport);
}
```

### Batch Processing Example

```typescript
const batchOptions: BatchOptions = {
  batchSize: 100,
  delayBetweenBatches: 1000,
  onBatchComplete: async (stats) => {
    console.log(`Processed: ${stats.processed}/${stats.total}`);
  }
};

await processBatch(items, processor, batchOptions);
```

## Type Guards and Validation

### Card Type Guard

```typescript
function isCardProduct(obj: unknown): obj is CardProduct {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "productId" in obj &&
    "name" in obj &&
    "groupId" in obj
  );
}
```

### Price Type Guard

```typescript
function isCardPrice(obj: unknown): obj is CardPrice {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "productId" in obj &&
    "midPrice" in obj &&
    "subTypeName" in obj
  );
}
```

## Best Practices

### Type Safety

- Use strict TypeScript configuration
- Implement proper type guards
- Avoid type assertions when possible
- Maintain comprehensive interfaces

### Error Handling

- Use specific error types
- Implement proper error inheritance
- Include detailed error metadata
- Maintain error tracking

### Performance

- Use efficient type definitions
- Implement proper generics
- Avoid unnecessary type complexity
- Maintain clear type hierarchies

## Related Documentation

- [Error Handling](/utils/error-handling)
- [Cache System](/utils/cache)
- [Batch Processing](/utils/batch)
- [Image Processing](/utils/image-handler)
