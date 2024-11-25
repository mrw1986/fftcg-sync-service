# TCGPlayer Integration

## Overview

The FFTCG Sync Service integrates with TCGPlayer's API to fetch card data, prices,
 and images. This integration forms the core data source for the synchronization
  service.

## API Configuration

### Base Configuration

```typescript
// Base configuration for TCGPlayer API
export const BASE_URL = "https://tcgcsv.com";
export const FFTCG_CATEGORY_ID = "24";
```

### Authentication

```typescript
const headers = {
  "Accept": "application/json",
  "User-Agent": "FFTCG-Sync-Service/1.0",
  "Authorization": `Bearer ${token}`
};
```

## Endpoints

### Card Data Endpoints

#### Get Card Groups

```http
GET /{categoryId}/groups
```

Response:

```json
{
  "results": [
    {
      "groupId": "23783",
      "name": "FFVII Boss Deck",
      "categoryId": 24,
      "modifiedOn": "2024-01-15T00:00:00"
    }
  ]
}
```

#### Get Group Products

```http
GET /{categoryId}/{groupId}/products
```

Response:

```json
{
  "results": [
    {
      "productId": 477236,
      "name": "Cloud",
      "cleanName": "cloud",
      "imageUrl": "https://tcgplayer-cdn.tcgplayer.com/product/477236_200w.jpg",
      "categoryId": 24,
      "groupId": 23783,
      "url": "https://tcgplayer.com/...",
      "modifiedOn": "2024-01-15T00:00:00",
      "imageCount": 1
    }
  ]
}
```

### Price Endpoints

#### Get Group Prices

```http
GET /{categoryId}/{groupId}/prices
```

Response:

```json
{
  "results": [
    {
      "productId": 477236,
      "lowPrice": 1.99,
      "midPrice": 2.99,
      "highPrice": 4.99,
      "marketPrice": 2.50,
      "directLowPrice": 1.89,
      "subTypeName": "Normal"
    }
  ]
}
```

## Rate Limiting

### Limits

- 100 requests per minute
- 10 concurrent requests maximum
- 30-second timeout per request

### Implementation

```typescript
const rateLimiter = {
  tokens: 100,
  refillRate: 10,
  interval: 1000,
  maxConcurrent: 10
};
```

## Error Handling

### Request Retry Logic

```typescript
const MAX_RETRIES = 3;
const BASE_DELAY = 1000; // 1 second

async function makeRequest<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const {retryCount = 0} = options;
  
  try {
    // Request implementation
  } catch (error) {
    if (retryCount < MAX_RETRIES - 1) {
      const delay = Math.pow(2, retryCount) * BASE_DELAY;
      await logWarning(`Retrying in ${delay}ms...`);
      return makeRequest<T>(endpoint, {
        ...options,
        retryCount: retryCount + 1
      });
    }
    throw error;
  }
}
```

## Data Processing

### Card Data Processing

```typescript
interface CardProduct {
  productId: number;
  name: string;
  cleanName: string;
  imageUrl: string;
  categoryId: number;
  groupId: number;
  url: string;
  modifiedOn: string;
  imageCount: number;
}
```

### Price Data Processing

```typescript
interface CardPrice {
  productId: number;
  lowPrice: number;
  midPrice: number;
  highPrice: number;
  marketPrice: number | null;
  directLowPrice: number | null;
  subTypeName: "Normal" | "Foil";
}
```

## Image Handling

### Image URLs

- Standard resolution: `{productId}_200w.jpg`
- High resolution: `{productId}_400w.jpg`

### Image Processing Pipeline

1. Download from TCGPlayer CDN
2. Validate format and dimensions
3. Compress and optimize
4. Store in Firebase Storage
5. Update image metadata

## Best Practices

### 1. Request Management

- Implement proper rate limiting
- Use exponential backoff
- Cache responses when possible
- Monitor API usage

### 2. Error Handling

- Validate response data
- Handle network errors gracefully
- Log all API interactions
- Maintain fallback options

### 3. Data Integrity

- Verify data consistency
- Track modification dates
- Implement version control
- Maintain audit logs

## Troubleshooting

### Common Issues

1. Rate Limit Exceeded
   - Implement proper delays
   - Monitor request patterns
   - Use batch processing
   - Cache frequently accessed data

2. Data Inconsistencies
   - Verify API responses
   - Check data transformation
   - Validate before storage
   - Monitor sync status

3. Image Processing Failures
   - Verify URL patterns
   - Check image formats
   - Monitor storage quotas
   - Validate compression results

## Related Documentation

- [Card Sync Service](/services/card-sync)
- [Price Sync Service](/services/price-sync)
- [Image Handler](/utils/image-handler)
- [Request Utility](/utils/request)
