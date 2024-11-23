# Sync Logger Utility

## Overview

The Sync Logger (`syncLogger.ts`) provides specialized logging functionality for synchronization operations. It offers detailed tracking of card and price synchronization processes, including group details, card information, and sync results.

## Features

- Detailed sync operation logging
- Card and price details tracking
- Group processing information
- Progress monitoring
- Results summarization
- Support for dry run operations

## Core Interfaces

### Logger Options

```typescript
interface SyncLoggerOptions {
  type: "manual" | "scheduled" | "both";
  limit?: number;
  dryRun?: boolean;
  groupId?: string;
  batchSize?: number;
}
```

### Card Details

```typescript
interface CardDetails {
  id: number;
  name: string;
  groupId: string;
  normalPrice?: number;
  foilPrice?: number;
  rawPrices: Array<{
    type: "Normal" | "Foil";
    price: number;
    groupId: string;
  }>;
  imageUrl?: string;
  storageImageUrl?: string;
}
```

### Sync Results

```typescript
interface SyncResults {
  success: number;
  failures: number;
  groupId?: string;
  type: "Manual" | "Scheduled";
  imagesProcessed?: number;
  imagesUpdated?: number;
}
```

## Usage Examples

### Basic Usage

```typescript
const logger = new SyncLogger({
  type: "manual",
  dryRun: true,
  limit: 10,
  batchSize: 25
});

await logger.start();
await logger.logGroupFound(totalGroups);
await logger.logCardDetails(cardDetails);
await logger.finish();
```

### Sync Process Logging

```typescript
// Initialize logger
const logger = new SyncLogger({
  type: options.dryRun ? "manual" : "scheduled",
  limit: options.limit,
  dryRun: options.dryRun,
  groupId: options.groupId
});

// Start logging
await logger.start();

// Log group information
await logger.logGroupDetails(groupId, products.length, prices.length);

// Log individual card details
await logger.logCardDetails({
  id: product.productId,
  name: product.name,
  groupId: product.groupId.toString(),
  normalPrice: normalPrice,
  foilPrice: foilPrice,
  rawPrices: pricesArray
});

// Log final results
await logger.logSyncResults({
  success: processedCount,
  failures: errorCount,
  type: "Manual",
  imagesProcessed: 100,
  imagesUpdated: 25
});
```

## Core Methods

### Start Logging

```typescript
async start(): Promise<void> {
  console.log("\nStarting sync test...");
  console.log(`Type: ${this.options.type}`);
  if (this.options.limit) console.log(`Limit: ${this.options.limit} cards`);
  console.log(`Dry Run: ${this.options.dryRun ? "true" : "false"}`);
  console.log("\n=== Fetching Raw Data ===");
}
```

### Group Logging

```typescript
async logGroupDetails(
  groupId: string,
  products: number,
  prices: number
): Promise<void> {
  this.groups.set(groupId, {products, prices});
  console.log(
    `Group ${groupId} has ${products} products and ${prices} prices`
  );
}
```

### Card Details Logging

```typescript
async logCardDetails(details: CardDetails): Promise<void> {
  this.cards.push(details);
  if (this.cards.length === 1) {
    console.log("\n=== Card Details ===");
  }

  console.log(`Card: ${details.name} (${details.groupId || "UNKNOWN"})`);
  console.log(`- ID: ${details.id}`);
  console.log(`- Group ID: ${details.groupId || "UNKNOWN"}`);

  if (details.rawPrices.length > 0) {
    console.log("- Raw Prices:");
    details.rawPrices.forEach((price) => {
      console.log(
        `  > ${price.type}: $${price.price.toFixed(2)} ` +
        `(Group: ${price.groupId})`
      );
    });
  }
}
```

## Output Examples

### Sync Start

```text
Starting sync test...
Type: manual
Limit: 10 cards
Dry Run: true

=== Fetching Raw Data ===
```

### Group Information

```text
Found 15 groups
Group 23783 has 100 products and 200 prices
```

### Card Details Output Example

```text
=== Card Details ===
Card: Cloud (23783)
- ID: 477236
- Group ID: 23783
- Raw Prices:
  > Normal: $1.99 (Group: 23783)
  > Foil: $5.99 (Group: 23783)
- Image URL: https://example.com/image.jpg
- Storage URL: gs://bucket/image.jpg
```

## Best Practices

1. **Consistent Usage**:

   ```typescript
   const logger = new SyncLogger(options);
   await logger.start();
   try {
     // Sync operations
   } finally {
     await logger.finish();
   }
   ```

2. **Detailed Logging**:

   ```typescript
   await logger.logCardDetails({
     id: product.id,
     name: product.name,
     groupId: product.groupId,
     normalPrice: product.prices.normal,
     foilPrice: product.prices.foil,
     rawPrices: product.allPrices,
     imageUrl: product.imageUrl,
     storageImageUrl: product.storageUrl
   });
   ```

3. **Error Tracking**:

   ```typescript
   try {
     await processGroup(group);
   } catch (error) {
     await logger.logSyncResults({
       success: processed,
       failures: failures + 1,
       type: "Manual"
     });
   }
   ```

## Related Components

- [Logger](./logging)
- [Error Handling](./error-handling)
- [Progress Tracking](./progress)

## Troubleshooting

### Common Issues

1. Missing Information:
   - Verify all required fields are provided
   - Check logging options configuration
   - Ensure proper error handling

2. Performance Impact:
   - Use appropriate batch sizes
   - Monitor memory usage
   - Implement log rotation

3. Output Formatting:
   - Verify console output formatting
   - Check price formatting
   - Validate date/time formats
