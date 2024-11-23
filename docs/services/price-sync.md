# Price Synchronization Service

## Overview

The Price Synchronization service (`priceSync.ts`) manages automated price updates for FFTCG cards. It handles both normal and foil price variants, implements version control through hashing, and provides detailed logging of price changes.

## Core Features

- Real-time price synchronization
- Support for multiple price variants (Normal/Foil)
- Hash-based version control
- Batch processing
- Detailed price change logging
- Configurable sync intervals

## API Reference

### Main Function

```typescript
async function syncPrices(options: SyncOptions = {}): Promise<SyncMetadata>
```

#### Options

```typescript
interface SyncOptions {
  dryRun?: boolean;      // Run without making changes
  limit?: number;        // Limit number of prices processed
  groupId?: string;      // Process specific group only
  productId?: number;    // Process specific product only
  showAll?: boolean;     // Show all prices, including unchanged
}
```

#### Price Data Structure

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

interface PriceData {
  normal?: CardPrice;
  foil?: CardPrice;
  lastUpdated: Date;
}
```

## Usage Examples

### Scheduled Sync

Automated daily price updates:

```typescript
exports.scheduledPriceSync = onSchedule({
  schedule: "30 21 * * *", // Daily at 21:30 UTC
  timeZone: "UTC",
  memory: runtimeOpts.memory,
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  retryCount: 3,
});
```

### Manual Price Checks

```typescript
// Test specific product
await syncPrices({
  dryRun: true,
  productId: 477236,
  showAll: true
});

// Check specific group
await syncPrices({
  dryRun: true,
  groupId: "23783",
  limit: 10
});
```

## Price Processing

### Price Data Processing

```typescript
function processPrices(prices: CardPrice[]): Record<number, PriceData> {
  const priceMap: Record<number, PriceData> = {};

  prices.forEach((price) => {
    if (!priceMap[price.productId]) {
      priceMap[price.productId] = {
        lastUpdated: new Date(),
      };
    }

    if (price.subTypeName === "Normal") {
      priceMap[price.productId].normal = price;
    } else {
      priceMap[price.productId].foil = price;
    }
  });

  return priceMap;
}
```

### Batch Processing

```typescript
async function processBatch<T>(
  items: T[],
  processor: (batch: T[]) => Promise<void>,
  batchSize: number = 500
): Promise<void>
```

## Error Handling

### Error Types

```typescript
class SyncError extends Error implements GenericError {
  code?: string;

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

### Request Retry Logic

```typescript
const MAX_RETRIES = 3;
const BASE_DELAY = 1000; // 1 second base delay

// Exponential backoff implementation
if (retryCount < MAX_RETRIES - 1) {
  const delay = Math.pow(2, retryCount) * BASE_DELAY;
  await logWarning(`Request failed, retrying in ${delay}ms...`);
}
```

## Monitoring

### Price Change Tracking

The service tracks:

- Price updates per group
- Number of cards processed
- Processing duration
- Error rates
- Price change percentages

### Success Metrics

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
}


## Best Practices

1. Regular Monitoring:
   - Check sync metadata regularly
   - Monitor price change patterns
   - Track error rates

1. Testing Changes:

```typescript
// Always test with dry run
const testSync = await syncPrices({
  dryRun: true,
  limit: 5,
  showAll: true
});
```

1. Error Handling:

```typescript
// Implement proper error checking
const sync = await syncPrices(options);
if (sync.status === "completed_with_errors") {
  console.error("Sync errors:", sync.errors);
}
```

## Troubleshooting

### Common Issues

1. Price Discrepancies:
   - Verify data source connection
   - Check price format consistency
   - Monitor exchange rate impacts

2. Sync Failures:
   - Check network connectivity
   - Verify API rate limits
   - Monitor service quotas

3. Performance Issues:
   - Use appropriate batch sizes
   - Implement proper delays
   - Monitor memory usage

### Validation

```typescript
// Validate price data
if (price.midPrice < 0 || price.lowPrice < 0) {
  throw new Error("Invalid price values detected");
}
```

## Related Components

- [Card Sync Service](./card-sync)
- [Cache System](../utils/cache)
- [Error Handling](../utils/error-handling)
- [Logger](../utils/logging)
