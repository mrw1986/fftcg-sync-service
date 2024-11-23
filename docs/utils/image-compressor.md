# Image Compressor Utility

## Overview

The Image Compressor (`imageCompressor.ts`) handles image optimization and compression for card images. It provides configurable compression settings for both standard and high-resolution images while maintaining image quality.

## Core Features

- Dual resolution support (200w/400w)
- Quality-preserving compression
- Dimension optimization
- Progressive JPEG support
- Metadata preservation
- Compression statistics

## Configuration

### Quality Settings

```typescript
private static readonly QUALITY = {
  HIGH_RES: 90,
  LOW_RES: 85,
};
```

### Dimension Settings

```typescript
private static readonly DIMENSIONS = {
  HIGH_RES: 400,
  LOW_RES: 200,
};
```

## Main Interfaces

### Compression Result

```typescript
export interface CompressionResult {
  buffer: Buffer;
  info: {
    width: number;
    height: number;
    size: number;
    format: string;
    quality: number;
  };
}
```

## Primary Methods

### Compression Method

```typescript
static async compress(
  buffer: Buffer,
  isHighRes: boolean = false
): Promise<CompressionResult>
```

### Format Validation

```typescript
static async isCompressible(buffer: Buffer): Promise<boolean>
```

## Implementation Examples

### Basic Compression

```typescript
const imageBuffer = await fetchImage(url);
const result = await ImageCompressor.compress(imageBuffer, false);

console.log("Compression stats:", {
  originalSize: imageBuffer.length,
  compressedSize: result.buffer.length,
  dimensions: `${result.info.width}x${result.info.height}`,
  quality: result.info.quality
});
```

### High-Resolution Processing

```typescript
const highResResult = await ImageCompressor.compress(buffer, true);
await logInfo("High-res compression complete", {
  originalSize: buffer.length,
  compressedSize: highResResult.buffer.length,
  dimensions: `${highResResult.info.width}x${highResResult.info.height}`,
  quality: highResResult.info.quality
});
```

## Compression Pipeline

### Image Analysis

```typescript
const originalInfo = await sharp(buffer).metadata();
const originalSize = buffer.length;
```

### Optimization Process

```typescript
const image = sharp(buffer).jpeg({
  quality,
  progressive: true,
  mozjpeg: true,
});

if (originalInfo.width && originalInfo.width > targetWidth) {
  image.resize(targetWidth, null, {
    fit: "inside",
    withoutEnlargement: true,
  });
}
```

## Performance Monitoring

### Size Reduction Tracking

```typescript
const compressionStats = {
  originalSize: buffer.length,
  compressedSize: compressedBuffer.length,
  reductionPercent: (
    (buffer.length - compressedBuffer.length) / 
    buffer.length * 100
  ).toFixed(2)
};
```

### Quality Metrics

```typescript
const qualityMetrics = {
  dimensions: `${compressedInfo.width}x${compressedInfo.height}`,
  format: compressedInfo.format,
  quality: isHighRes ? QUALITY.HIGH_RES : QUALITY.LOW_RES
};
```

## Best Practices

### Memory Management

- Process one image at a time
- Release buffers after processing
- Monitor memory usage

### Quality Control

- Use appropriate quality settings
- Validate output dimensions
- Check compression ratios

### Error Prevention

- Validate input formats
- Check buffer integrity
- Monitor compression results

## Usage Guidelines

### Standard Resolution

```typescript
const standardResult = await ImageCompressor.compress(buffer);
if (standardResult.buffer.length > buffer.length) {
  // Use original if compression didn't help
  return buffer;
}
```

### High Resolution

```typescript
const highResResult = await ImageCompressor.compress(buffer, true);
if (!highResResult.info.width || highResResult.info.width < 400) {
  throw new Error("High-res compression failed to meet size requirements");
}
```

## Error Handling

### Input Validation

```typescript
if (!buffer || buffer.length === 0) {
  throw new Error("Invalid input buffer");
}

if (!await ImageCompressor.isCompressible(buffer)) {
  throw new Error("Unsupported image format");
}
```

### Processing Errors

```typescript
try {
  return await ImageCompressor.compress(buffer);
} catch (error) {
  throw new Error(
    `Image compression failed: ${
      error instanceof Error ? error.message : "Unknown error"
    }`
  );
}
```

## Related Components

- [Image Handler](./image-handler)
- [Image Validator](./image-validator)
- [Logger](./logging)

## Troubleshooting

### Common Issues

1. Memory Constraints:
   - Monitor buffer sizes
   - Process images sequentially
   - Implement garbage collection

2. Quality Problems:
   - Verify quality settings
   - Check dimension constraints
   - Validate output formats

3. Performance Issues:
   - Monitor processing times
   - Track compression ratios
   - Optimize batch processing
