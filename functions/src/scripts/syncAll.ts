// src/scripts/syncAll.ts
import { cardSync } from "../services/cardSync";
import { logger } from "../utils/logger";
import { db } from "../config/firebase";
import { main as updateCards } from "./updateCardsWithSquareEnixData";
import { squareEnixStorage } from "../services/squareEnixStorageService";
import { searchIndex } from "../services/searchIndexService";

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
    logger.info("Step 1: Starting TCGCSV sync", { options });
    const tcgResult = await cardSync.syncCards(options);
    if (!tcgResult.success) {
      throw new Error("TCGCSV sync failed");
    }
    await logger.info("Step 1: TCGCSV sync completed:", {
      success: tcgResult.success,
      processed: tcgResult.itemsProcessed,
      updated: tcgResult.itemsUpdated,
      errors: tcgResult.errors.length,
      duration: `${tcgResult.timing.duration}s`,
    });

    // Step 2: Sync cards from Square Enix API (force update on first sync to recalculate hashes)
    await logger.info("Step 2: Starting Square Enix sync", { options });
    const seResult = await squareEnixStorage.syncSquareEnixCards({
      ...options,
      forceUpdate: options.forceUpdate || process.env.RECALCULATE_HASHES === "true",
    });
    if (!seResult.success) {
      throw new Error("Square Enix sync failed");
    }
    await logger.info("Step 2: Square Enix sync completed:", {
      success: seResult.success,
      processed: seResult.itemsProcessed,
      updated: seResult.itemsUpdated,
      errors: seResult.errors.length,
      duration: `${seResult.timing.duration}s`,
    });

    // Step 3: Update TCG cards with Square Enix data (force update if Step 2 was forced)
    await logger.info("Step 3: Starting Square Enix data update", { options });
    const updateResult = await updateCards({
      forceUpdate: options.forceUpdate || process.env.RECALCULATE_HASHES === "true",
    });
    if (!updateResult.success) {
      throw new Error(updateResult.error || "Square Enix data update failed");
    }
    await logger.info("Step 3: Square Enix data update completed:", {
      success: updateResult.success,
      totalCards: updateResult.totalCards,
      matchesFound: updateResult.matchesFound,
      cardsUpdated: updateResult.cardsUpdated,
      durationSeconds: updateResult.durationSeconds,
    });

    // Step 4: Update search index
    await logger.info("Step 4: Starting search index update", { options });
    let searchResult;
    try {
      searchResult = await searchIndex.updateSearchIndex();
      if (!searchResult.totalProcessed) {
        throw new Error("Search index update failed - no cards processed");
      }
      await logger.info("Step 4: Search index update completed:", {
        totalProcessed: searchResult.totalProcessed,
        totalUpdated: searchResult.totalUpdated,
        success: true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Search index update failed: ${errorMessage}`);
    }

    // Log final success with all results
    await logger.info("Complete sync process finished successfully", {
      tcgSync: tcgResult,
      seSync: seResult,
      seUpdate: updateResult,
      searchIndex: searchResult || { success: false, error: "Search index update failed" },
    });

    // Clean shutdown - only do this once
    await logger.disableFirestore();
    await db.terminate();
    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await logger.error("Sync process failed:", { error: errorMessage });

    // Ensure all logs are written and disable Firestore logging before termination
    await logger.disableFirestore();

    // Clean shutdown - only do this once
    await logger.disableFirestore();
    await db.terminate();
    process.exit(1);
  }
}

// Run the sync
main().catch(console.error);
