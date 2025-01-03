// src/test/testSync.ts
import { cardSync } from "../services/cardSync";
import { priceSync } from "../services/priceSync";
import { logger } from "../utils/logger";
import { withTimeout, TimeoutError } from "../utils/timeout";

const MAX_SYNC_TIME = 30 * 60 * 1000; // 30 minutes
const TEST_GROUP_ID = "23244"; // Dawn of Heroes

async function testSync() {
  try {
    logger.info("Starting test sync with group " + TEST_GROUP_ID);

    // Monitor card sync with timeout
    const cardResult = await withTimeout(
      cardSync.syncCards({
        groupId: TEST_GROUP_ID,
        forceUpdate: true, // Add this to force update even if hash matches
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

    // Log any errors
    const allErrors = [...cardResult.errors, ...priceResult.errors];
    if (allErrors.length > 0) {
      logger.error("Errors during sync:", { errors: allErrors });
    }
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
    .then(() => {
      console.log("Test sync completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Test failed:", error);
      process.exit(1);
    });
}

export { testSync };
