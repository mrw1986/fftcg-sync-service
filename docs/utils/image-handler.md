# Image Handler Utility

## Overview

The Image Handler (`imageHandler.ts`) is a comprehensive utility for managing card images. It handles downloading, processing, compression, caching, and storage of both standard and high-resolution card images in Firebase Storage.

## Features

- Dual resolution support (200w and 400w)
- Image compression and optimization
- Caching system
- Hash-based change detection
- Error handling and retry logic
- Storage path management
- Metadata tracking

## Class Structure

```typescript
export class ImageHandler {
  private bucket = storage.bucket(STORAGE.BUCKETS.CARD_IMAGES);
 
  // Main method
  async processImage(
    imageUrl: string,
    groupId: string,
    productId: number
  ): Promise<ImageProcessingResult>
}
```

## Core Methods

### Process Image

```typescript
async processImage(
  imageUrl: string,
  groupId: string,
  productId: number
): Promise<ImageProcessingResult>
```

#### Parameters

- `imageUrl`: Source URL of the card image
- `groupId`: Card group identifier
- `productId`: Unique card identifier

#### Returns

```typescript
interface ImageProcessingResult {
  originalUrl: string;      // URL of standard resolution image
  highResUrl: string;       // URL of high resolution image
  metadata: ImageMetadata;  // Image processing metadata
  updated: boolean;         // Whether image was updated
}
```

### Image Processing Pipeline

1. **URL Processing**:

```typescript
private getHighResUrl(imageUrl: string): string {
  return imageUrl.replace(/_200w\.jpg$/, "_400w.jpg");
}
```

1. **Storage Path Management**:

```typescript
private getStoragePath(
  groupId: string,
  productId: number,
  isHighRes: boolean = false
): string {
  const suffix = isHighRes ? "_400w" : "_200w";
  return `${STORAGE.PATHS.IMAGES}/${groupId}/${productId}${suffix}.jpg`;
}
```

1. **Image Download**:

```typescript
private async downloadImage(url: string): Promise<Buffer>
```

1. **Image Compression**:

```typescript
private async compressImage(
  buffer: Buffer,
  isHighRes: boolean
): Promise<Buffer>
```

## Configuration

### Storage Settings

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

## Usage Examples

### Basic Image Processing

```typescript
const imageHandler = new ImageHandler();

const result = await imageHandler.processImage(
  "https://tcgplayer-cdn.tcgplayer.com/product/477236_200w.jpg",
  "23783",
  477236
);

console.log("Image URLs:", {
  original: result.originalUrl,
  highRes: result.highResUrl
});
```

### With Error Handling

```typescript
try {
  const imageHandler = new ImageHandler();
  const result = await imageHandler.processImage(imageUrl, groupId, productId);
 
  if (result.updated) {
    console.log("Image updated successfully");
    console.log("Metadata:", result.metadata);
  }
} catch (error) {
  console.error("Image processing failed:", error);
}
```

## Metadata Management

### Metadata Structure

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

### Saving Metadata

```typescript
private async saveMetadata(
  groupId: string,
  productId: number,
  metadata: ImageMetadata
): Promise<void>
```

## Cache Integration

The Image Handler integrates with the caching system for improved performance:

```typescript
const cacheKey = imageCache.getBufferCacheKey(url);
const cachedBuffer = await imageCache.getBuffer(cacheKey);

if (cachedBuffer) {
  return cachedBuffer;
}
```

## Error Handling

### Error Types

```typescript
interface ImageProcessingError extends GenericError {
  productId: number;
  groupId: string;
  originalUrl: string;
  type: "download" | "upload" | "metadata" | "unknown";
}
```

### Error Recovery

```typescript
catch (error) {
  return {
    originalUrl: imageUrl,
    highResUrl: this.getHighResUrl(imageUrl),
    metadata: {
      contentType: "image/jpeg",
      size: 0,
      updated: new Date(),
      hash: "",
      originalUrl: imageUrl,
      highResUrl: this.getHighResUrl(imageUrl),
    },
    updated: false,
  };
}
```

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

- [Image Cache](./cache)
- [Image Compressor](./image-compressor)
- [Image Validator](./image-validator)
- [Logger](./logging)
