# Card Synchronization Service

## Overview

The Card Synchronization service (`cardSync.ts`) manages the automated synchronization of FFTCG card data from TCGPlayer's API. It handles card information updates, image processing, and maintains data consistency through hash-based versioning.

## Core Features

- Automated card data synchronization
- Image processing and storage
- Batch processing
- Error handling and retry logic
- Dry run capability for testing
- Progress tracking and logging

## API Reference

### Main Function

```typescript
async function syncCards(options: SyncOptions = {}): Promise<SyncMetadata>
```

#### Options

```typescript
interface SyncOptions {
  dryRun?: boolean;      // Run without making changes
  limit?: number;        // Limit number of cards processed
  groupId?: string;      // Process specific group only
  skipImages?: boolean;  // Skip image processing
}
```

#### Response

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

## Usage Examples

### Scheduled Sync

The service runs automatically on a daily schedule:

```typescript
exports.scheduledCardSync = onSchedule({
  schedule: "0 21 * * *", // Daily at 21:00 UTC
  timeZone: "UTC",
  memory: runtimeOpts.memory,
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  retryCount: 3,
});
```

### Manual Sync

Test specific groups or cards:

```typescript
// Test sync with limits
await syncCards({
  dryRun: true,
  limit: 5,
  groupId: "23783"
});

// Full manual sync
await syncCards({
  dryRun: false
});
```

## Error Handling

The service implements comprehensive error handling:

```typescript
class SyncError extends Error implements GenericError {
  constructor(
    message: string,
    code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "SyncError";
    this.code = code;
  }
}
```

### Retry Logic

```typescript
const MAX_RETRIES = 3;
const BASE_DELAY = 1000; // 1 second

// Exponential backoff
const delay = Math.pow(2, retryCount) * BASE_DELAY;
```

## Data Processing

### Batch Processing

```typescript
async function processBatch<T>(
  items: T[],
  processor: (batch: T[]) => Promise<void>,
  options: BatchOptions = {}
): Promise<void>
```

### Hash Generation

```typescript
function getDataHash(data: any): string {
  return crypto.createHash("md5")
    .update(JSON.stringify(data, Object.keys(data).sort()))
    .digest("hex");
}
```

## Monitoring

### Progress Tracking

The service logs detailed progress information:

- Groups processed
- Cards updated
- Images processed
- Processing duration
- Error counts

### Success Metrics

- Number of groups updated
- Number of cards processed
- Number of images updated
- Processing duration
- Error rate

## Best Practices

1. Testing Changes:

```typescript
// Always test with dry run first
await syncCards({
  dryRun: true,
  limit: 5
});
```

1. Error Monitoring:

```typescript
// Check sync metadata for errors
const metadata = await syncCards();
if (metadata.errors.length > 0) {
  console.error("Sync completed with errors:", metadata.errors);
}
```

1. Resource Management:

```typescript
// Use limits when testing
const options: SyncOptions = {
  limit: 10,
  dryRun: true
};
```

## Troubleshooting

### Common Issues

1. Rate Limiting:
   - Implement proper delays between requests
   - Use batch processing
   - Follow exponential backoff

2. Image Processing:
   - Verify storage permissions
   - Check image URLs
   - Monitor storage quotas

3. Data Consistency:
   - Use hash verification
   - Implement proper error handling
   - Monitor sync metadata

### Debug Mode

Enable detailed logging:

```typescript
// Enable debug logging
await syncCards({
  dryRun: true,
  debug: true
});
```

## Related Components

- [Price Sync Service](./price-sync)
- [Image Handler](../utils/image-handler)
- [Cache System](../utils/cache)
- [Error Handling](../utils/error-handling)
