# Security Guidelines

## Overview

This guide outlines security best practices and implementations for the FFTCG Sync Service, covering authentication, data validation, rate limiting, and other security considerations.

## Authentication

### Firebase Authentication

```typescript
// Verify Firebase authentication token
async function verifyAuth(req: Request): Promise<void> {
  const token = req.headers.authorization?.split("Bearer ")[1];
  if (!token) {
    throw new Error("No authentication token provided");
  }

  try {
    await admin.auth().verifyIdToken(token);
  } catch (error) {
    throw new Error("Invalid authentication token");
  }
}
```

### Service Account Security

```typescript
// Service account initialization
async function initializeFirebase(): Promise<FirebaseFirestore.Firestore> {
  try {
    const serviceAccountPath = path.resolve(__dirname, "../../../service_account_key.json");
    const serviceAccount = JSON.parse(await fs.readFile(serviceAccountPath, "utf8"));

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }

    return admin.firestore();
  } catch (error) {
    throw new Error("Failed to initialize Firebase: " + error);
  }
}
```

## Input Validation

### Request Validation

```typescript
// Validate sync options
function validateSyncOptions(options: unknown): asserts options is SyncOptions {
  if (!options || typeof options !== "object") {
    throw new Error("Invalid options object");
  }

  const opts = options as Record<string, unknown>;
 
  if (opts.limit && typeof opts.limit !== "number") {
    throw new Error("Limit must be a number");
  }

  if (opts.groupId && typeof opts.groupId !== "string") {
    throw new Error("GroupId must be a string");
  }
}
```

### Image Validation

```typescript
class ImageValidator {
  private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

  static async validateImage(buffer: Buffer): Promise<ImageValidationError | null> {
    // Check file size
    if (buffer.length > this.MAX_FILE_SIZE) {
      return {
        code: "FILE_TOO_LARGE",
        message: `Image exceeds maximum size of ${this.MAX_FILE_SIZE / 1024 / 1024}MB`
      };
    }

    // Verify file signature
    if (!this.isJpeg(buffer)) {
      return {
        code: "INVALID_FORMAT",
        message: "Image must be in JPEG format"
      };
    }

    return null;
  }
}
```

## Rate Limiting

### API Rate Limiting

```typescript
const rateLimiter = {
  tokens: 100,
  refillRate: 10,
  interval: 1000,

  async acquire(): Promise<boolean> {
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    return false;
  }
};
```

### Function Concurrency Control

```typescript
// Configure function instance limits
exports.syncCards = onRequest({
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  memory: runtimeOpts.memory,
  maxInstances: 1
}, async (req: Request, res: Response) => {
  // Function implementation
});
```

## Data Protection

### Data Encryption

```typescript
// Hash sensitive data
function getDataHash(data: any): string {
  return crypto.createHash("md5")
    .update(JSON.stringify(data, Object.keys(data).sort()))
    .digest("hex");
}
```

### Secure Storage Access

```typescript
// Secure URL generation
async function getSecureImageUrl(path: string): Promise<string> {
  const [url] = await storage
    .bucket(STORAGE.BUCKETS.CARD_IMAGES)
    .file(path)
    .getSignedUrl({
      action: "read",
      expires: "03-01-2500"
    });
  return url;
}
```

## Error Handling

### Secure Error Logging

```typescript
export async function logDetailedError(
  error: Error,
  context: string,
  metadata?: Record<string, unknown>,
  severity: "ERROR" | "WARNING" | "CRITICAL" = "ERROR"
): Promise<void> {
  const report: ErrorReport = {
    timestamp: new Date(),
    context,
    error: error.message,
    stackTrace: error.stack,
    metadata,
    severity
  };

  // Sanitize sensitive information before logging
  const sanitizedReport = sanitizeErrorReport(report);
  await db.collection(COLLECTION.LOGS).add(sanitizedReport);
}
```

### Error Response Sanitization

```typescript
function sanitizeErrorMessage(error: Error): string {
  // Remove sensitive information from error messages
  return error.message.replace(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi, '[EMAIL]')
    .replace(/\b\d{4}\b/g, '[ID]');
}
```

## Network Security

### Request Configuration

```typescript
const secureRequestConfig = {
  timeout: 30000,
  headers: {
    "Accept": "application/json",
    "User-Agent": "FFTCG-Sync-Service/1.0"
  },
  validateStatus: (status: number) => status < 400
};
```

### HTTPS Enforcement

```typescript
// Ensure HTTPS usage
const BASE_URL = "https://tcgcsv.com";
const SECURE_STORAGE_URL = "https://storage.googleapis.com";
```

## Firestore Security Rules

```typescript
// firestore.rules
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

## Storage Security Rules

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

## Best Practices

### API Security

1. Use HTTPS for all requests
2. Implement proper authentication
3. Validate all inputs
4. Rate limit requests
5. Monitor for suspicious activity

### Data Security

1. Minimize sensitive data storage
2. Encrypt sensitive information
3. Implement proper access controls
4. Regular security audits
5. Secure backup procedures

### Error Management

1. Sanitize error messages
2. Avoid exposing internal details
3. Log security events
4. Monitor error patterns
5. Implement proper error recovery

### Function Security

1. Use minimal permissions
2. Implement request validation
3. Control function concurrency
4. Monitor function execution
5. Regular security updates

## Security Monitoring

### Logging Security Events

```typescript
interface SecurityEvent {
  timestamp: Date;
  eventType: "AUTH" | "ACCESS" | "ERROR" | "MODIFICATION";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  details: Record<string, unknown>;
}

async function logSecurityEvent(event: SecurityEvent): Promise<void> {
  await db.collection("securityLogs").add({
    ...event,
    timestamp: new Date()
  });
}
```

### Audit Trail

```typescript
interface AuditLog {
  timestamp: Date;
  userId: string;
  action: string;
  resource: string;
  changes: Record<string, unknown>;
}

async function createAuditLog(
  action: string,
  resource: string,
  changes: Record<string, unknown>
): Promise<void> {
  await db.collection("auditLogs").add({
    timestamp: new Date(),
    action,
    resource,
    changes
  });
}
```

### Security Metrics

```typescript
interface SecurityMetrics {
  failedAuthAttempts: number;
  rateLimitExceeded: number;
  suspiciousRequests: number;
  securityEvents: number;
}

async function trackSecurityMetrics(): Promise<SecurityMetrics> {
  // Implementation of security metrics tracking
  return {
    failedAuthAttempts: 0,
    rateLimitExceeded: 0,
    suspiciousRequests: 0,
    securityEvents: 0
  };
}
```
