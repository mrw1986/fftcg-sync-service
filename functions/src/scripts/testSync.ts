// src/scripts/testSync.ts
import { cardSync } from "../services/cardSync";
import { priceSync } from "../services/priceSync";
import { logger } from "../utils/logger";
import { withTimeout, TimeoutError } from "../utils/timeout";
import { storageService } from "../services/storageService";

const MAX_SYNC_TIME = 30 * 60 * 1000; // 30 minutes
const TEST_GROUP_ID = "23244"; // Dawn of Heroes
const TEST_PRODUCT_ID = 508343; // Example product ID
const IMAGE_BASE_URL = "https://fftcgcompanion.com/card-images";

async function testImageProcessing() {
  try {
    logger.info("Testing image processing...");

    // Test with a valid image URL using correct format
    const validImageResult = await storageService.processAndStoreImage(
      `${IMAGE_BASE_URL}/${TEST_GROUP_ID}/${TEST_PRODUCT_ID}_200w.jpg`,
      TEST_PRODUCT_ID,
      TEST_GROUP_ID
    );

    logger.info("Valid image processing result:", {
      highResUrl: validImageResult.highResUrl,
      lowResUrl: validImageResult.lowResUrl,
      isPlaceholder: validImageResult.metadata.isPlaceholder,
      originalUrl: validImageResult.metadata.originalUrl,
    });

    // Verify the image URLs follow the correct pattern
    const urlPattern = new RegExp(`^${IMAGE_BASE_URL}/.*_[24]00w.jpg$`);
    const isValidImageUrl = urlPattern.test(validImageResult.metadata.originalUrl || "");

    if (!isValidImageUrl) {
      logger.error("Image URL pattern does not match expected format", {
        url: validImageResult.metadata.originalUrl,
        expectedPattern: `${IMAGE_BASE_URL}/{groupId}/{productId}_200w.jpg`,
      });
    }

    // Test with invalid/missing image (should return placeholder)
    const placeholderResult = await storageService.processAndStoreImage(
      undefined,
      TEST_PRODUCT_ID,
      TEST_GROUP_ID
    );

    logger.info("Placeholder image result:", {
      highResUrl: placeholderResult.highResUrl,
      lowResUrl: placeholderResult.lowResUrl,
      isPlaceholder: placeholderResult.metadata.isPlaceholder,
    });

    return {
      validImage: {
        success: validImageResult.metadata.isPlaceholder !== true,
        correctUrlPattern: isValidImageUrl,
        urls: {
          original: validImageResult.metadata.originalUrl,
          highRes: validImageResult.highResUrl,
          lowRes: validImageResult.lowResUrl,
        },
      },
      placeholderImage: {
        success: placeholderResult.metadata.isPlaceholder === true,
        urls: {
          highRes: placeholderResult.highResUrl,
          lowRes: placeholderResult.lowResUrl,
        },
      },
    };
  } catch (error) {
    logger.error("Image processing test failed:", { error });
    throw error;
  }
}

async function testSync() {
  try {
    logger.info("Starting test sync with group " + TEST_GROUP_ID);

    // Test image processing first
    logger.info("Testing image processing capabilities...");
    const imageResults = await testImageProcessing();
    logger.info("Image processing test results:", imageResults);

    // Monitor card sync with timeout
    const cardResult = await withTimeout(
      cardSync.syncCards({
        groupId: TEST_GROUP_ID,
        forceUpdate: true,
      }),
      MAX_SYNC_TIME
    );

    logger.info("Card sync results:", {
      processed: cardResult.itemsProcessed,
      updated: cardResult.itemsUpdated,
      errors: cardResult.errors,
      timing: cardResult.timing,
    });

    // Monitor price sync with timeout
    const priceResult = await withTimeout(
      priceSync.syncPrices({
        groupId: TEST_GROUP_ID,
        forceUpdate: true,
      }),
      MAX_SYNC_TIME
    );

    logger.info("Price sync results:", {
      processed: priceResult.itemsProcessed,
      updated: priceResult.itemsUpdated,
      errors: priceResult.errors,
      timing: priceResult.timing,
    });

    // Validate results
    const validationResults = {
      imageProcessing: imageResults,
      cardSync: {
        success: cardResult.success,
        hasUpdates: cardResult.itemsUpdated > 0,
        hasErrors: cardResult.errors.length > 0,
      },
      priceSync: {
        success: priceResult.success,
        hasUpdates: priceResult.itemsUpdated > 0,
        hasErrors: priceResult.errors.length > 0,
      },
    };

    logger.info("Test validation results:", validationResults);

    // Log any errors
    const allErrors = [...cardResult.errors, ...priceResult.errors];
    if (allErrors.length > 0) {
      logger.error("Errors during sync:", { errors: allErrors });
    }

    return validationResults;
  } catch (error) {
    if (error instanceof TimeoutError) {
      logger.error("Sync operation timed out", { error });
    } else {
      logger.error("Test sync failed:", { error });
    }
    throw error;
  }
}

// Execute if run directly
if (require.main === module) {
  testSync()
    .then((results) => {
      console.log("Test sync completed successfully!");
      console.log("Results:", JSON.stringify(results, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.error("Test failed:", error);
      process.exit(1);
    });
}

export { testSync, testImageProcessing };
