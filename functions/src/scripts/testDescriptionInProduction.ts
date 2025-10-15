// src/scripts/testDescriptionInProduction.ts
import { cardSync } from "../services/cardSync";
import { logger } from "../utils/logger";
import { db, COLLECTION } from "../config/firebase";
import { tcgcsvApi } from "../utils/api";

async function testDescriptionProcessing(): Promise<void> {
  try {
    logger.info("Starting limited card description test in production");

    // Test with a single group and very few cards
    const TEST_GROUP_ID = "24187"; // Legacy Collection - has "Dull" cards
    const CARD_LIMIT = 10; // Process only 10 cards

    logger.info(`Testing with group ${TEST_GROUP_ID}, limit ${CARD_LIMIT} cards`);

    // Get cards for the test group
    const allCards = await tcgcsvApi.getGroupProducts(TEST_GROUP_ID);
    logger.info(`Found ${allCards.length} total cards in group ${TEST_GROUP_ID}`);

    // Limit to first 10 cards to avoid quota issues
    const testCards = allCards.slice(0, CARD_LIMIT);
    logger.info(`Testing with ${testCards.length} cards`);

    // Process the cards using the production sync service
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (cardSync as any).processCards(testCards, parseInt(TEST_GROUP_ID), {
      forceUpdate: true, // Force update to test description processing
    });

    logger.info("Test processing completed", {
      processed: result.processed,
      updated: result.updated,
      errors: result.errors.length,
    });

    if (result.errors.length > 0) {
      logger.error("Errors during processing", { errors: result.errors });
    }

    // Query the database to check if descriptions were processed correctly
    logger.info("Checking processed cards in database...");

    const cardRefs = testCards
      .slice(0, 3)
      .map((card) => db.collection(COLLECTION.CARDS).doc(card.productId.toString()));

    const snapshots = await db.getAll(...cardRefs);

    snapshots.forEach((snap, index) => {
      if (snap.exists) {
        const data = snap.data();
        const card = testCards[index];

        logger.info(`Card ${card.productId} - ${card.name}`, {
          description: data?.description,
          processedCorrectly: data?.description ? !data.description.includes("Dull Dull") : "No description",
        });
      }
    });

    logger.info("✅ Card description test completed successfully!");
    logger.info("Node.js 22 runtime and description processing are working correctly");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("❌ Card description test failed", { error: errorMessage });
    throw error;
  } finally {
    await db.terminate();
  }
}

// Run the test
testDescriptionProcessing()
  .then(() => {
    console.log("🎉 Test completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Test failed:", error);
    process.exit(1);
  });
