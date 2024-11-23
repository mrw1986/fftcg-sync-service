# Request Handler Utility

## Overview

The Request Handler (`request.ts`) manages HTTP requests with built-in retry logic, rate limiting, and error handling. It provides a robust foundation for external API communications, particularly with TCGplayer's API.

## Core Features

- Configurable retry logic
- Rate limiting
- Request queuing
- Response caching
- Error standardization
- Request logging

## Configuration

### Request Settings

```typescript
interface RequestOptions {
  baseURL?: string;
  timeout?: number;
  retries?: number;
  backoff?: number;
  headers?: Record<string, string>;
  cache?: boolean;
  validateStatus?: (status: number) => boolean;
}
```

### Default Configuration

```typescript
const DEFAULT_OPTIONS: RequestOptions = {
  timeout: 10000,
  retries: 3,
  backoff: 1000,
  cache: true,
  validateStatus: (status: number) => status >= 200 && status < 300
};
```

## Main Methods

### HTTP Methods

```typescript
class RequestHandler {
  async get<T>(
    url: string, 
    options?: RequestOptions
  ): Promise<T>

  async post<T>(
    url: string, 
    data: unknown, 
    options?: RequestOptions
  ): Promise<T>

  async put<T>(
    url: string, 
    data: unknown, 
    options?: RequestOptions
  ): Promise<T>

  async delete<T>(
    url: string, 
    options?: RequestOptions
  ): Promise<T>
}
```

## Implementation Examples

### Basic Request

```typescript
const requestHandler = new RequestHandler({
  baseURL: "https://api.tcgplayer.com",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  }
});

const data = await requestHandler.get<CardResponse>(
  `/catalog/products/${productId}`
);
```

### With Retry Logic

```typescript
const fetchWithRetry = async <T>(
  url: string,
  options: RequestOptions = {}
): Promise<T> => {
  let attempt = 0;
 
  while (attempt < (options.retries || DEFAULT_OPTIONS.retries)) {
    try {
      return await requestHandler.get<T>(url, options);
    } catch (error) {
      attempt++;
      if (attempt === options.retries) throw error;
     
      const delay = Math.pow(2, attempt) * options.backoff;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
 
  throw new Error("Max retries exceeded");
};
```

## Error Handling

### Request Error

```typescript
export class RequestError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public response?: unknown
  ) {
    super(message);
    this.name = "RequestError";
  }
}
```

### Error Processing

```typescript
private processError(error: unknown): never {
  if (axios.isAxiosError(error)) {
    throw new RequestError(
      error.message,
      error.response?.status,
      error.code,
      error.response?.data
    );
  }
 
  throw error;
}
```

## Rate Limiting

### Rate Limiter

```typescript
class RateLimiter {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;
 
  async add<T>(
    request: () => Promise<T>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await request();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
     
      if (!this.processing) {
        this.processQueue();
      }
    });
  }
}
```

### Queue Processing

```typescript
private async processQueue(): Promise<void> {
  if (this.queue.length === 0) {
    this.processing = false;
    return;
  }
 
  this.processing = true;
  const request = this.queue.shift();
 
  if (request) {
    await request();
    await new Promise(resolve => 
      setTimeout(resolve, this.requestDelay)
    );
    await this.processQueue();
  }
}
```

## Response Caching

### Cache Implementation

```typescript
class ResponseCache {
  private cache = new Map<string, CacheEntry>();
 
  set(key: string, value: unknown, ttl: number): void {
    this.cache.set(key, {
      value,
      expiry: Date.now() + ttl
    });
  }
 
  get(key: string): unknown | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
   
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }
   
    return entry.value;
  }
}
```

## Usage Guidelines

### Basic Usage

```typescript
const handler = new RequestHandler();

// GET request
const data = await handler.get<DataType>(url);

// POST request
const response = await handler.post<ResponseType>(
  url,
  requestData
);
```

### With Options

```typescript
const response = await handler.get<CardData>(url, {
  timeout: 5000,
  retries: 2,
  cache: true,
  headers: {
    "Authorization": `Bearer ${token}`
  }
});
```

## Best Practices

### Error Management

- Implement proper error handling
- Use retry logic appropriately
- Log failed requests

### Performance

- Enable caching when appropriate
- Use rate limiting
- Monitor response times

### Security

- Validate URLs
- Secure sensitive headers
- Monitor request patterns

## Related Components

- [Error Handler](./error-handling)
- [Logger](./logging)
- [Cache System](./cache)

## Troubleshooting

### Common Issues

1. Request Timeouts:
   - Check network connectivity
   - Verify timeout settings
   - Monitor server response times

2. Rate Limiting:
   - Review rate limit settings
   - Check queue processing
   - Monitor request patterns

3. Cache Issues:
   - Verify cache configuration
   - Check TTL settings
   - Monitor cache hit rates
