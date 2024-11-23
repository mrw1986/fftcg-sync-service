# Logging System

## Overview

The Logging System (`logger.ts`) provides comprehensive logging functionality across the application. It integrates with Firebase Functions logger and Firestore for persistent log storage, supporting multiple log levels and structured logging data.

## Features

- Multiple log levels (INFO, WARNING, ERROR)
- Structured logging with metadata
- Firestore integration for log persistence
- Data cleaning and sanitization
- Flexible context tracking
- Type-safe logging interfaces

## Basic Usage

### Importing the Logger

```typescript
import { logInfo, logWarning, logError } from "../utils/logger";
import { logger } from "firebase-functions";
```

### Log Levels

```typescript
// Info level logging
await logInfo("Processing started", {
  timestamp: new Date().toISOString(),
  operation: "syncCards"
});

// Warning level logging
await logWarning("Retry attempt required", {
  attempt: 2,
  maxRetries: 3
});

// Error level logging
await logError(error, "syncCards:main");
```

## Data Structures

### Log Entry Interface

```typescript
interface LogEntry {
  timestamp: Date;
  level: "INFO" | "WARNING" | "ERROR";
  message: string;
  context?: string;
  data?: Record<string, unknown>;
}
```

### Error Logging Interface

```typescript
interface GenericError {
  message: string;
  name: string;
  code?: string;
  stack?: string;
}
```

## Core Functions

### Info Logging

```typescript
export const logInfo = async (
  message: string,
  data?: LogData
) => {
  const cleanedData = data ? cleanLogData({
    ...data,
    timestamp: new Date().toISOString(),
  }) : undefined;

  const entry: LogEntry = {
    timestamp: new Date(),
    level: "INFO",
    message,
    ...(cleanedData && {data: cleanedData}),
  };

  logger.info(message, cleanedData);
  await saveLogEntry(entry);
};
```

### Error Logging

```typescript
export const logError = async (
  error: GenericError | GenericObject,
  context: string
) => {
  const errorData = cleanLogData({
    stack: error.stack,
    code: error.code,
    ...(error as GenericObject),
    timestamp: new Date().toISOString(),
  });

  const entry: LogEntry = {
    timestamp: new Date(),
    level: "ERROR",
    message: error.message || "Unknown error",
    context,
    data: errorData,
  };

  logger.error(entry.message, errorData);
  await saveLogEntry(entry);
};
```

## Data Cleaning

### Clean Log Data Function

```typescript
function cleanLogData(
  data: Record<string, unknown>
): Record<string, unknown> {
  return Object.entries(data).reduce((acc, [key, value]) => {
    if (value !== undefined && value !== null) {
      if (value && typeof value === "object") {
        const cleaned = cleanLogData(value as Record<string, unknown>);
        if (Object.keys(cleaned).length > 0) {
          acc[key] = cleaned;
        }
      } else {
        acc[key] = value instanceof Date ? value.toISOString() : value;
      }
    }
    return acc;
  }, {} as Record<string, unknown>);
}
```

## Firestore Integration

### Save Log Entry

```typescript
async function saveLogEntry(entry: LogEntry): Promise<void> {
  const cleanEntry = {
    timestamp: entry.timestamp,
    level: entry.level,
    message: entry.message,
    ...(entry.context && {context: entry.context}),
    ...(entry.data && {data: cleanLogData(entry.data)}),
  };

  await db.collection(COLLECTION.LOGS).add(cleanEntry);
}
```

## Best Practices

1. **Structured Logging**:

   ```typescript
   await logInfo("Card sync completed", {
     cardsProcessed: 50,
     updatedCount: 10,
     duration: "5m30s",
     timestamp: new Date().toISOString()
   });
   ```

2. **Error Context**:

   ```typescript
   await logError(error, "cardSync:processGroup", {
     groupId: "23783",
     attempt: 2,
     operation: "imageProcessing"
   });
   ```

3. **Performance Monitoring**:

   ```typescript
   await logInfo("Operation timing", {
     operation: "imageCompression",
     duration: endTime - startTime,
     size: {
       before: originalSize,
       after: compressedSize
     }
   });
   ```

## Error Handling

### Common Patterns

```typescript
try {
  // Operation code
} catch (error) {
  await logError(
    error instanceof Error ? error : new Error("Unknown error"),
    "operationName",
    { contextData: "relevant info" }
  );
  throw error;
}
```

### Error with Context

```typescript
class DetailedError extends Error {
  constructor(
    message: string,
    public context: string,
    public metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = "DetailedError";
  }
}
```

## Query Examples

### Firestore Queries

```typescript
// Get recent errors
const recentErrors = await db
  .collection(COLLECTION.LOGS)
  .where("level", "==", "ERROR")
  .orderBy("timestamp", "desc")
  .limit(10)
  .get();

// Get logs by context
const contextLogs = await db
  .collection(COLLECTION.LOGS)
  .where("context", "==", "cardSync:processGroup")
  .get();
```

## Related Components

- [Error Handling](./error-handling)
- [Sync Logger](./sync-logger)
- [Progress Tracking](./progress)

## Troubleshooting

### Common Issues

1. Missing Logs:
   - Check log level configuration
   - Verify Firestore permissions
   - Check error handling implementation

2. Performance Impact:
   - Use appropriate log levels
   - Implement log batching for high-volume operations
   - Monitor Firestore usage

3. Data Size:
   - Implement log rotation
   - Clean sensitive data
   - Monitor storage usage
