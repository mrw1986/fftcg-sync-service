# System Monitoring Guide

## Overview

This guide covers the comprehensive monitoring setup for the FFTCG Sync Service,
 including performance tracking, error detection, and system health monitoring.

## Core Metrics

### Service Health

```typescript
interface HealthMetrics {
  status: "healthy" | "degraded" | "down";
  lastSync: Date;
  syncSuccess: boolean;
  responseTime: number;
  errorRate: number;
  resourceUsage: {
    memory: number;
    cpu: number;
    storage: number;
  };
}
```

### Performance Metrics

```typescript
interface PerformanceMetrics {
  syncDuration: number;
  processedItems: number;
  batchSize: number;
  cacheHitRate: number;
  imageProcessingTime: number;
  databaseLatency: number;
}
```

## Monitoring Components

### 1. Function Monitoring

#### Runtime Statistics

```typescript
const runtimeStats = {
  memory: process.memoryUsage(),
  uptime: process.uptime(),
  cpuUsage: process.cpuUsage(),
  timestamp: new Date()
};
```

#### Performance Tracking

```typescript
async function trackPerformance<T>(
  operation: () => Promise<T>,
  context: string
): Promise<T> {
  const start = Date.now();
  try {
    const result = await operation();
    const duration = Date.now() - start;
    
    await logInfo("Performance metrics", {
      operation: context,
      duration,
      timestamp: new Date(),
      memory: process.memoryUsage()
    });
    
    return result;
  } catch (error) {
    await logError(error, `${context}:performance`);
    throw error;
  }
}
```

### 2. Database Monitoring

#### Query Performance

```typescript
interface QueryMetrics {
  collection: string;
  operation: "read" | "write" | "delete";
  duration: number;
  documentCount: number;
  timestamp: Date;
}

async function trackQuery(
  queryFn: () => Promise<any>,
  collection: string,
  operation: "read" | "write" | "delete"
): Promise<any> {
  const start = Date.now();
  const result = await queryFn();
  const duration = Date.now() - start;

  await logInfo("Database operation", {
    collection,
    operation,
    duration,
    timestamp: new Date()
  });

  return result;
}
```

### 3. Cache Monitoring

```typescript
interface CacheMetrics {
  hits: number;
  misses: number;
  size: number;
  evictions: number;
  hitRate: number;
}

function getCacheMetrics(): CacheMetrics {
  return {
    hits: imageCache.getStats().hits,
    misses: imageCache.getStats().misses,
    size: imageCache.size,
    evictions: imageCache.evictions,
    hitRate: imageCache.getStats().hits / 
      (imageCache.getStats().hits + imageCache.getStats().misses)
  };
}
```

## Alert Configuration

### Error Rate Alerts

```typescript
const ERROR_THRESHOLDS = {
  WARNING: 0.05,  // 5% error rate
  CRITICAL: 0.10  // 10% error rate
};

async function checkErrorRate(): Promise<void> {
  const recentLogs = await db.collection(COLLECTION.LOGS)
    .where("timestamp", ">=", new Date(Date.now() - 3600000))
    .get();

  const errorRate = recentLogs.docs.filter(
    doc => doc.data().level === "ERROR"
  ).length / recentLogs.size;

  if (errorRate >= ERROR_THRESHOLDS.CRITICAL) {
    await logError(
      new Error(`Critical error rate: ${errorRate.toFixed(2)}`),
      "errorRate",
      { severity: "CRITICAL" }
    );
  } else if (errorRate >= ERROR_THRESHOLDS.WARNING) {
    await logWarning(
      `High error rate: ${errorRate.toFixed(2)}`,
      { severity: "WARNING" }
    );
  }
}
```

### Performance Alerts

```typescript
const PERFORMANCE_THRESHOLDS = {
  SYNC_DURATION: 30 * 60 * 1000,  // 30 minutes
  IMAGE_PROCESSING: 30 * 1000,    // 30 seconds
  DATABASE_LATENCY: 1000,         // 1 second
  MEMORY_USAGE: 900 * 1024 * 1024 // 900MB
};

async function checkPerformance(metrics: PerformanceMetrics): Promise<void> {
  if (metrics.syncDuration > PERFORMANCE_THRESHOLDS.SYNC_DURATION) {
    await logWarning("Sync duration exceeded threshold", {
      duration: metrics.syncDuration,
      threshold: PERFORMANCE_THRESHOLDS.SYNC_DURATION
    });
  }

  if (process.memoryUsage().heapUsed > PERFORMANCE_THRESHOLDS.MEMORY_USAGE) {
    await logWarning("High memory usage", {
      usage: process.memoryUsage().heapUsed,
      threshold: PERFORMANCE_THRESHOLDS.MEMORY_USAGE
    });
  }
}
```

