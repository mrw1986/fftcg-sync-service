// src/scripts/syncAllTest.ts
import { cardSync } from "../services/cardSync";
import { logger } from "../utils/logger";
import { db, COLLECTION } from "../config/firebase";
import { main as updateCards } from "./updateCardsWithSquareEnixData";
import { squareEnixStorage } from "../services/squareEnixStorageService";
import { searchIndex } from "../services/searchIndexService";

async function main() {
  try {
    logger.info("Starting test sync process with first 10 cards");

    // Step 1: Sync cards from TCGCSV API (limit to 10)
    logger.info("Step 1: Starting TCGCSV sync");
    const tcgResult = await cardSync.syncCards({ limit: 10 });
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

    // Step 2: Sync cards from Square Enix API (limit to 10)
    await logger.info("Step 2: Starting Square Enix sync");
    const seResult = await squareEnixStorage.syncSquareEnixCards({ limit: 10 });
    if (!seResult.success) {
      throw new Error("Square Enix sync failed");
    }

    // Log detailed hash information for Square Enix cards
    const seHashes = await db.collection(COLLECTION.SQUARE_ENIX_HASHES).limit(10).get();
    await logger.info("Square Enix hashes:", {
      hashes: seHashes.docs.map((doc) => ({
        code: doc.id,
        hash: doc.data().hash,
        lastUpdated: doc.data().lastUpdated,
      })),
    });

    await logger.info("Step 2: Square Enix sync completed:", {
      success: seResult.success,
      processed: seResult.itemsProcessed,
      updated: seResult.itemsUpdated,
      errors: seResult.errors.length,
      duration: `${seResult.timing.duration}s`,
    });

    // Step 3: Update TCG cards with Square Enix data (limit to 10)
    await logger.info("Step 3: Starting Square Enix data update");
    const updateResult = await updateCards({ limit: 10 });
    if (!updateResult.success) {
      throw new Error(updateResult.error || "Square Enix data update failed");
    }

    // Log detailed card data before/after updates
    const updatedCards = await db.collection(COLLECTION.CARDS).limit(10).get();
    await logger.info("Updated card data:", {
      cards: updatedCards.docs.map((doc) => ({
        id: doc.id,
        data: doc.data(),
      })),
    });

    await logger.info("Step 3: Square Enix data update completed:", {
      success: updateResult.success,
      totalCards: updateResult.totalCards,
      matchesFound: updateResult.matchesFound,
      cardsUpdated: updateResult.cardsUpdated,
      durationSeconds: updateResult.durationSeconds,
    });

    // Step 4: Update search index (limit to 10)
    await logger.info("Step 4: Starting search index update");
    let searchResult;
    try {
      searchResult = await searchIndex.updateSearchIndex({ limit: 10 });
      if (!searchResult.totalProcessed) {
        throw new Error("Search index update failed - no cards processed");
      }

      // Log detailed search term data
      const searchHashes = await db.collection(COLLECTION.SEARCH_HASHES).limit(10).get();
      await logger.info("Search term hashes:", {
        hashes: searchHashes.docs.map((doc) => ({
          id: doc.id,
          hash: doc.data().hash,
          lastUpdated: doc.data().lastUpdated,
        })),
      });

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
    await logger.info("Test sync process finished successfully", {
      tcgSync: tcgResult,
      seSync: seResult,
      seUpdate: updateResult,
      searchIndex: searchResult || { success: false, error: "Search index update failed" },
    });

    // Clean shutdown
    await logger.disableFirestore();
    await db.terminate();
    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await logger.error("Test sync failed:", { error: errorMessage });
    await logger.disableFirestore();
    await db.terminate();
    process.exit(1);
  }
}

// Run the sync
main().catch(console.error);
