# Implementation Plan: Card Image Enhancement

## Overview

This plan outlines the changes needed to enhance the card image handling system by:

1. Storing NULL values for missing TCGCSV API images
2. Maintaining Square Enix data storage without changes
3. Using Square Enix images as fallback for cards with NULL image URLs

## 1. Update CardSyncService (cardSync.ts)

### Changes Required

- Modify image handling logic in `processCards` method:

```typescript
// Process image handling
const imageResult = await (async () => {
  if (card.imageUrl) {
    // If URL exists, process normally
    return await this.retry.execute(() =>
      storageService.processAndStoreImage(
        card.imageUrl,
        card.productId,
        groupId
      )
    );
  } else {
    // For any card without image, use null
    return {
      fullResUrl: null,
      highResUrl: null,
      lowResUrl: null,
      metadata: {}
    } as ImageResult;
  }
})();
```

This change ensures that missing images are explicitly stored as NULL rather than using placeholder images.

## 2. Update Card Matching Logic (updateCardsWithSquareEnixData.ts)

### Changes Required

1. Modify the `getFieldsToUpdate` function to handle image updates:

```typescript
async function getFieldsToUpdate(tcgCard: TcgCard, seCard: SquareEnixCard): Promise<Partial<TcgCard>> {
  const updates: Partial<TcgCard> = {};

  // Only process images for actual cards (not sealed products)
  if (!tcgCard.isNonCard) {
    // Check and update images if needed
    if (tcgCard.highResUrl === null || tcgCard.lowResUrl === null) {
      const imageResults = await processImages(tcgCard, seCard);
      if (tcgCard.highResUrl === null && imageResults.highResUrl) {
        updates.highResUrl = imageResults.highResUrl;
        updates.fullResUrl = imageResults.highResUrl;
        logger.info("Adding missing high/full res image URLs from Square Enix", {
          id: tcgCard.id,
          name: tcgCard.name,
          newUrl: imageResults.highResUrl
        });
      }
      if (tcgCard.lowResUrl === null && imageResults.lowResUrl) {
        updates.lowResUrl = imageResults.lowResUrl;
        logger.info("Adding missing low res image URL from Square Enix", {
          id: tcgCard.id,
          name: tcgCard.name,
          newUrl: imageResults.lowResUrl
        });
      }
    }
  }

  // Rest of the existing field mappings...
}
```

2. Update the main processing loop to filter non-cards:

```typescript
// Process each TCG card
for (const tcgCard of tcgCards) {
  // Skip non-card products
  if (tcgCard.isNonCard) {
    logger.info("Skipping non-card product", {
      id: tcgCard.id,
      name: tcgCard.name
    });
    continue;
  }

  // Rest of the existing processing logic...
}
```

3. Enhance the `processImages` function to maintain URL structure:

```typescript
async function processImages(
  tcgCard: TcgCard,
  seCard: SquareEnixCard
): Promise<{ highResUrl: string | null; lowResUrl: string | null }> {
  try {
    if (!tcgCard.groupId) {
      logger.warn("No groupId found for card", { id: tcgCard.id });
      return { highResUrl: null, lowResUrl: null };
    }

    const groupId = tcgCard.groupId;
    
    // Process full resolution image (maps to highResUrl)
    const fullResResult = groupId && seCard.images?.full?.length > 0
      ? await retry.execute(() =>
          storageService.processAndStoreImage(
            seCard.images.full[0],
            parseInt(tcgCard.id),
            groupId.toString(),
            true // Flag to maintain TCGCSV URL structure
          )
        )
      : null;

    // Process thumbnail image (maps to lowResUrl)
    const thumbResult = groupId && seCard.images?.thumbs?.length > 0
      ? await retry.execute(() =>
          storageService.processAndStoreImage(
            seCard.images.thumbs[0],
            parseInt(tcgCard.id),
            groupId.toString(),
            true // Flag to maintain TCGCSV URL structure
          )
        )
      : null;

    return {
      highResUrl: fullResResult?.highResUrl || null,
      lowResUrl: thumbResult?.lowResUrl || null,
    };
  } catch (error) {
    logger.error(`Failed to process images for card ${tcgCard.id}`, {
      error: error instanceof Error ? error.message : "Unknown error",
      seCardCode: seCard.code,
    });
    return { highResUrl: null, lowResUrl: null };
  }
}
```

## 3. Update Storage Service (storageService.ts)

### Changes Required

Add support for maintaining TCGCSV URL structure when storing Square Enix images:

```typescript
async processAndStoreImage(
  imageUrl: string,
  productId: number,
  groupId: string,
  maintainTcgcsvStructure: boolean = false
): Promise<ImageResult> {
  // Existing image processing logic...

  // When storing in R2, use TCGCSV URL structure if flag is set
  const basePath = maintainTcgcsvStructure
    ? `card-images/${groupId}/${productId}`
    : `${groupId}/${productId}`;

  // Store with appropriate resolution suffixes
  const paths = {
    full: `${basePath}_in_1000x1000`,
    high: `${basePath}_400w`,
    low: `${basePath}_200w`
  };

  // Rest of storage logic...
}
```

## Implementation Steps

1. **Phase 1: TCGCSV API Changes**
   - Update CardSyncService to store NULL for missing images
   - Test image handling with and without image URLs
   - Verify NULL values are properly stored in Firestore

2. **Phase 2: Storage Service Enhancement**
   - Add URL structure maintenance support to storageService
   - Test image storage with both TCGCSV and Square Enix sources
   - Verify URL structure consistency

3. **Phase 3: Update Card Matching**
   - Implement isNonCard filtering in updateCardsWithSquareEnixData
   - Add Square Enix image fallback logic
   - Test image fallback process
   - Verify only valid cards are updated

4. **Testing**
   - Test complete sync process
   - Verify NULL handling for missing TCGCSV images
   - Confirm Square Enix image fallback works
   - Validate URL structure consistency
   - Ensure non-card products are skipped
   - Check element translations

## Success Criteria

1. Missing TCGCSV images are stored as NULL
2. Square Enix data maintains current format
3. Cards with NULL images fall back to Square Enix images
4. Image URLs maintain consistent structure
5. Non-card products (isNonCard = true) are not updated
6. Elements are properly translated from Japanese to English

Would you like me to proceed with implementing any specific phase of this plan?
