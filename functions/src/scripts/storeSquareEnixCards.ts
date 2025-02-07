import { squareEnixStorage } from "../services/squareEnixStorageService";
import { logger } from "../utils/logger";

function parseArgs(args: string[]): { forceUpdate?: boolean } {
  const options: { forceUpdate?: boolean } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--force") {
      options.forceUpdate = true;
    }
  }

  return options;
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const options = parseArgs(args);

    logger.info("Starting Square Enix cards storage process", { options });

    const result = await squareEnixStorage.syncSquareEnixCards(options);

    logger.info("Square Enix cards storage process completed", {
      processed: result.itemsProcessed,
      updated: result.itemsUpdated,
      errors: result.errors.length,
      duration: result.timing.duration,
    });

    if (result.errors.length > 0) {
      logger.warn("Some errors occurred during sync:", {
        errors: result.errors,
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