## Logging System

### Structured Logging

```typescript
interface DetailedLog {
  timestamp: Date;
  level: "INFO" | "WARNING" | "ERROR";
  message: string;
  context: string;
  metadata?: Record<string, unknown>;
  metrics?: PerformanceMetrics;
  error?: Error;
}

async function logWithMetrics(
  log: DetailedLog
): Promise<void> {
  const enrichedLog = {
    ...log,
    system: {
      memory: process.memoryUsage(),
      uptime: process.uptime()
    }
  };

  await db.collection(COLLECTION.LOGS).add(enrichedLog);
}
```

### Log Analysis

```typescript
interface LogAnalysis {
  errorCount: number;
  warningCount: number;
  averageSyncDuration: number;
  failurePatterns: Record<string, number>;
  topErrors: Array<{
    message: string;
    count: number;
  }>;
}

async function analyzeLogs(
  startTime: Date,
  endTime: Date
): Promise<LogAnalysis> {
  const logs = await db.collection(COLLECTION.LOGS)
    .where("timestamp", ">=", startTime)
    .where("timestamp", "<=", endTime)
    .get();

  // Analysis implementation
}
```

## Resource Monitoring

### Storage Usage

```typescript
async function checkStorageUsage(): Promise<void> {
  const [files] = await storage
    .bucket(STORAGE.BUCKETS.CARD_IMAGES)
    .getFiles();

  const totalSize = files.reduce(
    (sum, file) => sum + parseInt(file.metadata.size || "0"),
    0
  );

  await logInfo("Storage metrics", {
    totalFiles: files.length,
    totalSize,
    timestamp: new Date()
  });
}
```

### Memory Usage

```typescript
function trackMemoryUsage(): void {
  const memoryUsage = process.memoryUsage();
  
  if (memoryUsage.heapUsed > PERFORMANCE_THRESHOLDS.MEMORY_USAGE) {
    global.gc?.();  // Trigger garbage collection if available
  }

  logInfo("Memory usage", {
    heap: memoryUsage.heapUsed,
    external: memoryUsage.external,
    timestamp: new Date()
  });
}
```

## Health Checks

### Automated Health Check

```typescript
async function performHealthCheck(): Promise<HealthMetrics> {
  const metrics: HealthMetrics = {
    status: "healthy",
    lastSync: new Date(),
    syncSuccess: true,
    responseTime: 0,
    errorRate: 0,
    resourceUsage: {
      memory: process.memoryUsage().heapUsed,
      cpu: process.cpuUsage().user,
      storage: 0
    }
  };

  // Perform checks and update metrics
  return metrics;
}
```

## Dashboard Integration

### Metrics Export

```typescript
interface DashboardMetrics {
  timestamp: Date;
  syncStats: {
    success: number;
    failure: number;
    duration: number;
  };
  resourceUsage: {
    memory: number;
    storage: number;
  };
  performance: {
    responseTime: number;
    errorRate: number;
  };
}

async function exportMetrics(): Promise<void> {
  const metrics: DashboardMetrics = {
    timestamp: new Date(),
    // Collect metrics
  };

  await db.collection("dashboardMetrics").add(metrics);
}
```

## Best Practices

### Monitoring

- Regular health checks
- Automated alerting
- Performance tracking
- Resource monitoring

### Logging

- Structured log format
- Appropriate log levels
- Regular log analysis
- Log rotation

### Performance

- Track critical metrics
- Monitor resource usage
- Set appropriate thresholds
- Implement auto-scaling

## Related Documentation

- [Error Handling](/utils/error-handling)
- [Logging System](/utils/logging)
- [Deployment Guide](/deployment/)
- [Troubleshooting Guide](/troubleshooting/common-issues)
