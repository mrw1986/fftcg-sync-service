// src/scripts/syncAll.ts
import { cardSync } from "../services/cardSync";
import { squareEnixStorage } from "../services/squareEnixStorageService";
import { logger } from "../utils/logger";
import { db } from "../config/firebase";
import { main as updateCards } from "./updateCardsWithSquareEnixData";

function parseArgs(args: string[]): { forceUpdate?: boolean; groupId?: string } {
  const options: { forceUpdate?: boolean; groupId?: string } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--force") {
      options.forceUpdate = true;
    } else if (arg === "--group") {
      // Look ahead for the group ID
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("--")) {
        // Ensure group ID is a valid number
        const groupId = parseInt(nextArg);
        if (!isNaN(groupId)) {
          options.groupId = groupId.toString();
          i++; // Skip the group ID in the next iteration
        }
      }
    }
  }

  return options;
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const options = parseArgs(args);


    logger.info("Starting complete sync process with options:", options);

    // Step 1: Sync cards from TCGCSV API
    // This will store NULL for missing images (except for non-cards which get placeholder)
    logger.info("Step 1: Syncing cards from TCGCSV API", { options });
    const tcgResult = await cardSync.syncCards(options);
    logger.info("TCGCSV sync completed:", {
      success: tcgResult.success,
      processed: tcgResult.itemsProcessed,
      updated: tcgResult.itemsUpdated,
      errors: tcgResult.errors.length,
      duration: `${tcgResult.timing.duration}s`,
    });

    if (!tcgResult.success) {
      throw new Error("TCGCSV sync failed");
    }

    // Step 2: Sync cards from Square Enix API
    logger.info("Step 2: Syncing cards from Square Enix API", { options });
    const seResult = await squareEnixStorage.syncSquareEnixCards(options);
    logger.info("Square Enix sync completed:", {
      success: seResult.success,
      processed: seResult.itemsProcessed,
      updated: seResult.itemsUpdated,
      errors: seResult.errors.length,
      duration: `${seResult.timing.duration}s`,
    });

    if (!seResult.success) {
      throw new Error("Square Enix sync failed");
    }

    // Step 3: Update cards with Square Enix data
    logger.info("Step 3: Updating cards with Square Enix data", { options });
    // Pass force flag and groupId through process.argv
    const updateArgs = [];
    if (options.forceUpdate) {
      updateArgs.push("--force");
    }
    if (options.groupId) {
      updateArgs.push("--group", options.groupId);
    }
    process.argv = [process.argv[0], process.argv[1], ...updateArgs];
    const updateResult = await updateCards();

    if (!updateResult.success) {
      throw new Error(updateResult.error || "Update cards process failed");
    }

    // Log final success
    await logger.info("Complete sync process finished successfully", {
      tcgSync: tcgResult,
      seSync: seResult,
      updateSync: updateResult
    });

    // Ensure all logs are written and disable Firestore logging before termination
    await logger.disableFirestore();

    // Clean shutdown
    await db.terminate();
    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await logger.error("Sync process failed:", { error: errorMessage });
    
    // Ensure all logs are written and disable Firestore logging before termination
    await logger.disableFirestore();
    
    // Clean shutdown on error
    await db.terminate();
    process.exit(1);
  }
}

// Run the sync
main().catch(console.error);
