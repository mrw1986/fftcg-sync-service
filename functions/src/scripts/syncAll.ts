// src/scripts/syncAll.ts
import { cardSync } from "../services/cardSync";
import { logger } from "../utils/logger";
import { db, COLLECTION } from "../config/firebase";
import { main as updateCards } from "./updateCardsWithSquareEnixData";
import { squareEnixStorage } from "../services/squareEnixStorageService";
import { searchIndex } from "../services/searchIndexService";
import minimist from "minimist";

function parseArgs(): { forceUpdate?: boolean; groupId?: string } {
  // Parse arguments with minimist
  const argv = minimist(process.argv.slice(2), {
    boolean: ["force"],
    string: ["group"],
    alias: {
      f: "force",
      g: "group",
    },
  });

  // Log raw arguments for debugging
  logger.info("Raw command line arguments:", {
    nodeExe: process.argv[0],
    scriptPath: process.argv[1],
    args: process.argv.slice(2),
    parsedArgs: argv,
  });

  const options: { forceUpdate?: boolean; groupId?: string } = {};

  // Set forceUpdate if --force flag is present
  if (argv.force) {
    options.forceUpdate = true;
  }

  // Check for group ID in both named and positional arguments
  const possibleGroupId = argv.group || argv._[0]?.toString();
  if (possibleGroupId && !isNaN(parseInt(possibleGroupId))) {
    options.groupId = possibleGroupId;
  }

  // Log the final options
  logger.info("Parsed options:", options);

  return options;
}

async function main() {
  try {
    const options = parseArgs();

    await logger.startSync();
    await logger.info("Starting complete sync process with options:", options);

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

    // Step 2: Sync cards from Square Enix API
    await logger.info("Step 2: Starting Square Enix sync", { options });
    const seResult = await squareEnixStorage.syncSquareEnixCards({
      ...options,
      forceUpdate: options.forceUpdate,
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

    // Step 3: Update TCG cards with Square Enix data
    await logger.info("Step 3: Starting Square Enix data update", { options });
    const updateResult = await updateCards({
      ...options,
      forceUpdate: options.forceUpdate,
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
      // Add a delay to ensure previous operations have completed
      await logger.info("Waiting for previous operations to settle...");
      // Keep connection alive during delay by doing a simple query
      await db.collection(COLLECTION.CARDS).limit(1).get();
      await new Promise((resolve) => setTimeout(resolve, 5000));
      // Verify connection is still active
      await db.collection(COLLECTION.CARDS).limit(1).get();

      await logger.info("Starting search index update with options:", {
        forceUpdate: options.forceUpdate,
      });

      searchResult = await searchIndex.updateSearchIndex({
        ...options,
        forceUpdate: options.forceUpdate,
      });
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
