import { squareEnixStorage } from "../services/squareEnixStorageService";
import { logger } from "../utils/logger";

async function main() {
  try {
    logger.info("Starting Square Enix storage test");

    // Sync Square Enix cards to Firestore
    const syncResult = await squareEnixStorage.syncSquareEnixCards();

    // Log detailed results
    logger.info("Square Enix sync results:", {
      processed: syncResult.itemsProcessed,
      updated: syncResult.itemsUpdated,
      errors: syncResult.errors,
      duration: syncResult.timing.duration,
    });

    // If there are errors, log them in detail
    if (syncResult.errors.length > 0) {
      logger.error("Square Enix sync errors:", {
        errorCount: syncResult.errors.length,
        errors: syncResult.errors.map((error) => ({
          error,
          timestamp: new Date().toISOString(),
        })),
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Test failed", { error: errorMessage });
    process.exit(1);
  }
}

// Run the test
main().catch(console.error);
