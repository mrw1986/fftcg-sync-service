import { squareEnixStorage } from "../services/squareEnixStorageService";
import { logger } from "../utils/logger";

async function main() {
  try {
    logger.info("Starting Square Enix cards storage process");

    const result = await squareEnixStorage.syncSquareEnixCards();

    logger.info("Square Enix cards storage process completed", {
      processed: result.itemsProcessed,
      updated: result.itemsUpdated,
      errors: result.errors.length,
      duration: result.timing.duration
    });

    if (result.errors.length > 0) {
      logger.warn("Some errors occurred during sync:", {
        errors: result.errors
      });
    }

    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to store Square Enix cards", { error: errorMessage });
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);
