# Image Processing Tests

## Overview

This guide covers the automated testing of image processing functionality using
 `testImageHandler.ts`. The tests verify image downloading, compression, caching,
  and storage operations.

## Test Configuration

### Test Cases

```typescript
const TEST_CASES = [
  {
    imageUrl: "https://tcgplayer-cdn.tcgplayer.com/product/477236_200w.jpg",
    groupId: "23783",
    productId: 477236,
    description: "FFVII Boss Deck"
  }
];
```

## Core Test Components

### Basic Image Processing

```typescript
async function testImageProcessing() {
  console.log("\n=== Testing Image Handler ===");
  const imageHandler = new ImageHandler();

  for (const testCase of TEST_CASES) {
    console.log(`\nProcessing: ${testCase.description}`);
    console.log("URLs:");
    console.log(`- Original: ${testCase.imageUrl}`);
    console.log(`- High-res: ${testCase.imageUrl.replace("_200w.jpg", "_400w.jpg")}`);

    // Test compression independently
    const response = await fetch(testCase.imageUrl);
    const buffer = Buffer.from(await response.arrayBuffer());

    // Process both resolutions
    const [lowResResult, highResResult] = await Promise.all([
      ImageCompressor.compress(buffer, false),
      ImageCompressor.compress(buffer, true)
    ]);

    // Log compression results
    console.log("Low-res:");
    console.log(`- Original: ${(buffer.length / 1024).toFixed(2)}KB`);
    console.log(`- Compressed: ${(lowResResult.buffer.length / 1024).toFixed(2)}KB`);
    console.log(`- Reduction: ${((1 - lowResResult.buffer.length /
     buffer.length) * 100).toFixed(1)}%`);
    console.log(`- Dimensions: ${lowResResult.info.width}x${lowResResult.info.height}`);
  }
}
```

### Cache Testing

```typescript
async function testCaching() {
  const imageHandler = new ImageHandler();
  
  // First request - should process and cache
  const initialResult = await imageHandler.processImage(
    testCase.imageUrl,
    testCase.groupId,
    testCase.productId
  );

  // Second request - should use cache
  const cachedResult = await imageHandler.processImage(
    testCase.imageUrl,
    testCase.groupId,
    testCase.productId
  );

  console.log("Cache Results:");
  console.log(`- Cached: ${!cachedResult.updated}`);
  console.log(`- Original Size: ${(cachedResult.metadata.originalSize || 0) / 1024}KB`);
  console.log(`- High-res Size: ${(cachedResult.metadata.highResSize || 0) / 1024}KB`);
}
```

### Error Handling Tests

```typescript
async function testErrorHandling() {
  const imageHandler = new ImageHandler();

  // Test invalid URL
  const invalidResult = await imageHandler.processImage(
    "https://invalid-url.com/image.jpg",
    TEST_CASES[0].groupId,
    TEST_CASES[0].productId
  );

  console.log("Error Results:");
  console.log(`- Fallback: ${invalidResult.originalUrl === "https://invalid-url.com/image.jpg"}`);
  console.log(`- Updated: ${invalidResult.updated}`);
  console.log("- Error Handled: true");
}
```

## Test Categories

### 1. Image Compression Tests

#### Resolution Verification

```typescript
const dimensions = {
  standard: {
    width: 200,
    height: 200
  },
  highRes: {
    width: 400,
    height: 400
  }
};

// Verify dimensions
expect(lowResResult.info.width).toBeLessThanOrEqual(dimensions.standard.width);
expect(highResResult.info.width).toBeLessThanOrEqual(dimensions.highRes.width);
```

#### Quality Settings

```typescript
const QUALITY = {
  HIGH_RES: 90,
  LOW_RES: 85
};

// Verify compression quality
expect(lowResResult.info.quality).toBe(QUALITY.LOW_RES);
expect(highResResult.info.quality).toBe(QUALITY.HIGH_RES);
```

### 2. Storage Integration Tests

```typescript
async function testStorageIntegration() {
  const result = await imageHandler.processImage(
    testCase.imageUrl,
    testCase.groupId,
    testCase.productId
  );

  console.log("Storage Results:");
  console.log(`- Status: ${result.updated ? "Updated" : "Unchanged"}`);
  console.log(`- Original Size: ${(result.metadata.originalSize || 0) / 1024}KB`);
  console.log(`- High-res Size: ${(result.metadata.highResSize || 0) / 1024}KB`);
  console.log(`- Content Type: ${result.metadata.contentType}`);
  console.log(`- Last Updated: ${result.metadata.updated.toISOString()}`);
}
```

### 3. Cache System Tests

```typescript
async function testCacheSystem() {
  // Test metadata cache
  const metadataKey = imageCache.getMetadataCacheKey(
    testCase.groupId,
    testCase.productId,
    false
  );
  
  // Test buffer cache
  const bufferKey = imageCache.getBufferCacheKey(testCase.imageUrl);
  
  // Test existence cache
  const existsKey = imageCache.getExistsCacheKey(
    testCase.groupId,
    testCase.productId,
    false
  );

  console.log("Cache System Tests:");
  console.log(`- Metadata Cached: ${await imageCache.getMetadata(metadataKey)
   !== undefined}`);
  console.log(`- Buffer Cached: ${await imageCache.getBuffer(bufferKey) !== undefined}`);
  console.log(`- Exists Cached: ${imageCache.getExists(existsKey) !== undefined}`);
}
```

## Test Execution

### Running Tests

```bash
# Run all image tests
npm run test:images

# Run specific test categories
npm run test:images -- --filter=compression
npm run test:images -- --filter=cache
npm run test:images -- --filter=storage
```

### Test Output Example

```text
=== Testing Image Handler ===
Processing: FFVII Boss Deck
URLs:
- Original: https://tcgplayer-cdn.tcgplayer.com/product/477236_200w.jpg
- High-res: https://tcgplayer-cdn.tcgplayer.com/product/477236_400w.jpg

=== Compression Test ===
Low-res:
- Original: 45.23KB
- Compressed: 32.15KB
- Reduction: 28.9%
- Dimensions: 200x278

High-res:
- Original: 89.45KB
- Compressed: 65.32KB
- Reduction: 27.0%
- Dimensions: 400x556
```

## Best Practices

### Test Organization

- Isolate test cases
- Clean up after tests
- Use meaningful descriptions
- Log detailed results

### Performance Considerations

- Monitor memory usage
- Track processing times
- Verify cache effectiveness
- Test concurrent processing

### Error Handling

- Test invalid inputs
- Verify error recovery
- Check fallback behavior
- Validate error messages

## Related Documentation

- [Image Handler](/utils/image-handler)
- [Image Compressor](/utils/image-compressor)
- [Image Validator](/utils/image-validator)
- [Cache System](/utils/cache)
