# Testing Guide

## Overview

This guide covers the testing infrastructure and procedures for the FFTCG Sync
 Service. The testing suite includes endpoint testing, image processing validation,
  and data integrity checks.

## Test Categories

### 1. Endpoint Testing

- API endpoint validation
- Response format verification
- Authentication testing
- Error handling verification

### 2. Image Processing Tests

- Compression validation
- Resolution checks
- Cache operations
- Storage integration

### 3. Data Validation

- Card data integrity
- Price data accuracy
- Metadata validation
- Collection structure verification

## Running Tests

### Prerequisites

- Node.js 18 or higher
- Firebase CLI
- Service account credentials configured

### Common Test Commands

```bash
# Run all tests
npm run test

# Test image processing
npm run test:images

# Validate sync operations
npm run validate-sync

# Test endpoints
npm run test:endpoints
```

### Test Configuration

```typescript
// Test environment configuration
const TEST_CONFIG = {
  FIREBASE_REGION: "us-central1",
  PROJECT_ID: "fftcg-sync-service",
  TEST_GROUP_ID: "23783",
  SAMPLE_PRODUCT_ID: 477236
};
```

## Test Architecture

### Directory Structure

```text
src/test/
├── testEndpoints.ts     # API endpoint tests
├── testImageHandler.ts  # Image processing tests
├── testSync.ts         # Sync operation tests
└── validateSync.ts     # Data validation tests
```

### Test Data Management

- Sample data sets
- Test fixtures
- Mock responses
- Validation schemas

## Continuous Integration

### Automated Testing

- Pre-deployment validation
- Scheduled test runs
- Error reporting
- Performance benchmarking

### Test Environment

```typescript
// Environment configuration
const testEnv = {
  isProduction: false,
  useEmulator: true,
  timeoutSeconds: 540,
  memory: "1GiB"
};
```

## Best Practices

### 1. Test Isolation

- Independent test cases
- Clean state between tests
- Proper teardown
- Environment isolation

### 2. Error Handling

- Comprehensive error checking
- Detailed error logging
- Recovery procedures
- Cleanup on failure

### 3. Performance Testing

- Response time monitoring
- Resource usage tracking
- Concurrency testing
- Rate limit verification

## Troubleshooting

### Common Issues

1. Authentication Failures
   - Check service account configuration
   - Verify Firebase project settings
   - Confirm API credentials

2. Timeout Issues
   - Adjust timeouts for long-running tests
   - Monitor network conditions
   - Check resource constraints

3. Data Inconsistencies
   - Verify test data integrity
   - Check database connections
   - Validate schema changes

## Related Documentation

- [Endpoint Tests](./endpoints)
- [Image Processing Tests](./images)
- [Validation Tests](./validation)
- [Configuration Guide](/setup/configuration)
