# Storage Service

## Overview

The Storage Service (`storageService.ts`) manages the processing, storage, and retrieval of card images in Cloudflare R2 Storage. It handles image downloading, validation, uploading, and provides fallback mechanisms for missing or invalid images using a placeholder image.

## Core Features

- Multi-resolution image support (full, high, and low resolution)
- Image validation and error handling
- Cloudflare R2 Storage integration
- Placeholder image fallback for missing or invalid images
- Metadata tracking and storage
- Comprehensive retry logic
- Cache-aware processing

## Class Structure

```typescript
export class StorageService {
  private client: S3Client;
  private readonly bucket: string;
  private readonly customDomain: string;
  private readonly storagePath: string;
  private readonly maxRetries = 3;
  private readonly timeoutMs = 30000; // 30 seconds
  
  // Main method
  async processAndStoreImage(
    imageUrl: string | undefined,
    productId: number,
    groupId: string
  ): Promise<ImageResult>
}
```

## Core Methods

### Process and Store Image

```typescript
async processAndStoreImage(
  imageUrl: string | undefined,
  productId: number,
  groupId: string
): Promise<ImageResult>
```

#### Parameters

- `imageUrl`: Source URL of the card image (can be undefined)
- `productId`: Unique card identifier
- `groupId`: Card group identifier

#### Returns

```typescript
interface ImageResult {
  fullResUrl: string | null;
  highResUrl: string | null;
  lowResUrl: string | null;
  metadata: {
    contentType: string;
    productId: string;
    groupId: string;
    lastUpdated: string;
    originalUrl?: string;
    isPlaceholder?: boolean;
    errorMessage?: string;
    [key: string]: any;
  };
}
```

## Image Processing Pipeline

### 1. URL Validation

```typescript
private isValidImageUrl(url: string | undefined): boolean
```

Validates image URLs against known patterns and formats:

- Checks for TCGPlayer's missing image SVG
- Validates Square Enix URLs
- Verifies TCGCSV URL patterns

### 2. Image Download

```typescript
private async downloadImage(url: string, retries = this.maxRetries): Promise<Buffer>
```

Downloads image content with retry logic and validation:

- Implements exponential backoff
- Validates image format (JPEG/PNG)
- Handles HTTP errors appropriately

### 3. R2 Storage Upload

```typescript
private async uploadToR2WithRetry(
  buffer: Buffer,
  path: string,
  metadata: Record<string, string>,
  retries = this.maxRetries
): Promise<string>
```

Uploads images to Cloudflare R2 with retry logic:

- Sets appropriate content type and cache control
- Attaches metadata
- Returns public URL

### 4. Placeholder Handling

```typescript
private getPlaceholderResult(
  baseMetadata: {
    contentType: string;
    productId: string;
    groupId: string;
    lastUpdated: string;
  },
  originalUrl?: string
): ImageResult
```

Provides fallback for missing or invalid images:

- Returns placeholder image URL for all resolutions
- Sets appropriate metadata
- Includes error information

## Configuration

### R2 Storage Settings

```typescript
export const R2_CONFIG = {
  ACCOUNT_ID: process.env.R2_ACCOUNT_ID || "",
  ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || "",
  SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || "",
  BUCKET_NAME: process.env.R2_BUCKET_NAME || "",
  CUSTOM_DOMAIN: process.env.R2_CUSTOM_DOMAIN || "",
  STORAGE_PATH: process.env.R2_STORAGE_PATH || "card-images",
};
```

## Recent Updates

### Placeholder Image Implementation

The Storage Service now consistently uses a placeholder image for cards with missing or invalid images:

```typescript
const PLACEHOLDER_URL = "https://fftcgcompanion.com/card-images/image-coming-soon.jpeg";
```

This placeholder is used in the following scenarios:

1. When a card has no image URL
2. When an image URL is invalid
3. When image downloading fails
4. When image processing encounters errors
5. When no valid images are available after processing

The placeholder implementation ensures that cards always have valid image URLs for all three resolutions (low, high, and full), preventing null values in the database.

## Usage Examples

### Basic Image Processing

```typescript
const result = await storageService.processAndStoreImage(
  "https://example.com/card-image.jpg",
  123456,
  "23783"
);

console.log("Image URLs:", {
  fullRes: result.fullResUrl,
  highRes: result.highResUrl,
  lowRes: result.lowResUrl
});
```

### Handling Missing Images

```typescript
// For cards without images
const result = await storageService.processAndStoreImage(
  undefined,
  123456,
  "23783"
);

// Will use placeholder image
console.log("Using placeholder:", result.fullResUrl);
```

### With Error Handling

```typescript
try {
  const result = await storageService.processAndStoreImage(imageUrl, productId, groupId);
  
  if (result.metadata.isPlaceholder) {
    console.log("Using placeholder image due to:", result.metadata.errorMessage);
  } else {
    console.log("Image processed successfully");
  }
} catch (error) {
  console.error("Image processing failed:", error);
}
```

## Error Handling

### Error Types

- Download failures
- Invalid image formats
- Storage upload errors
- Authentication issues
- Rate limiting

### Recovery Strategies

- Exponential backoff for transient errors
- Fallback to placeholder images
- Detailed error logging
- Metadata preservation

## Best Practices

1. **Memory Management**:
   - Process one resolution at a time
   - Use streams for large files
   - Implement proper cleanup

2. **Error Handling**:
   - Implement retries for transient failures
   - Log detailed error information
   - Maintain fallback URLs

3. **Performance**:
   - Utilize caching effectively
   - Implement batch processing
   - Monitor storage quotas

## Related Components

- [Card Sync Service](./card-sync)
- [Image Handler](../utils/image-handler)
- [Image Validator](../utils/image-validator)
- [Cache System](../utils/cache)
