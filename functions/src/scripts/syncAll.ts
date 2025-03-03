// src/scripts/syncAll.ts
import { cardSync } from "../services/cardSync";
import { logger } from "../utils/logger";
import { db, COLLECTION } from "../config/firebase";
import { main as updateCards } from "./updateCardsWithSquareEnixData";
import { squareEnixStorage } from "../services/squareEnixStorageService";
import { searchIndex } from "../services/searchIndexService";
import { groupSync } from "../services/groupSync";
import { filterAggregation } from "../services/filterAggregationService";
import { metadataService } from "../services/metadataService";
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

    // Initialize metadata document if it doesn't exist
    await logger.info("Initializing metadata document");
    const metadata = await metadataService.initializeMetadata();
    if (!metadata) {
      logger.warn("Failed to initialize metadata document, but continuing with sync");
    } else {
      logger.info("Metadata document initialized or already exists", {
        version: metadata.version,
        lastUpdated: metadata.lastUpdated,
      });
    }

    // Start sync in metadata
    await metadataService.startSync();

    // Step 1: Sync groups from TCGCSV API
    logger.info("Step 1: Starting group sync", { options });
    const groupResult = await groupSync.syncGroups(options);
    if (!groupResult.success) {
      await metadataService.addSyncError("Group sync failed");
      throw new Error("Group sync failed");
    }
    await logger.info("Step 1: Group sync completed:", {
      success: groupResult.success,
      processed: groupResult.itemsProcessed,
      updated: groupResult.itemsUpdated,
      errors: groupResult.errors.length,
      duration: `${groupResult.timing.duration}s`,
    });

    // Step 2: Sync cards from TCGCSV API
    logger.info("Step 2: Starting TCGCSV sync", { options });
    const tcgResult = await cardSync.syncCards(options);
    if (!tcgResult.success) {
      await metadataService.addSyncError("TCGCSV sync failed");
      throw new Error("TCGCSV sync failed");
    }
    await logger.info("Step 2: TCGCSV sync completed:", {
      success: tcgResult.success,
      processed: tcgResult.itemsProcessed,
      updated: tcgResult.itemsUpdated,
      errors: tcgResult.errors.length,
      duration: `${tcgResult.timing.duration}s`,
    });

    // Step 3: Sync cards from Square Enix API
    await logger.info("Step 3: Starting Square Enix sync", { options });
    const seResult = await squareEnixStorage.syncSquareEnixCards({
      ...options,
      forceUpdate: options.forceUpdate,
    });
    if (!seResult.success) {
      await metadataService.addSyncError("Square Enix sync failed");
      throw new Error("Square Enix sync failed");
    }
    await logger.info("Step 3: Square Enix sync completed:", {
      success: seResult.success,
      processed: seResult.itemsProcessed,
      updated: seResult.itemsUpdated,
      errors: seResult.errors.length,
      duration: `${seResult.timing.duration}s`,
    });

    // Step 4: Update TCG cards with Square Enix data
    await logger.info("Step 4: Starting Square Enix data update", { options });
    const updateResult = await updateCards({
      ...options,
      forceUpdate: options.forceUpdate,
    });
    if (!updateResult.success) {
      const errorMsg = updateResult.error || "Square Enix data update failed";
      await metadataService.addSyncError(errorMsg);
      throw new Error(errorMsg);
    }
    await logger.info("Step 4: Square Enix data update completed:", {
      success: updateResult.success,
      totalCards: updateResult.totalCards,
      matchesFound: updateResult.matchesFound,
      cardsUpdated: updateResult.cardsUpdated,
      durationSeconds: updateResult.durationSeconds,
    });

    // Step 5: Update search index
    await logger.info("Step 5: Starting search index update", { options });
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
        const errorMsg = "Search index update failed - no cards processed";
        await metadataService.addSyncError(errorMsg);
        throw new Error(errorMsg);
      }
      await logger.info("Step 5: Search index update completed:", {
        totalProcessed: searchResult.totalProcessed,
        totalUpdated: searchResult.totalUpdated,
        success: true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const errorMsg = `Search index update failed: ${errorMessage}`;
      await metadataService.addSyncError(errorMsg);
      throw new Error(errorMsg);
    }

    // Step 6: Update filters
    await logger.info("Step 6: Starting filter aggregation", { options });
    let filterResult;
    try {
      // Add a delay to ensure previous operations have completed
      await logger.info("Waiting for previous operations to settle...");
      // Keep connection alive during delay by doing a simple query
      await db.collection(COLLECTION.CARDS).limit(1).get();
      await new Promise((resolve) => setTimeout(resolve, 5000));
      // Verify connection is still active
      await db.collection(COLLECTION.CARDS).limit(1).get();

      await logger.info("Starting filter aggregation with options:", {
        forceUpdate: options.forceUpdate,
      });

      filterResult = await filterAggregation.updateFilters({
        ...options,
        forceUpdate: options.forceUpdate,
      });
      if (!filterResult.success) {
        const errorMsg = "Filter aggregation failed";
        await metadataService.addSyncError(errorMsg);
        throw new Error(errorMsg);
      }
      await logger.info("Step 6: Filter aggregation completed:", {
        processed: filterResult.itemsProcessed,
        updated: filterResult.itemsUpdated,
        errors: filterResult.errors.length,
        duration: `${filterResult.timing.duration}s`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const errorMsg = `Filter aggregation failed: ${errorMessage}`;
      await metadataService.addSyncError(errorMsg);
      throw new Error(errorMsg);
    }

    // Log final success with all results
    await logger.info("Complete sync process finished successfully", {
      groupSync: groupResult,
      tcgSync: tcgResult,
      seSync: seResult,
      seUpdate: updateResult,
      searchIndex: searchResult || { success: false, error: "Search index update failed" },
      filterAggregation: filterResult || { success: false, error: "Filter aggregation failed" },
    });

    // Get card and group counts for metadata
    const [cardCount, groupCount] = await Promise.all([
      db
        .collection(COLLECTION.CARDS)
        .count()
        .get()
        .then((snap) => snap.data().count),
      db
        .collection(COLLECTION.GROUPS)
        .count()
        .get()
        .then((snap) => snap.data().count),
    ]);

    // Update metadata to mark sync as completed
    await metadataService.completeSync(
      true, // success
      cardCount,
      groupCount,
      searchResult?.totalProcessed > 0, // searchIndexed
      filterResult?.success // filtersUpdated
    );

    // Clean shutdown - only do this once
    await logger.disableFirestore();
    await db.terminate();
    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await logger.error("Sync process failed:", { error: errorMessage });

    // Update metadata to mark sync as failed
    await metadataService.completeSync(false);
    await metadataService.addSyncError(errorMessage);

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
