# Frequently Asked Questions

## General

### What is FFTCG Sync Service?

A Firebase-based service that synchronizes Final Fantasy Trading Card Game data
 from TCGplayer, including card information, prices, and images.

### What are the system requirements?

- Node.js 18 or higher
- Firebase CLI
- Firebase project with Firestore and Storage enabled
- 1GB minimum memory allocation
- Sufficient storage quota for card images

### How often does the service sync data?

- Cards: Daily at 21:00 UTC
- Prices: Daily at 21:30 UTC
- Images: During card synchronization

## Synchronization

### How do I manually trigger a sync?

```typescript
// For cards
await syncCards({
  dryRun: false,
  limit: undefined,
  groupId: undefined
});

// For prices
await syncPrices({
  dryRun: false,
  limit: undefined,
  groupId: undefined
});
```

### What is dry run mode?

Dry run mode (`dryRun: true`) allows you to test synchronization without making
 any changes to the database. It's useful for:

- Validating data before actual sync
- Testing configuration changes
- Debugging sync issues

### How do I sync specific card groups?

```typescript
const options = {
  groupId: "23783",  // Specific group ID
  dryRun: false
};
await syncCards(options);
```

### Why are some syncs skipped?

Syncs may be skipped when:

- Data hasn't changed (verified via hash comparison)
- Rate limits are reached
- Previous sync is still in progress
- Network issues occur

## Image Processing

### What image formats are supported?

Currently, only JPEG images are supported. The service:

- Validates JPEG format
- Checks file signatures
- Enforces size limits (5MB max)

### How are images optimized?

Images are processed in two ways:

- Standard resolution (200px width)
- High resolution (400px width)

Both versions are:

- Compressed using mozjpeg
- Progressive loading enabled
- Quality optimized (85-90%)

### Why are some images not updating?

Images might not update if:

- Hash matches existing image
- Validation fails
- Storage quota is exceeded
- Network errors occur

## Firebase Integration

### How is data stored in Firestore?

Data is organized in collections:

- `cards`: Card information
- `prices`: Price history
- `cardHashes`: Change detection
- `priceHashes`: Price updates
- `imageMetadata`: Image information
- `syncMetadata`: Sync status
- `logs`: System logs

### How are images stored?

Images are stored in Firebase Storage:

- Path format: `card-images/{groupId}/{productId}_{resolution}.jpg`
- Metadata includes hash and timestamp
- URLs are signed for long-term access

### What happens if Firebase quotas are exceeded?

The service will:

1. Log the quota error
2. Pause operations
3. Retry with exponential backoff
4. Skip non-critical updates

## Rate Limiting

### How does rate limiting work?

```typescript
const rateLimiter = {
  tokens: 100,
  refillRate: 10,
  interval: 1000
};
```

- Token bucket algorithm
- Configurable limits
- Automatic retry handling

### What are the default rate limits?

- API requests: 100 per minute
- Image processing: 25 concurrent operations
- Database writes: Batch size of 500
- Storage operations: 10 concurrent uploads

### How do I adjust rate limits?

Modify the configuration in your environment:

```typescript
const runtimeOpts = {
  timeoutSeconds: 540,
  memory: "1GiB",
} as const;
```

## Caching

### What is cached?

- Card data: 1 hour TTL
- Image metadata: 1 hour TTL
- Image buffers: 5 minutes TTL
- API responses: Request-specific TTL

### How does the cache hierarchy work?

1. Memory cache (L1)
2. LRU cache (L2)
3. Firestore (persistent)

### How do I clear the cache?

```typescript
// Clear specific cache
imageCache.clear();
cardCache.clear();

// Clear all caches
await clearAllCaches();
```

## Error Handling

### How are errors logged?

```typescript
// Error logging with context
await logDetailedError(
  error,
  "operationContext",
  { metadata: "details" },
  "ERROR"
);
```

### What retry mechanisms are in place?

- Maximum 3 retries
- Exponential backoff
- Configurable delay
- Operation-specific handling

### How do I debug sync failures?

1. Check sync metadata collection
2. Review error logs
3. Use dry run mode
4. Monitor rate limits

## Deployment

### How do I deploy updates?

```bash
# Deploy all functions
npm run deploy

# Deploy specific function
firebase deploy --only functions:functionName
```

### How do I test before deployment?

```bash
# Run tests
npm run test:images

# Validate sync
npm run validate-sync

# Local emulation
npm run serve
```

### What's the deployment rollback process?

1. Use Firebase Console
2. Select previous version
3. Click "Rollback"
4. Verify functionality

## Monitoring

### How do I monitor sync status?

1. Check sync metadata collection
2. Review logging dashboard
3. Use health check endpoint
4. Monitor performance metrics

### What metrics are available?

- Sync completion rates
- Processing times
- Error rates
- Cache hit rates
- Storage usage
- API response times

### How do I set up alerts?

Configure Firebase Alert conditions for:

- Function failures
- High error rates
- Quota approaching limits
- Sync failures
- Performance degradation
