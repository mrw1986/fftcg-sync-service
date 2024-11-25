# Deployment Guide

## Overview

This guide covers the complete deployment process for the FFTCG Sync Service,
 including initial setup, Firebase configuration, and continuous deployment
  practices. For base configuration, see our [Configuration Guide](/setup/configuration).

## Prerequisites

- Node.js 18 or higher
- Firebase CLI installed (`npm install -g firebase-tools`)
- Firebase project created with:
  - Cloud Functions enabled
  - Firestore Database
  - Cloud Storage
  - Authentication configured

See [Installation Guide](/setup/installation) for detailed setup instructions.

## Initial Setup

### 1. Firebase Project Configuration

```bash
# Login to Firebase
firebase login

# Initialize project
firebase init

# Select required features:
# - Functions
# - Firestore
# - Storage
```

### 2. Environment Configuration

Create `.env` file:

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-storage-bucket
FIREBASE_REGION=us-central1
FIREBASE_MEMORY_ALLOCATION=1GB
FIREBASE_TIMEOUT=540
```

### 3. Service Account Setup

1. Generate service account key from Firebase Console
2. Save as `service_account_key.json`
3. Configure environment variable:

```env
FIREBASE_SERVICE_ACCOUNT_PATH=path/to/service_account_key.json
```

## Deployment Process

### 1. Build and Test

```bash
# Install dependencies
npm install

# Run linting
npm run lint

# Fix linting issues
npm run lint:fix

# Build the project
npm run build
```

### 2. Function Deployment

```bash
# Deploy all functions
npm run deploy

# Deploy specific function
firebase deploy --only functions:functionName
```

### 3. Security Rules Deployment

For detailed security implementation, see [Security Guidelines](/security).

#### Firestore Rules

```typescript
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /cards/{cardId} {
      allow read: if true;
      allow write: if request.auth != null 
        && request.auth.token.admin == true;
    }
    
    match /prices/{priceId} {
      allow read: if true;
      allow write: if request.auth != null 
        && request.auth.token.admin == true;
    }
  }
}
```

#### Storage Rules

```typescript
// storage.rules
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

## Function Configuration

### Runtime Options

For detailed configuration options, see [Configuration Guide](/setup/configuration).

```typescript
export const runtimeOpts = {
  timeoutSeconds: 540,
  memory: "1GiB",
} as const;
```

### Scheduled Functions

For service implementation details, see [Card Sync Service](/services/card-sync)
 and [Price Sync Service](/services/price-sync).

```typescript
export const scheduledCardSync = onSchedule({
  schedule: "0 21 * * *",  // Daily at 21:00 UTC
  timeZone: "UTC",
  memory: runtimeOpts.memory,
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  retryCount: 3,
});
```

## Post-Deployment Verification

### 1. Health Check

```bash
curl https://${REGION}-${PROJECT_ID}.cloudfunctions.net/healthCheck
```

Expected response:

```json
{
  "status": "healthy",
  "timestamp": "2024-11-23T01:47:16.617Z",
  "version": "1.0.0"
}
```

### 2. Test Sync Operations

For API endpoints documentation, see [API Documentation](/api/).

```bash
# Test card sync
curl https://${REGION}-${PROJECT_ID}.cloudfunctions.net/testCardSync?dryRun=true&limit=5

# Test price sync
curl https://${REGION}-${PROJECT_ID}.cloudfunctions.net/testPriceSync?dryRun=true&limit=5
```

## Deployment Checklist

### Pre-Deployment

- [ ] All tests passing
- [ ] Linting issues resolved
- [ ] Environment variables configured
- [ ] Security rules updated
- [ ] Dependencies updated

### Deployment

- [ ] Build successful
- [ ] Functions deployed
- [ ] Security rules deployed
- [ ] Storage rules deployed

### Post-Deployment

- [ ] Health check passing
- [ ] Test syncs successful
- [ ] Logs accessible
- [ ] Monitoring configured

## Rollback Procedures

### Function Rollback

```bash
# List previous versions
firebase functions:list

# Rollback to specific version
firebase functions:rollback <version>
```

### Security Rules Rollback

```bash
# Firestore rules
firebase firestore:rules:list
firebase firestore:rules:rollback <version>

# Storage rules
firebase storage:rules:list
firebase storage:rules:rollback <version>
```

## Best Practices

### Security

For security implementation details, see [Security Guidelines](/security).

- Implement proper IAM roles
- Use secure environment variables
- Regular security audits
- Monitor access patterns

### Performance

For performance optimization details, see [Performance Guide](/performance).

- Configure appropriate memory
- Set proper timeouts
- Implement caching
- Monitor resource usage

### Maintenance

For monitoring setup, see [Monitoring Guide](/monitoring/).

- Regular dependency updates
- Log rotation
- Performance monitoring
- Error tracking

## Related Documentation

- [Configuration Guide](/setup/configuration)
- [Security Guidelines](/security)
- [Monitoring Guide](/monitoring/)
- [Troubleshooting Guide](/troubleshooting/common-issues)
