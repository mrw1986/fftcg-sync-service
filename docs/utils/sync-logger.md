# Sync Logger Utility

## Overview

The Sync Logger (`syncLogger.ts`) provides specialized logging functionality for
 synchronization operations. It handles detailed logging of card and price
 synchronization processes, including group details, card information, and sync results.

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

## Core Implementation

### SyncLogger Class

```typescript
export class SyncLogger {
  private startTime: number;
  private cards: CardDetails[] = [];
  private groups: Map<string, { 
    products: number; 
    prices: number 
  }> = new Map();

  constructor(private options: SyncLoggerOptions) {
    this.startTime = Date.now();
  }
}
```

## Logging Methods

### Initialization

```typescript
async start(): Promise<void> {
  console.log("\nStarting sync test...");
  console.log(`Type: ${this.options.type}`);
  if (this.options.limit) {
    console.log(`Limit: ${this.options.limit} cards`);
  }
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

  if (details.imageUrl) {
    console.log(`- Image URL: ${details.imageUrl}`);
    if (details.storageImageUrl) {
      console.log(`- Storage URL: ${details.storageImageUrl}`);
    }
  }
}
```

### Sync Results Logging

```typescript
async logSyncResults(results: SyncResults): Promise<void> {
  const duration = (Date.now() - this.startTime) / 1000;

  console.log(`\n${results.type} Sync Results:`);
  console.log(`- Success: ${results.success}`);
  console.log(`- Failures: ${results.failures}`);
  console.log(`- Duration: ${duration.toFixed(1)} seconds`);
  
  if (results.groupId) {
    console.log(`- Group ID: ${results.groupId}`);
  }
  if (results.imagesProcessed) {
    console.log(`- Images Processed: ${results.imagesProcessed}`);
  }
  if (results.imagesUpdated) {
    console.log(`- Images Updated: ${results.imagesUpdated}`);
  }
}
```

## Usage Examples

### Manual Sync Logging

```typescript
const logger = new SyncLogger({
  type: "manual",
  dryRun: true,
  limit: 5,
  batchSize: 25
});

await logger.start();
await logger.logGroupFound(totalGroups);
await logger.logCardDetails(cardDetails);
await logger.logSyncResults({
  success: 5,
  failures: 0,
  type: "Manual",
  imagesProcessed: 5,
  imagesUpdated: 2
});
await logger.finish();
```

### Scheduled Sync Logging

```typescript
const logger = new SyncLogger({
  type: "scheduled",
  dryRun: false
});

await logger.start();
await logger.logScheduledSyncStart();
// Sync operations...
await logger.finish();
```

## Output Examples

### Group Information

```text
=== Fetching Raw Data ===
Found 15 groups
Group 23783 has 100 products and 200 prices
```

### Card Details Output

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

### Sync Results Output

```text
Manual Sync Results:
- Success: 95
- Failures: 5
- Duration: 120.5 seconds
- Group ID: 23783
- Images Processed: 100
- Images Updated: 25
```

## Error Handling

### Error Logging

```typescript
async logError(
  error: Error,
  context: string
): Promise<void> {
  console.error(`Error in ${context}:`, error.message);
  if (this.options.verbose) {
    console.error("Stack trace:", error.stack);
  }
}
```

### Progress Errors

```typescript
async logProgressError(
  current: number,
  total: number,
  error: Error
): Promise<void> {
  console.error(
    `Error at ${current}/${total} (${((current/total)*100).toFixed(1)}%):`,
    error.message
  );
}
```

## Best Practices

### Log Organization

- Group related logs
- Use consistent formatting
- Include timestamps
- Maintain context

### Performance

- Buffer large outputs
- Limit verbose logging
- Use appropriate log levels
- Implement log rotation

### Error Handling Guidelines

- Log all errors
- Include context
- Track error patterns
- Maintain error history

## Related Documentation

- [Logging System](/utils/logging)
- [Error Handling](/utils/error-handling)
- [Progress Tracking](/utils/progress)
- [Card Sync Service](/services/card-sync)
