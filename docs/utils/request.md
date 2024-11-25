# Request Handler Utility

## Overview

The Request Handler (`request.ts`) provides a robust HTTP request implementation
 with built-in retry logic, error handling, and rate limiting capabilities.
  It's primarily used for communicating with external APIs, particularly the
   TCGPlayer API.

## Core Configuration

### Constants

```typescript
export const MAX_RETRIES = 3;
export const BASE_DELAY = 1000; // 1 second base delay

export interface RequestOptions {
  retryCount?: number;
  customDelay?: number;
  metadata?: Record<string, unknown>;
}
```

### Error Class

```typescript
export class RequestError extends Error {
  constructor(
    message: string,
    public originalError: Error,
    public context: string,
    public metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = "RequestError";
  }
}
```

## Core Functionality

### Main Request Function

```typescript
export async function makeRequest<T>(
  endpoint: string,
  baseUrl: string,
  options: RequestOptions = {}
): Promise<T> {
  const {retryCount = 0, customDelay = BASE_DELAY} = options;

  try {
    await new Promise((resolve) => setTimeout(resolve, customDelay));
    const url = `${baseUrl}/${endpoint}`;
    const response = await axios.get<T>(url, {
      timeout: 30000, // 30 seconds timeout
      headers: {
        "Accept": "application/json",
        "User-Agent": "FFTCG-Sync-Service/1.0",
      },
    });

    return response.data;
  } catch (error) {
    if (retryCount < MAX_RETRIES - 1 && error instanceof AxiosError) {
      const delay = Math.pow(2, retryCount) * BASE_DELAY;
      await logWarning(`Request failed, retrying in ${delay}ms...`, {
        url: `${baseUrl}/${endpoint}`,
        attempt: retryCount + 1,
        maxRetries: MAX_RETRIES,
        error: error.message,
        ...options.metadata,
      });

      return makeRequest<T>(endpoint, baseUrl, {
        ...options,
        retryCount: retryCount + 1,
        customDelay: delay,
      });
    }

    throw new RequestError(
      `Request failed after ${retryCount + 1} attempts`,
      error as Error,
      endpoint,
      options.metadata
    );
  }
}
```

## Usage Examples

### Basic Request

```typescript
const cardData = await makeRequest<CardProduct>(
  `${FFTCG_CATEGORY_ID}/${groupId}/products`,
  BASE_URL,
  { metadata: { groupId, operation: "fetchCard" } }
);
```

### With Retry Logic

```typescript
try {
  const data = await makeRequest<ApiResponse>(
    endpoint,
    baseUrl,
    {
      retryCount: 0,
      customDelay: 2000,
      metadata: { context: "sync" }
    }
  );
} catch (error) {
  if (error instanceof RequestError) {
    console.error(`Request failed: ${error.message}`);
    console.error(`Context: ${error.context}`);
  }
}
```

## Error Handling

### Error Types

```typescript
type RequestErrorType = 
  | "NETWORK_ERROR"
  | "TIMEOUT_ERROR"
  | "API_ERROR"
  | "VALIDATION_ERROR";

interface EnhancedRequestError extends RequestError {
  type: RequestErrorType;
  statusCode?: number;
  responseData?: unknown;
}
```

### Error Processing

```typescript
function processRequestError(error: unknown): EnhancedRequestError {
  if (error instanceof AxiosError) {
    return {
      message: error.message,
      type: error.code === "ECONNABORTED" ? "TIMEOUT_ERROR" : "NETWORK_ERROR",
      statusCode: error.response?.status,
      responseData: error.response?.data,
      context: "request",
    };
  }
  return {
    message: "Unknown request error",
    type: "API_ERROR",
    context: "request",
  };
}
```

## Retry Strategy

### Exponential Backoff

```typescript
function calculateDelay(attempt: number): number {
  return Math.min(
    Math.pow(2, attempt) * BASE_DELAY,
    30000 // Max 30 seconds
  );
}
```

### Retry Conditions

```typescript
function shouldRetry(error: Error, attempt: number): boolean {
  if (attempt >= MAX_RETRIES) return false;
  
  if (error instanceof AxiosError) {
    // Retry on network errors or 5xx responses
    return (
      !error.response || 
      (error.response.status >= 500 && error.response.status < 600)
    );
  }
  
  return false;
}
```

## Rate Limiting

### Token Bucket Implementation

```typescript
class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  
  constructor(
    private maxTokens: number,
    private refillRate: number,
    private refillInterval: number
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<boolean> {
    this.refillTokens();
    
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    
    return false;
  }

  private refillTokens(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = Math.floor(
      (timePassed / this.refillInterval) * this.refillRate
    );
    
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}
```

## Monitoring and Logging

### Request Logging

```typescript
async function logRequest(
  endpoint: string,
  options: RequestOptions,
  startTime: number
): Promise<void> {
  const duration = Date.now() - startTime;
  
  await logInfo("API Request", {
    endpoint,
    duration,
    attempt: options.retryCount || 0,
    ...options.metadata
  });
}
```

### Performance Tracking

```typescript
interface RequestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  retryCount: number;
}

class RequestMetricsTracker {
  private metrics: RequestMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    retryCount: 0
  };

  trackRequest(duration: number, successful: boolean, retries: number): void {
    this.metrics.totalRequests++;
    if (successful) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }
    this.metrics.retryCount += retries;
    this.metrics.averageResponseTime = 
      (this.metrics.averageResponseTime * (this.metrics.totalRequests - 1)
       + duration) / 
      this.metrics.totalRequests;
  }
}
```

## Best Practices

### Request Configuration

- Set appropriate timeouts
- Use proper headers
- Implement retry logic
- Handle rate limits

### Error Management

- Implement proper error types
- Use detailed error messages
- Track error patterns
- Log all failures

### Performance

- Monitor response times
- Track retry counts
- Implement caching
- Use rate limiting

## Related Documentation

- [Error Handling](/utils/error-handling)
- [Logging System](/utils/logging)
- [Cache System](/utils/cache)
- [TCGPlayer Integration](/integrations/tcgplayer)
