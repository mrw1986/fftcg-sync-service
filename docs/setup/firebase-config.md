# Firebase Configuration Guide

## Overview

This guide details the Firebase configuration for the FFTCG Sync Service,
 including Cloud Functions setup, database rules, storage configuration, and
  security settings.

## Cloud Functions Configuration

### Runtime Options

```typescript
export const runtimeOpts = {
  timeoutSeconds: 540,
  memory: "1GiB",
} as const;
```

### Scheduled Functions

#### Card Sync Schedule

```typescript
export const scheduledCardSync = onSchedule({
  schedule: "0 21 * * *",  // Daily at 21:00 UTC
  timeZone: "UTC",
  memory: runtimeOpts.memory,
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  retryCount: 3,
});
```

#### Price Sync Schedule

```typescript
export const scheduledPriceSync = onSchedule({
  schedule: "30 21 * * *", // Daily at 21:30 UTC
  timeZone: "UTC",
  memory: runtimeOpts.memory,
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  retryCount: 3,
});
```

### HTTP Functions

#### Request Configuration

```typescript
export const testCardSync = onRequest({
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  memory: runtimeOpts.memory,
  maxInstances: 1,
});
```

## Firestore Configuration

### Collections Structure

```typescript
export const COLLECTION = {
  CARDS: "cards",           // Card information
  PRICES: "prices",         // Price data
  SYNC_METADATA: "syncMetadata",  // Sync operation logs
  LOGS: "logs",            // System logs
  CARD_HASHES: "cardHashes",  // Card data version control
  PRICE_HASHES: "priceHashes",  // Price data version control
  IMAGE_METADATA: "imageMetadata",  // Image processing metadata
};
```

### Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Card collection rules
    match /cards/{cardId} {
      allow read: if true;
      allow write: if request.auth != null 
        && request.auth.token.admin == true;
    }

    // Price collection rules
    match /prices/{priceId} {
      allow read: if true;
      allow write: if request.auth != null 
        && request.auth.token.admin == true;
    }

    // Sync metadata rules
    match /syncMetadata/{docId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null 
        && request.auth.token.admin == true;
    }
  }
}
```

## Storage Configuration

### Bucket Configuration

```typescript
export const STORAGE = {
  BUCKETS: {
    CARD_IMAGES: "fftcg-sync-service.firebasestorage.app",
  },
  PATHS: {
    IMAGES: "card-images",
  },
};
```

### Storage Rules

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /card-images/{groupId}/{imageId} {
      allow read: if true;
      allow write: if request.auth != null 
        && request.auth.token.admin == true
        && request.resource.size < 5 * 1024 * 1024
        && request.resource.contentType.matches('image/jpeg');
    }
  }
}
```

## Authentication Configuration

### Service Account

```typescript
async function initializeFirebase(): Promise<FirebaseFirestore.Firestore> {
  const serviceAccountPath = path.resolve(__dirname, "../service_account_key.json");
  const serviceAccount = JSON.parse(
    await fs.readFile(serviceAccountPath, "utf8")
  );

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }

  return admin.firestore();
}
```

## Environment Configuration

### Required Environment Variables

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-storage-bucket
FIREBASE_SERVICE_ACCOUNT_PATH=path/to/service-account.json
```

### Optional Environment Variables

```env
FIREBASE_REGION=us-central1
FIREBASE_MEMORY_ALLOCATION=1GB
FIREBASE_TIMEOUT=540
```

## Performance Optimization

### Function Configuration

- Memory allocation: 1GB per function
- Timeout: 540 seconds
- Instance limits: Single instance per function
- Retry count: 3 (scheduled functions)

### Database Optimization

- Proper indexing
- Batch operations
- Caching implementation
- Query optimization

## Monitoring Setup

### Logging Configuration

```typescript
const db = admin.firestore();
db.settings({
  ignoreUndefinedProperties: true,
  timestampsInSnapshots: true,
});
```

### Health Check Function

```typescript
export const healthCheck = onRequest({
  timeoutSeconds: 10,
  memory: "128MiB",
}, async (_req: Request, res: Response) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});
```

## Deployment Configuration

### Firebase Configuration File

```json
{
  "functions": {
    "source": "functions",
    "runtime": "nodejs18",
    "predeploy": [
      "npm --prefix \"$RESOURCE_DIR\" run lint",
      "npm --prefix \"$RESOURCE_DIR\" run build"
    ]
  },
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "storage": {
    "rules": "storage.rules"
  }
}
```

## Best Practices

### Security

- Enable Authentication
- Implement proper IAM roles
- Use secure environment variables
- Regular security audits

### Performance

- Optimize function memory
- Implement proper caching
- Use batch operations
- Monitor resource usage

### Maintenance

- Regular deployment checks
- Log monitoring
- Error tracking
- Version control

## Related Documentation

- [Installation Guide](/setup/installation)
- [Configuration Guide](/setup/configuration)
- [Security Guidelines](/security)
- [Performance Guide](/performance)
