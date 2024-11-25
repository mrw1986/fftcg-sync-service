# Progress Tracking Utility

## Overview

The Progress Tracking utility (`progress.ts`) provides real-time monitoring and
 reporting of long-running operations. It offers accurate progress calculations,
  ETA estimations, and detailed statistics for batch operations.

## Core Components

### Progress Statistics Interface

```typescript
export interface ProgressStats {
  current: number;
  total: number;
  percent: number;
  elapsed: number;
  rate: number;
  remaining: number;
  eta: number;
}
```

### Enhanced Progress Tracker Class

```typescript
export class EnhancedProgressTracker {
  private startTime: number;
  private current: number;
  private estimates: number[] = [];
  private lastUpdate: number;
  private updateInterval: number;

  constructor(
    private total: number,
    private description: string,
    options: { updateInterval?: number } = {}
  ) {
    this.startTime = Date.now();
    this.current = 0;
    this.lastUpdate = Date.now();
    this.updateInterval = options.updateInterval || 1000; // Default 1 second
  }
}
```

## Core Methods

### Statistics Calculation

```typescript
private calculateStats(): ProgressStats {
  const now = Date.now();
  const elapsed = (now - this.startTime) / 1000;
  const percent = (this.current / this.total) * 100;
  const rate = this.current / elapsed;
  const remaining = this.total - this.current;
  const eta = remaining / rate;

  return {
    current: this.current,
    total: this.total,
    percent,
    elapsed,
    rate,
    remaining,
    eta,
  };
}
```

### Progress Update

```typescript
update(amount = 1): void {
  const now = Date.now();
  this.current += amount;

  // Only update log if enough time has passed
  if (now - this.lastUpdate >= this.updateInterval) {
    const stats = this.calculateStats();
    this.estimates.push(stats.eta);

    // Keep only last 10 estimates for averaging
    if (this.estimates.length > 10) {
      this.estimates.shift();
    }

    const avgEta = this.estimates.reduce((a, b) => a + b, 0) / 
      this.estimates.length;

    logInfo(
      `${this.description}: ${stats.current}/${stats.total} ` +
      `(${stats.percent.toFixed(1)}%) - ${stats.remaining} remaining - ` +
      `ETA: ${avgEta.toFixed(1)}s - Rate: ${stats.rate.toFixed(1)}/s`
    );

    this.lastUpdate = now;
  }
}
```

## Usage Examples

### Basic Progress Tracking

```typescript
const tracker = new EnhancedProgressTracker(100, "Processing Items");

for (let i = 0; i < 100; i++) {
  await processItem(i);
  tracker.update();
}
```

### Batch Processing Progress

```typescript
const tracker = new EnhancedProgressTracker(
  totalItems,
  "Processing Batches",
  { updateInterval: 2000 } // Update every 2 seconds
);

for (const batch of batches) {
  await processBatch(batch);
  tracker.update(batch.length);
}
```

### Custom Progress Monitoring

```typescript
const tracker = new EnhancedProgressTracker(totalCards, "Syncing Cards");

// Get current progress
const progress = tracker.getProgress();
console.log(`Current progress: ${progress.percent.toFixed(1)}%`);
console.log(`ETA: ${progress.eta.toFixed(1)} seconds`);
```

## Progress Output Examples

### Standard Progress Output

```text
Processing Items: 45/100 (45.0%) - 55 remaining - ETA: 62.3s - Rate: 0.9/s
```

### Batch Progress Output

```text
Processing Batches: 250/1000 (25.0%) - 750 remaining - ETA: 300.5s - Rate: 2.5/s
```

## Advanced Features

### ETA Calculation

- Rolling average of last 10 estimates
- Adaptive rate calculation
- Dynamic update intervals
- Accurate remaining time prediction

### Performance Monitoring

- Processing rate tracking
- Resource usage monitoring
- Time elapsed tracking
- Completion percentage

### Progress Formatting

- Percentage calculation
- Rate calculation
- Time formatting
- Progress bar rendering

## Best Practices

### Update Frequency

```typescript
// Recommended update interval based on total items
const getOptimalInterval = (total: number): number => {
  if (total < 100) return 500;    // 0.5s for small operations
  if (total < 1000) return 1000;  // 1s for medium operations
  return 2000;                    // 2s for large operations
};

const tracker = new EnhancedProgressTracker(items.length, "Processing", {
  updateInterval: getOptimalInterval(items.length)
});
```

### Memory Management

```typescript
// Clear old estimates periodically
if (this.estimates.length > 10) {
  this.estimates = this.estimates.slice(-10);
}
```

### Error Handling

```typescript
update(amount = 1): void {
  try {
    this.current += amount;
    if (this.current > this.total) {
      this.current = this.total;
    }
    // Update logic...
  } catch (error) {
    logError(error, "progressUpdate");
  }
}
```

## Integration Examples

### With Batch Processing

```typescript
const batchProcessor = async (items: any[]) => {
  const tracker = new EnhancedProgressTracker(items.length, "Batch Processing");
  
  for (const batch of chunks(items, 100)) {
    await processBatch(batch);
    tracker.update(batch.length);
  }
};
```

### With Sync Operations

```typescript
const syncWithProgress = async (options: SyncOptions) => {
  const tracker = new EnhancedProgressTracker(
    totalItems,
    "Syncing Data",
    { updateInterval: 1000 }
  );

  // Register callback
  options.onProgress = (processed: number) => {
    tracker.update(processed);
  };

  await syncOperation(options);
};
```

## Related Documentation

- [Batch Processing](/utils/batch)
- [Sync Logger](/utils/sync-logger)
- [Error Handling](/utils/error-handling)
- [Logging System](/utils/logging)
