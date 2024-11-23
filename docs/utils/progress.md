# Progress Tracking Utility

## Overview

The Progress Tracker (`progress.ts`) provides real-time monitoring and reporting of long-running operations, particularly during synchronization processes. It handles progress calculation, ETA estimation, and status updates.

## Core Features

- Real-time progress tracking
- ETA calculations
- Operation statistics
- Progress bar visualization
- Step-by-step monitoring
- Batch progress tracking

## Main Interfaces

### Progress Options

```typescript
interface ProgressOptions {
  total: number;
  title?: string;
  showBar?: boolean;
  showEta?: boolean;
  batchSize?: number;
}
```

### Progress State

```typescript
interface ProgressState {
  current: number;
  total: number;
  startTime: Date;
  lastUpdateTime: Date;
  completed: boolean;
  eta?: Date;
  rate?: number;
}
```

## Implementation Examples

### Basic Usage

```typescript
const progress = new ProgressTracker({
  total: totalItems,
  title: "Processing Cards",
  showBar: true,
  showEta: true
});

progress.start();

for (const item of items) {
  await processItem(item);
  progress.increment();
}

progress.finish();
```

### Batch Processing

```typescript
const tracker = new ProgressTracker({
  total: totalGroups,
  title: "Syncing Groups",
  batchSize: 25
});

tracker.start();

for (const batch of batches) {
  await processBatch(batch);
  tracker.incrementBatch(batch.length);
}

tracker.finish();
```

## Progress Visualization

### Progress Bar

```typescript
private renderBar(
  percentage: number,
  width: number = 30
): string {
  const filled = Math.floor(width * (percentage / 100));
  const empty = width - filled;
 
  return '[' + 
    '='.repeat(filled) + 
    ' '.repeat(empty) + 
    ']';
}
```

### Status Line

```typescript
private renderStatus(): string {
  const percentage = this.getPercentage();
  const current = this.state.current;
  const total = this.state.total;
 
  return `${this.options.title || 'Progress'}: ` +
    `${current}/${total} ` +
    `(${percentage.toFixed(1)}%)`;
}
```

## Time Calculations

### ETA Estimation

```typescript
private calculateEta(): Date | undefined {
  if (this.state.current === 0) return undefined;
 
  const elapsed = Date.now() - this.state.startTime.getTime();
  const rate = this.state.current / (elapsed / 1000);
  const remaining = this.state.total - this.state.current;
 
  return new Date(
    Date.now() + (remaining / rate) * 1000
  );
}
```

### Processing Rate

```typescript
private calculateRate(): number {
  const elapsed = (
    this.state.lastUpdateTime.getTime() - 
    this.state.startTime.getTime()
  ) / 1000;
 
  return this.state.current / elapsed;
}
```

## Event Handling

### Progress Updates

```typescript
onProgress(callback: ProgressCallback): void {
  this.progressCallbacks.push(callback);
}

private emitProgress(): void {
  const progress = {
    current: this.state.current,
    total: this.state.total,
    percentage: this.getPercentage(),
    eta: this.state.eta,
    rate: this.state.rate
  };
 
  this.progressCallbacks.forEach(callback => callback(progress));
}
```

### Completion Events

```typescript
onComplete(callback: CompleteCallback): void {
  this.completeCallbacks.push(callback);
}

private emitComplete(): void {
  const summary = {
    total: this.state.total,
    duration: this.getDuration(),
    averageRate: this.calculateAverageRate()
  };
 
  this.completeCallbacks.forEach(callback => callback(summary));
}
```

## Usage Patterns

### With Async Operations

```typescript
const processWithProgress = async (
  items: any[],
  processor: (item: any) => Promise<void>
): Promise<void> => {
  const progress = new ProgressTracker({
    total: items.length,
    title: "Processing Items",
    showBar: true
  });
 
  progress.start();
 
  for (const item of items) {
    await processor(item);
    progress.increment();
    await new Promise(resolve => setTimeout(resolve, 10));
  }
 
  progress.finish();
};
```

### With Batch Processing

```typescript
const processBatchWithProgress = async (
  batches: any[][],
  processor: (batch: any[]) => Promise<void>
): Promise<void> => {
  const totalItems = batches.reduce(
    (sum, batch) => sum + batch.length, 
    0
  );
 
  const progress = new ProgressTracker({
    total: totalItems,
    title: "Processing Batches",
    batchSize: batches[0].length
  });
 
  progress.start();
 
  for (const batch of batches) {
    await processor(batch);
    progress.incrementBatch(batch.length);
  }
 
  progress.finish();
};
```

## Best Practices

### Memory Efficiency

- Clear callbacks after completion
- Limit status update frequency
- Manage event listener count

### Accuracy

- Update progress immediately
- Calculate rates periodically
- Maintain precise counters

### User Experience

- Show meaningful titles
- Provide accurate ETAs
- Update status consistently

## Related Components

- [Sync Logger](./sync-logger)
- [Batch Processor](./batch)
- [Logger](./logging)

## Troubleshooting

### Common Issues

1. Performance Impact:
   - Limit update frequency
   - Optimize calculations
   - Monitor memory usage

2. Accuracy Problems:
   - Verify counter updates
   - Check time calculations
   - Validate batch sizes

3. Display Issues:
   - Check terminal width
   - Verify output formatting
   - Monitor update rates
