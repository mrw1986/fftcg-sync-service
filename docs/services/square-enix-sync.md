# Square Enix Integration Service

## Overview

The Square Enix Integration service (`squareEnixSync.ts`) enriches card data with official Square Enix information, ensuring accuracy in critical fields like cost, power, and categories. This service acts as a secondary data source that complements the primary TCGCSV API data.

## Core Features

- Cost/power value synchronization
- Category handling and deduplication
- Data versioning and consistency
- Set matching and validation
- Batch processing optimization
- Hash-based change detection

## Components

### Square Enix Storage Service

```typescript
class SquareEnixStorageService {
  // Manages Square Enix card data storage and retrieval
  async getCardData(cardNumber: string): Promise<SquareEnixCardData>;
  async storeCardData(cards: SquareEnixCardData[]): Promise<void>;
}
```

### Data Update Service

```typescript
class SquareEnixSync {
  // Handles data synchronization and updates
  async updateCardsWithSquareEnixData(options?: UpdateOptions): Promise<UpdateResult>;
}
```

## Data Processing

### Cost/Power Synchronization

- Proper value validation
- Conditional updates based on data source reliability
- Null value handling for special cases
- Set matching improvements for accurate updates
- Multiple set handling capability

```typescript
interface ValueUpdate {
  cost: number | null;
  power: number | null;
  setName: string;
}

// Value validation and update logic
function validateAndUpdateValues(
  current: CardDocument,
  update: ValueUpdate
): Partial<CardDocument>;
```

### Category Handling

- DFF category prioritization
- Middot separator implementation
- Array ordering preservation
- Format consistency enforcement
- Raw category preservation
- Duplicate category prevention
- Consistent character encoding

```typescript
interface CategoryUpdate {
  category: string | null;
  categories: string[];
}

// Category processing logic
function processCategories(
  categoryStr: string | null
): CategoryUpdate;
```

### Set Matching

- Improved comparison logic
- Multiple set handling
- Case-insensitive matching
- Whitespace normalization
- Partial match support

```typescript
function findMatchingSets(
  cardSets: string[],
  squareEnixSet: string
): boolean;
```

## Usage Examples

### Basic Update

```typescript
// Update all cards with Square Enix data
await squareEnixSync.updateCardsWithSquareEnixData();

// Update specific cards
await squareEnixSync.updateCardsWithSquareEnixData({
  cardNumbers: ['1-001R', '1-002C']
});
```

### Force Update

```typescript
// Force update regardless of current values
await squareEnixSync.updateCardsWithSquareEnixData({
  forceUpdate: true
});
```

### Dry Run

```typescript
// Test updates without making changes
const result = await squareEnixSync.updateCardsWithSquareEnixData({
  dryRun: true
});
console.log('Changes to be made:', result.changes);
```

## Error Handling

### Error Types

```typescript
interface SquareEnixSyncError {
  code: string;
  message: string;
  details?: {
    cardNumber?: string;
    operation?: string;
    [key: string]: unknown;
  };
}
```

### Retry Strategy

```typescript
const retry = new RetryWithBackoff({
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000
});
```

## Data Consistency

### Hash-based Change Detection

```typescript
function calculateDataHash(data: SquareEnixCardData): string {
  return crypto
    .createHash('md5')
    .update(JSON.stringify(data))
    .digest('hex');
}
```

### Batch Processing

```typescript
const batchProcessor = new OptimizedBatchProcessor(db);

// Process updates in batches
async function processBatch(
  cards: SquareEnixCardData[]
): Promise<void>;
```

## Monitoring

### Progress Tracking

The service tracks:

- Cards processed
- Values updated
- Categories modified
- Processing duration
- Error counts
- Batch processing metrics

### Success Metrics

- Number of cards updated
- Value change frequency
- Category update frequency
- Error rates
- Processing duration
- Cache hit rates

## Best Practices

1. Data Validation:
   - Verify value ranges
   - Validate category formats
   - Check set matching
   - Monitor update patterns

2. Performance Optimization:
   - Use batch processing
   - Implement caching
   - Optimize queries
   - Monitor memory usage

3. Error Management:
   - Log detailed errors
   - Implement retries
   - Monitor patterns
   - Handle edge cases

## Troubleshooting

### Common Issues

1. Value Mismatches:
   - Check data source accuracy
   - Verify set matching
   - Review update logic
   - Check null handling

2. Category Issues:
   - Verify format consistency
   - Check encoding
   - Monitor deduplication
   - Validate ordering

3. Performance:
   - Review batch sizes
   - Check memory usage
   - Monitor API calls
   - Optimize queries

## Integration Points

### Card Sync Service

- Provides base card data
- Triggers updates
- Handles image processing
- Manages primary data flow

### Search Index Service

- Updates search terms
- Maintains consistency
- Handles data changes
- Optimizes search capabilities

### Group Sync Service

- Manages set information
- Ensures data consistency
- Handles group relationships
- Maintains set hierarchies

## Related Documentation

- [Card Sync Service](./card-sync.md)
- [Search Index Service](./search-index.md)
- [Batch Processing](../utils/batch.md)
- [Error Handling](../utils/error-handling.md)
- [Cache System](../utils/cache.md)
