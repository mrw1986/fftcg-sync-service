# Error Handling System

## Overview

The Error Handling system (`error.ts`) provides a standardized approach to error management across the application. It includes error classification, detailed logging, and integration with the logging system for comprehensive error tracking.

## Features

- Custom error types
- Detailed error reporting
- Error severity levels
- Metadata support
- Firestore integration
- Stack trace preservation

## Core Components

### Error Types

```typescript
export interface ErrorReport {
  timestamp: Date;
  context: string;
  error: string;
  stackTrace?: string;
  metadata?: Record<string, unknown>;
  severity: "ERROR" | "WARNING" | "CRITICAL";
}

export class DetailedError extends Error {
  constructor(
    message: string,
    public context: string,
    public metadata?: Record<string, unknown>,
    public severity: "ERROR" | "WARNING" | "CRITICAL" = "ERROR"
  ) {
    super(message);
    this.name = "DetailedError";
  }
}
```

## Error Logging

### Basic Error Logging

```typescript
export async function logDetailedError(
  error: Error,
  context: string,
  metadata?: Record<string, unknown>,
  severity: "ERROR" | "WARNING" | "CRITICAL" = "ERROR"
): Promise<void> {
  const report: ErrorReport = {
    timestamp: new Date(),
    context,
    error: error.message,
    stackTrace: error.stack,
    metadata,
    severity,
  };

  await db.collection(COLLECTION.LOGS).add(report);
  await logError(error, context);
}
```

## Usage Examples

### Basic Error Handling

```typescript
try {
  await processImage(imageUrl);
} catch (error) {
  await logDetailedError(
    error as Error,
    "imageProcessing",
    { imageUrl, timestamp: new Date() },
    "ERROR"
  );
}
```

### Custom Error Creation

```typescript
const handleImageError = async (error: unknown, imageUrl: string) => {
  const detailedError = new DetailedError(
    "Image processing failed",
    "imageHandler:process",
    {
      imageUrl,
      originalError: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString()
    },
    "ERROR"
  );

  await logDetailedError(detailedError, detailedError.context);
};
```

## Error Classification

### Severity Levels

```typescript
type ErrorSeverity = "ERROR" | "WARNING" | "CRITICAL";

const determineSeverity = (error: Error): ErrorSeverity => {
  if (error instanceof NetworkError) return "WARNING";
  if (error instanceof DataCorruptionError) return "CRITICAL";
  return "ERROR";
};
```

### Context Management

```typescript
interface ErrorContext {
  component: string;
  operation: string;
  metadata?: Record<string, unknown>;
}

const createErrorContext = (
  component: string,
  operation: string,
  metadata?: Record<string, unknown>
): ErrorContext => ({
  component,
  operation,
  metadata
});
```

## Best Practices

### 1. Error Wrapping

```typescript
try {
  await externalOperation();
} catch (error) {
  const wrappedError = new DetailedError(
    "External operation failed",
    "externalService:operation",
    {
      originalError: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString()
    }
  );
  throw wrappedError;
}
```

### 2. Error Recovery

```typescript
async function withErrorRecovery<T>(
  operation: () => Promise<T>,
  fallback: T,
  context: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    await logDetailedError(
      error as Error,
      context,
      { recoveryAction: "using fallback" }
    );
    return fallback;
  }
}
```

### 3. Batch Error Handling

```typescript
interface BatchError {
  index: number;
  error: Error;
  item: unknown;
}

async function processBatchWithErrors<T>(
  items: T[],
  processor: (item: T) => Promise<void>
): Promise<BatchError[]> {
  const errors: BatchError[] = [];

  for (let i = 0; i < items.length; i++) {
    try {
      await processor(items[i]);
    } catch (error) {
      errors.push({
        index: i,
        error: error as Error,
        item: items[i]
      });
    }
  }

  return errors;
}
```

## Error Monitoring

### Error Aggregation

```typescript
interface ErrorAggregate {
  count: number;
  lastOccurrence: Date;
  contexts: string[];
}

const aggregateErrors = async (
  timeWindow: number
): Promise<Map<string, ErrorAggregate>> => {
  const now = new Date();
  const windowStart = new Date(now.getTime() - timeWindow);

  const errors = await db
    .collection(COLLECTION.LOGS)
    .where("timestamp", ">=", windowStart)
    .where("level", "==", "ERROR")
    .get();

  return errors.docs.reduce((acc, doc) => {
    const data = doc.data();
    const key = data.error;
    const existing = acc.get(key) || {
      count: 0,
      lastOccurrence: windowStart,
      contexts: []
    };

    existing.count++;
    existing.lastOccurrence = data.timestamp.toDate();
    if (!existing.contexts.includes(data.context)) {
      existing.contexts.push(data.context);
    }

    acc.set(key, existing);
    return acc;
  }, new Map<string, ErrorAggregate>());
};
```

## Error Resolution

### Automatic Recovery

```typescript
async function attemptRecovery(
  error: DetailedError,
  maxAttempts: number = 3
): Promise<boolean> {
  let attempts = 0;
  let recovered = false;

  while (attempts < maxAttempts && !recovered) {
    try {
      await recoveryStrategies[error.name]?.(error);
      recovered = true;
    } catch (recoveryError) {
      attempts++;
      await logWarning(
        `Recovery attempt ${attempts} failed`,
        { error: recoveryError }
      );
    }
  }

  return recovered;
}
```

## Related Components

- [Logger](./logging)
- [Sync Logger](./sync-logger)
- [Image Handler](./image-handler)

## Troubleshooting

### Common Issues

1. Missing Error Context:
   - Ensure proper error wrapping
   - Include relevant metadata
   - Use appropriate error types

2. Error Recovery:
   - Implement fallback mechanisms
   - Use appropriate retry strategies
   - Monitor recovery success rates

3. Performance Impact:
   - Balance logging detail with performance
   - Implement error aggregation
   - Use appropriate severity levels
