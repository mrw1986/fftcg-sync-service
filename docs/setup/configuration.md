# Configuration Guide

## Firebase Configuration

### Environment Variables

Create a `.env.local` file in your project root:

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-storage-bucket
```

### Firebase Console Settings

1. Firestore Database:

- Collection structure:
  - `cards`: Stores card information
  - `prices`: Stores price data
  - `syncMetadata`: Stores sync operation logs
  - `logs`: System logs
  - `cardHashes`: Card data version control
  - `priceHashes`: Price data version control
  - `imageMetadata`: Image processing metadata

1. Storage:

- Bucket structure:
  - `/card-images/{groupId}/{productId}_200w.jpg`
  - `/card-images/{groupId}/{productId}_400w.jpg`

## Application Configuration

### Runtime Options

Located in `src/config/firebase.ts`:

```typescript
export const runtimeOpts = {
  timeoutSeconds: 540,
  memory: "1GiB",
} as const;
```

### API Configuration

Base URL and category settings:

```typescript
export const BASE_URL = "https://tcgcsv.com";
export const FFTCG_CATEGORY_ID = "24";
```

### Collection Names

```typescript
export const COLLECTION = {
  CARDS: "cards",
  PRICES: "prices",
  SYNC_METADATA: "syncMetadata",
  LOGS: "logs",
  CARD_HASHES: "cardHashes",
  PRICE_HASHES: "priceHashes",
  IMAGE_METADATA: "imageMetadata",
};
```

## Sync Configuration

### Card Sync Schedule

```typescript
exports.scheduledCardSync = onSchedule({
  schedule: "0 21 * * *", // Daily at 21:00 UTC
  timeZone: "UTC",
  memory: runtimeOpts.memory,
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  retryCount: 3,
});
```

### Price Sync Schedule

```typescript
exports.scheduledPriceSync = onSchedule({
  schedule: "30 21 * * *", // Daily at 21:30 UTC
  timeZone: "UTC",
  memory: runtimeOpts.memory,
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  retryCount: 3,
});
```

## Image Processing Configuration

### Compression Settings

```typescript
private static readonly QUALITY = {
  HIGH_RES: 90,
  LOW_RES: 85,
};

private static readonly DIMENSIONS = {
  HIGH_RES: 400,
  LOW_RES: 200,
};
```

### Cache Settings

```typescript
const options = {
  max: 500,
  ttl: 1000 * 60 * 60, // 1 hour
};
```

## Testing Configuration

### Test Cases

```typescript
const TEST_CASES = [
  {
    imageUrl: "https://tcgplayer-cdn.tcgplayer.com/product/477236_200w.jpg",
    groupId: "23783",
    productId: 477236,
    description: "FFVII Boss Deck",
  },
];
```

## Error Handling Configuration

### Log Levels

```typescript
export interface ErrorReport {
  timestamp: Date;
  context: string;
  error: string;
  stackTrace?: string;
  metadata?: Record<string, unknown>;
  severity: "ERROR" | "WARNING" | "CRITICAL";
}
```
