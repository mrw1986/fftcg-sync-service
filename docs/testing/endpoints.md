# Endpoint Testing Guide

## Overview

This guide covers comprehensive testing of the FFTCG Sync Service API endpoints
 using the `testEndpoints.ts` test suite.

## Test Configuration

### Base Configuration

```typescript
const FIREBASE_REGION = "us-central1";
const PROJECT_ID = "fftcg-sync-service";
const BASE_URL = `https://${FIREBASE_REGION}-${PROJECT_ID}.cloudfunctions.net`;
```

### Response Interface

```typescript
interface SyncResponse {
  lastSync: Date;
  status: string;
  cardCount: number;
  type: string;
  groupsProcessed: number;
  groupsUpdated: number;
  errors: string[];
  duration?: number;
}
```

## Endpoint Tests

### Card Synchronization Tests

#### Test Card Sync

```typescript
async function testCardSync() {
  const response = await axios.get<SyncResponse>(
    `${BASE_URL}/testCardSync`,
    {
      params: {
        limit: 5,
        dryRun: true,
        groupId: "23783"
      }
    }
  );
  
  console.log("Card sync results:", JSON.stringify(response.data, null, 2));
  return response.data;
}
```

#### Manual Card Sync

```typescript
async function testManualCardSync() {
  const response = await axios.get<SyncResponse>(
    `${BASE_URL}/manualCardSync`
  );
  
  console.log("Manual sync results:", JSON.stringify(response.data, null, 2));
  return response.data;
}
```

### Price Synchronization Tests

#### Test Price Sync

```typescript
async function testPriceSync() {
  const response = await axios.get<SyncResponse>(
    `${BASE_URL}/testPriceSync`,
    {
      params: {
        groupId: "23783",
        dryRun: true,
        limit: 5,
        showAll: true
      }
    }
  );
  
  console.log("Price sync results:", JSON.stringify(response.data, null, 2));
  return response.data;
}
```

### Health Check Tests

```typescript
async function testHealthCheck() {
  const response = await axios.get(
    `${BASE_URL}/healthCheck`
  );
  
  console.log("Health check response:", JSON.stringify(response.data, null, 2));
  return response.data;
}
```

## Error Handling Tests

### Authentication Errors

```typescript
async function testAuthenticationError() {
  try {
    await axios.get(`${BASE_URL}/manualCardSync`, {
      headers: { Authorization: 'Bearer invalid_token' }
    });
  } catch (error) {
    if (isAxiosError(error)) {
      console.error("Auth error:", error.response?.data);
      console.error("Status:", error.response?.status);
    }
  }
}
```

### Rate Limiting Tests

```typescript
async function testRateLimiting() {
  const requests = Array(10).fill(null).map(() => 
    axios.get(`${BASE_URL}/testCardSync`)
  );
  
  const results = await Promise.allSettled(requests);
  const rejected = results.filter(r => r.status === 'rejected');
  console.log(`Rate limit test: ${rejected.length} requests rejected`);
}
```

## Test Utilities

### Response Validation

```typescript
function validateSyncResponse(response: SyncResponse): boolean {
  return (
    response.status !== undefined &&
    typeof response.cardCount === 'number' &&
    Array.isArray(response.errors) &&
    ['manual', 'scheduled'].includes(response.type)
  );
}
```

### Test Runner

```typescript
async function runEndpointTests() {
  try {
    console.log("Starting endpoint tests...");

    // Test card sync
    const cardSyncResult = await testCardSync();
    console.assert(validateSyncResponse(cardSyncResult));

    // Test price sync
    const priceSyncResult = await testPriceSync();
    console.assert(validateSyncResponse(priceSyncResult));

    // Test health check
    const healthCheckResult = await testHealthCheck();
    console.assert(healthCheckResult.status === "healthy");

    console.log("All tests completed!");
  } catch (error) {
    console.error("Test suite failed:", error);
    process.exit(1);
  }
}
```

## Test Scenarios

### Success Scenarios

1. Basic Card Sync

await testCardSync();

1. Full Price Sync

await testPriceSync();

1. Health Check

await testHealthCheck();

### Error Scenarios

1. Invalid Group ID

await testCardSync({
  groupId: "invalid_group"
});

1. Rate Limit Exceeded

await testRateLimiting();

1. Authentication Failure

await testAuthenticationError();

## Test Reports

### Success Report Example

```json
{
  "lastSync": "2024-11-23T01:47:16.617Z",
  "status": "success",
  "cardCount": 5,
  "type": "manual",
  "groupsProcessed": 1,
  "groupsUpdated": 1,
  "errors": [],
  "duration": 2.5
}
```

### Error Report Example

```json
{
  "error": "Group not found",
  "code": "GROUP_NOT_FOUND",
  "details": {
    "groupId": "invalid_group"
  },
  "timestamp": "2024-11-23T01:47:16.617Z"
}
```

## Best Practices

### Test Organization

- Group related tests
- Maintain test independence
- Clean up after tests
- Use descriptive names

### Error Handling

- Test error scenarios
- Validate error responses
- Check status codes
- Verify error messages

### Performance

- Monitor response times
- Test concurrent requests
- Verify rate limiting
- Check resource usage

## Related Documentation

- [API Documentation](/api/)
- [Error Handling](/utils/error-handling)
- [Testing Overview](/testing/)
- [Configuration Guide](/setup/configuration)
