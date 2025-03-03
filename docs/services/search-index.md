# Search Index Service

## Overview

The Search Index Service (`searchIndexService.ts`) maintains a high-performance,
searchable index of card data. It supports progressive substring search,
number-specific search terms, and uses hash-based change detection for efficient
updates. The service optimizes search capabilities while maintaining data consistency
across the system.

## Core Features

- Progressive substring search
- Number-specific search terms
- Hash-based change detection
- Batch processing optimization
- Real-time index updates
- Automatic reindexing
- Search term normalization
- Prefix search support

## Components

### Service Interface

```typescript
class SearchIndexService {
  // Main service interface
  async updateSearchIndex(options?: IndexOptions): Promise<IndexResult>;
  async search(query: string, options?: SearchOptions): Promise<SearchResult>;
}
```

### Index Structure

```typescript
interface SearchDocument {
  productId: number;
  searchTerms: string[];
  numberTerms: string[];
  displayName: string;
  cardNumbers: string[] | null;
  primaryCardNumber: string | null;
  cardType: string | null;
  elements: string[];
  hash: string;
  lastUpdated: FirebaseFirestore.FieldValue;
}
```

## Search Features

### Progressive Substring Search

- Generates substrings for partial matching
- Supports case-insensitive search
- Handles special characters
- Optimizes term storage

```typescript
function generateSearchTerms(
  text: string,
  options?: TermOptions
): string[];
```

### Number-Specific Search

- Specialized handling for card numbers
- Multiple number format support
- Promo card number handling
- Crystal card number support
- Reprint card number handling with "Re-" prefix
- Special handling for hyphenated formats

```typescript
function generateNumberTerms(
  numbers: string[]
): string[] {
  // Example implementation for "Re-" prefix numbers
  if (number.startsWith("re-")) {
    // Generate terms like "re", "re-", "re-0", "re-00", "re-004", "re-004c"
    // Also include the full "re-004c" as a search term
  }
}
```

## Data Processing

### Term Generation

- Name-based terms
- Number-based terms
- Category-based terms
- Element-based terms
- Type-based terms

```typescript
interface TermGenerationOptions {
  includePartial: boolean;
  minLength: number;
  maxTerms: number;
}
```

### Hash-based Change Detection

```typescript
function calculateSearchHash(
  card: CardDocument
): string;
```

### Batch Processing

```typescript
class IndexBatchProcessor {
  async processBatch(
    cards: CardDocument[]
  ): Promise<BatchResult>;
}
```

## Usage Examples

### Basic Search

```typescript
// Simple search
const results = await searchIndex.search('cloud');

// Search with options
const results = await searchIndex.search('PR-001', {
  exact: true,
  limit: 10
});
```

### Index Updates

```typescript
// Update entire index
await searchIndex.updateSearchIndex();

// Update specific cards
await searchIndex.updateSearchIndex({
  cardIds: [123, 456]
});
```

### Reindexing

```typescript
// Force reindex all cards
await searchIndex.updateSearchIndex({
  forceReindex: true
});
```

## Performance Optimization

### Term Storage

- Efficient term structure
- Optimized substring generation
- Memory usage optimization
- Storage size management

### Query Optimization

- Index field selection
- Term length limits
- Batch size optimization
- Cache utilization

## Error Handling

### Error Types

```typescript
interface SearchIndexError {
  code: string;
  message: string;
  details?: {
    cardId?: number;
    operation?: string;
    query?: string;
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

## Monitoring

### Performance Metrics

- Query response times
- Index update duration
- Term generation speed
- Memory usage
- Cache hit rates

### Operation Tracking

- Cards indexed
- Terms generated
- Queries processed
- Errors encountered
- Cache performance

## Best Practices

1. Search Term Generation:
   - Limit term length
   - Balance coverage vs storage
   - Consider memory impact
   - Optimize substring generation

2. Query Performance:
   - Use appropriate limits
   - Implement pagination
   - Optimize field selection
   - Monitor query patterns

3. Index Maintenance:
   - Regular validation
   - Periodic reindexing
   - Monitor storage usage
   - Track performance metrics

## Troubleshooting

### Common Issues

1. Search Performance:
   - Review term generation
   - Check index structure
   - Monitor query patterns
   - Optimize batch sizes

2. Index Updates:
   - Verify hash calculation
   - Check batch processing
   - Monitor memory usage
   - Validate term generation

3. Data Consistency:
   - Verify hash matching
   - Check update triggers
   - Monitor change detection
   - Validate term updates

## Integration Points

### Card Sync Service

- Triggers index updates
- Provides card data
- Maintains consistency
- Handles data changes

### Square Enix Integration

- Updates card information
- Triggers reindexing
- Provides additional data
- Ensures data accuracy

## Related Documentation

- [Card Sync Service](./card-sync.md)
- [Square Enix Integration](./square-enix-sync.md)
- [Batch Processing](../utils/batch.md)
- [Cache System](../utils/cache.md)
- [Error Handling](../utils/error-handling.md)
