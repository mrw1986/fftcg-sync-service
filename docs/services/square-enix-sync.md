# Square Enix Integration Service

## Overview

The Square Enix Integration service (`squareEnixSync.ts`) enriches card data with
official Square Enix information, ensuring accuracy in critical fields like cost,
power, and categories. This service acts as a secondary data source that complements
the primary TCGCSV API data.

## Core Features

- Cost/power value synchronization
- Category handling and deduplication
- Data versioning and consistency
- Set matching and validation
- Batch processing optimization
- Hash-based change detection
- Missing field population from Square Enix data

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
- Only updates values when TCGCSV data is null or empty

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

### Card Number Handling

- Preservation of "Re-" prefix numbers from TCGCSV API
- Merging of Square Enix numbers with "Re-" prefix numbers
- Hash calculation that includes "Re-" prefix numbers
- Support for multiple numbering schemes in a single card
- Proper validation of all number formats

### Non-Card Product Detection

- Intelligent detection of card products vs. non-card products
- Verification of card-specific fields (Number, Power, Job, etc.)
- Correction of products incorrectly marked as non-cards
- Proper handling of sealed products and accessories
- Field validation to ensure data consistency
- Special handling for Crystal cards and other special types

```typescript
function calculateHash(card: SquareEnixCard, tcgCard?: TcgCard): string {
  // Get Re- prefix numbers from TCG card if available
  const reNumbers = tcgCard?.cardNumbers?.filter(num =>
    num.startsWith("Re-")) || [];
  
  // Combine SE numbers with Re- numbers
  const combinedCardNumbers = [...new Set([...seCardNumbers, ...reNumbers])].sort();
  
  // Include combined card numbers in hash calculation
  const deltaData: HashData = {
    // ... other fields ...
    cardNumbers: combinedCardNumbers,
  };
}
```

### Missing Field Population

- Automatically populates fields that are null or empty in TCGCSV API data
- Prioritizes Square Enix data for completeness
- Handles null, undefined, empty arrays, and empty strings
- Applies to card types, elements, cost, power, and other fields
- Always uses Square Enix data for categories when available
- Preserves existing data for other fields when it's not null or empty
- Logs detailed information about field updates
- Intelligently detects and corrects cards incorrectly marked as non-cards
- Ensures all card-specific fields are properly populated

```typescript
// For most fields: Check for null, undefined, empty arrays, or empty strings
const isEmpty =
  currentValue === null ||
  currentValue === undefined ||
  (Array.isArray(currentValue) && currentValue.length === 0) ||
  (typeof currentValue === 'string' && currentValue.trim() === '');

if (isEmpty) {
  // Update with Square Enix data
  updates[field] = seValue;
}

// For categories: Always use Square Enix data when available
if (seCategories.length > 0) {
  // Join with actual middot for category string
  const seCategory = seCategories.join("\u00B7");
  
  // Always update categories with Square Enix data
  updates.category = seCategory;
  updates.categories = seCategories;
}
```

### Category Handling

- DFF category prioritization
- Middot separator implementation
- Array ordering preservation
- Format consistency enforcement
- Raw category preservation
- Duplicate category prevention
- Consistent character encoding
- Square Enix data used as the source of truth for categories
- Specific category formatting rules:
  - "Theatrhythm", "Mobius", "Pictlogica", and "Type-0" always in that exact format
  - "World of Final Fantasy" always converted to "WOFF"
  - "Lord of Vermilion" always converted to "LOV"
  - Roman numerals (I, II, III, etc.) always in uppercase
  - Known acronyms (DFF, FF, FFCC, etc.) preserved in uppercase
  - Other categories in title case (first letter of each word capitalized)

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
