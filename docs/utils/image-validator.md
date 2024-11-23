# Image Validator Utility

## Overview

The Image Validator (`imageValidator.ts`) ensures image integrity and conformance to required specifications before processing. It validates format, dimensions, file size, and other critical image attributes.

## Core Features

- Format validation
- Dimension verification
- Size limit enforcement
- Metadata validation
- URL structure validation
- MIME type checking

## Configuration

### Size Limits

```typescript
export const IMAGE_LIMITS = {
  MAX_SIZE: 10 * 1024 * 1024,  // 10MB
  MIN_SIZE: 1024,              // 1KB
  MAX_WIDTH: 2048,
  MAX_HEIGHT: 2048,
  MIN_WIDTH: 100,
  MIN_HEIGHT: 100,
};
```

### Format Settings

```typescript
export const SUPPORTED_FORMATS = [
  "image/jpeg",
  "image/jpg",
  "image/png"
] as const;

export const REQUIRED_DIMENSIONS = {
  STANDARD: {
    width: 200,
    height: 200
  },
  HIGH_RES: {
    width: 400,
    height: 400
  }
};
```

## Validation Methods

### URL Pattern Check

```typescript
export function isValidImageUrl(url: string): boolean {
  const pattern = /^https:\/\/.*\.(jpg|jpeg|png)(\?.*)?$/i;
  return pattern.test(url);
}
```

### Format Verification

```typescript
export async function isValidFormat(
  buffer: Buffer
): Promise<boolean> {
  try {
    const metadata = await sharp(buffer).metadata();
    return SUPPORTED_FORMATS.includes(
      `image/${metadata.format}` as typeof SUPPORTED_FORMATS[number]
    );
  } catch {
    return false;
  }
}
```

## Implementation Examples

### Basic Validation

```typescript
const validator = new ImageValidator();

try {
  await validator.validate(imageBuffer);
  console.log("Image validation successful");
} catch (error) {
  console.error("Validation failed:", error.message);
}
```

### URL Validation

```typescript
const isValid = validator.validateUrl(imageUrl);
if (!isValid) {
  throw new Error(`Invalid image URL: ${imageUrl}`);
}
```

## Validation Pipeline

### Size Check

```typescript
private async validateSize(buffer: Buffer): Promise<void> {
  const size = buffer.length;
 
  if (size > IMAGE_LIMITS.MAX_SIZE) {
    throw new Error(
      `Image size ${size} exceeds maximum limit of ${IMAGE_LIMITS.MAX_SIZE}`
    );
  }
 
  if (size < IMAGE_LIMITS.MIN_SIZE) {
    throw new Error(
      `Image size ${size} below minimum requirement of ${IMAGE_LIMITS.MIN_SIZE}`
    );
  }
}
```

### Dimension Check

```typescript
private async validateDimensions(
  metadata: sharp.Metadata
): Promise<void> {
  const { width, height } = metadata;
 
  if (!width || !height) {
    throw new Error("Unable to determine image dimensions");
  }
 
  if (width > IMAGE_LIMITS.MAX_WIDTH || height > IMAGE_LIMITS.MAX_HEIGHT) {
    throw new Error("Image dimensions exceed maximum limits");
  }
 
  if (width < IMAGE_LIMITS.MIN_WIDTH || height < IMAGE_LIMITS.MIN_HEIGHT) {
    throw new Error("Image dimensions below minimum requirements");
  }
}
```

## Utility Functions

### Metadata Extraction

```typescript
async function getImageMetadata(
  buffer: Buffer
): Promise<sharp.Metadata> {
  try {
    return await sharp(buffer).metadata();
  } catch (error) {
    throw new Error("Failed to extract image metadata");
  }
}
```

### Resolution Check

```typescript
function isValidResolution(
  width: number,
  height: number,
  isHighRes: boolean
): boolean {
  const requirements = isHighRes ? 
    REQUIRED_DIMENSIONS.HIGH_RES : 
    REQUIRED_DIMENSIONS.STANDARD;
   
  return width >= requirements.width && 
         height >= requirements.height;
}
```

## Error Messages

### Custom Validation Errors

```typescript
export class ImageValidationError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ImageValidationError";
  }
}
```

### Error Codes

```typescript
export const VALIDATION_ERRORS = {
  INVALID_FORMAT: "INVALID_FORMAT",
  INVALID_SIZE: "INVALID_SIZE",
  INVALID_DIMENSIONS: "INVALID_DIMENSIONS",
  INVALID_URL: "INVALID_URL",
  METADATA_ERROR: "METADATA_ERROR"
} as const;
```

## Best Practices

### Input Validation

- Check buffer integrity
- Validate URL structure
- Verify MIME types

### Performance Optimization

- Cache validation results
- Implement early returns
- Use efficient checks

### Error Handling

- Provide detailed error messages
- Include validation context
- Log validation failures

## Usage Guidelines

### Standard Validation

```typescript
const validateImage = async (buffer: Buffer): Promise<void> => {
  const validator = new ImageValidator();
 
  try {
    await validator.validate(buffer);
  } catch (error) {
    await logError(error, "imageValidation");
    throw error;
  }
};
```

### URL Pattern Validation

```typescript
const validateImageUrl = (url: string): void => {
  if (!isValidImageUrl(url)) {
    throw new ImageValidationError(
      `Invalid image URL: ${url}`,
      VALIDATION_ERRORS.INVALID_URL,
      { url }
    );
  }
};
```

## Related Components

- [Image Compressor](./image-compressor)
- [Image Handler](./image-handler)
- [Error Handling](./error-handling)

## Troubleshooting

### Common Issues

1. Format Problems:
   - Check file extensions
   - Verify MIME types
   - Validate image headers

2. Size Issues:
   - Monitor file sizes
   - Check compression settings
   - Verify buffer integrity

3. Dimension Errors:
   - Validate aspect ratios
   - Check resolution requirements
   - Monitor scaling issues
