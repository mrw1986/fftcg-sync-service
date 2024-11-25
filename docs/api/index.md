# API Documentation

## Overview

The FFTCG Sync Service API provides endpoints for card and price synchronization,
 with support for both testing and production operations. All endpoints are
  HTTPS-only and most require Firebase authentication.

## API Authentication

The service uses Firebase Authentication. Protected endpoints require a valid
 Firebase ID token. For implementation details, see our [Security Guidelines](/security).

```typescript
// Get Firebase auth token
const getAuthToken = async (): Promise<string | null> => {
  const auth = getAuth();
  const user = auth.currentUser;
  if (user) {
    return await user.getIdToken();
  }
  return null;
};

// Use in requests
const headers = {
  'Authorization': `Bearer ${await getAuthToken()}`,
  'Content-Type': 'application/json'
};
```

## Base URL

```http
https://us-central1-fftcg-sync-service.cloudfunctions.net
```

## Endpoints

### Card Synchronization

For detailed implementation, see [Card Sync Service](/services/card-sync).

#### Test Card Sync

Test card synchronization with configurable options.

```http
GET /testCardSync
```

Query Parameters:

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| dryRun | boolean | No | true | Run without making changes |
| limit | number | No | 5 | Maximum number of cards to process |
| groupId | string | No | - | Process specific group only |

Response:

```typescript
interface SyncMetadata {
  lastSync: Date;
  status: "in_progress" | "success" | "failed" | "completed_with_errors";
  cardCount: number;
  type: "manual" | "scheduled";
  groupsProcessed: number;
  groupsUpdated: number;
  errors: string[];
  duration?: number;
  imagesProcessed?: number;
  imagesUpdated?: number;
}
```

#### Manual Card Sync

Trigger a full card synchronization with production settings.

```http
GET /manualCardSync
```

Response: Same as Test Card Sync

### Price Synchronization

For detailed implementation, see [Price Sync Service](/services/price-sync).

#### Test Price Sync

Test price synchronization with configurable options.

```http
GET /testPriceSync
```

Query Parameters:

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| dryRun | boolean | No | true | Run without making changes |
| limit | number | No | - | Maximum number of prices to process |
| groupId | string | No | - | Process specific group only |
| productId | number | No | - | Process specific product only |
| showAll | boolean | No | false | Show all prices, including unchanged |

Response:

```typescript
interface SyncMetadata {
  lastSync: Date;
  status: string;
  cardCount: number;
  type: "manual" | "scheduled";
  groupsProcessed: number;
  groupsUpdated: number;
  errors: string[];
  duration?: number;
}
```

#### Manual Price Sync

Trigger a full price synchronization with production settings.

```http
GET /manualPriceSync
```

Response: Same as Test Price Sync

### System Health

For monitoring configuration, see our [Monitoring Guide](/monitoring/index).

#### Health Check

Check system health status.

```http
GET /healthCheck
```

Response:

```json
{
  "status": "healthy",
  "timestamp": "2024-11-23T01:47:16.617Z",
  "version": "1.0.0"
}
```

## Interactive API Explorer

Test the API endpoints using our interactive explorer:

<ApiExplorer />

## Runtime Configuration

For detailed configuration options, see the [Configuration Guide](/setup/configuration).

```typescript
export const runtimeOpts = {
  timeoutSeconds: 540,
  memory: "1GiB",
} as const;
```

Function-specific configurations:

- Scheduled Functions: 3 retry attempts
- Request Functions: Single instance limit
- Health Check: 10-second timeout, 128MB memory

## Rate Limiting

For detailed rate limiting implementation, see our [Monitoring Guide](/monitoring/index).

- Function timeouts: 540 seconds
- Memory allocation: 1GB per function
- Maximum instances: 1 per function
- Retry count: 3 (for scheduled functions)
- Request delay: Exponential backoff starting at 1000ms

## Error Response Format

For complete error handling documentation, see [Error Handling](/utils/error-handling).

```typescript
interface ErrorResponse {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}
```

Example error:

```json
{
  "error": "Group not found",
  "code": "GROUP_NOT_FOUND",
  "details": {
    "groupId": "23783"
  },
  "timestamp": "2024-11-23T01:47:16.617Z"
}
```

## Data Models

For complete type definitions, see [Types Reference](/reference/types).

### Card Product

```typescript
interface CardProduct {
  productId: number;
  name: string;
  cleanName: string;
  imageUrl: string;
  storageImageUrl?: string;
  categoryId: number;
  groupId: number;
  url: string;
  modifiedOn: string;
  imageCount: number;
  imageMetadata?: ImageMetadata;
  extendedData: Array<{
    name: string;
    displayName: string;
    value: string;
  }>;
}
```

### Card Price

```typescript
interface CardPrice {
  productId: number;
  lowPrice: number;
  midPrice: number;
  highPrice: number;
  marketPrice: number | null;
  directLowPrice: number | null;
  subTypeName: "Normal" | "Foil";
}
```

### Image Metadata

For image handling details, see [Image Handler](/utils/image-handler).

```typescript
interface ImageMetadata {
  contentType: string;
  size: number;
  updated: Date;
  hash: string;
  originalUrl: string;
  highResUrl: string;
  originalSize?: number;
  highResSize?: number;
}
```

## Implementation Guidelines

### Request Rate Limiting

For detailed implementation, see [Request Handler](/utils/request).

```typescript
// Implement delays between requests
await new Promise(resolve => setTimeout(resolve, 1000));

// Use exponential backoff
const delay = Math.pow(2, retryCount) * 1000;
```

### Error Handling Implementation

For detailed error handling, see [Error Handling](/utils/error-handling).

```typescript
try {
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return await response.json();
} catch (error) {
  console.error('API request failed:', error);
  throw error;
}
```

### Authentication Implementation

For security implementation details, see [Security Guidelines](/security).

```typescript
// Check token expiration
const token = await getAuthToken();
if (!token) {
  throw new Error('Authentication required');
}

// Include token in requests
const headers = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
};
```

## Support

For API support:

- Check the [Troubleshooting Guide](/troubleshooting)
- Review [System Status](https://status.fftcg-sync-service.web.app)
- Contact support team
- See [Common Issues](/troubleshooting/common-issues)

## Additional Resources

- [Installation Guide](/setup/installation)
- [Configuration Guide](/setup/configuration)
- [Deployment Guide](/deployment/)
- [Monitoring Guide](/monitoring/index)
