// src/scripts/fixReCardNumbers.ts
import { db, COLLECTION } from "../config/firebase";
import { logger } from "../utils/logger";
import { OptimizedBatchProcessor } from "../services/batchProcessor";
import { FieldValue } from "firebase-admin/firestore";

/**
 * This script fixes cards that have "Re-" prefix in their fullCardNumber
 * but not in their cardNumbers array.
 */
async function fixReCardNumbers() {
  logger.info("Starting Re- card number fix script");

  const batchProcessor = new OptimizedBatchProcessor(db);
  let processed = 0;
  let updated = 0;

  try {
    // Query for cards with fullCardNumber containing "Re-"
    const cardsSnapshot = await db
      .collection(COLLECTION.CARDS)
      .where("fullCardNumber", ">=", "Re-")
      .where("fullCardNumber", "<=", "Re-\uf8ff")
      .get();

    logger.info(`Found ${cardsSnapshot.size} cards with Re- prefix in fullCardNumber`);

    for (const doc of cardsSnapshot.docs) {
      processed++;
      const cardData = doc.data();
      const fullCardNumber = cardData.fullCardNumber;
      const cardNumbers = cardData.cardNumbers || [];

      // Extract the Re- number from the fullCardNumber
      const reNumberMatch = fullCardNumber.match(/Re-\d{3}[A-Z]/);
      if (!reNumberMatch) {
        logger.info(`No Re- number found in fullCardNumber: ${fullCardNumber}`);
        continue;
      }

      const reNumber = reNumberMatch[0];

      // Check if the Re- number is already in the cardNumbers array
      if (cardNumbers.includes(reNumber)) {
        logger.info(`Re- number ${reNumber} already in cardNumbers for card ${doc.id}`);
        continue;
      }

      // Add the Re- number to the cardNumbers array
      const updatedCardNumbers = [...cardNumbers, reNumber];

      logger.info(`Fixing card ${doc.id}: Adding ${reNumber} to cardNumbers`, {
        cardId: doc.id,
        fullCardNumber,
        originalCardNumbers: cardNumbers,
        updatedCardNumbers,
      });

      // Update the card document
      await batchProcessor.addOperation((batch) => {
        batch.update(doc.ref, {
          cardNumbers: updatedCardNumbers,
          lastUpdated: FieldValue.serverTimestamp(),
        });
      });

      updated++;

      // Log progress every 10 cards
      if (processed % 10 === 0) {
        logger.info(`Progress: ${processed} cards processed, ${updated} updated`);
      }
    }

    // Commit all batched operations
    await batchProcessor.commitAll();

    logger.info(`Re- card number fix completed. Processed ${processed} cards, updated ${updated} cards.`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Error fixing Re- card numbers", { error: errorMessage });
    throw error;
  }
}

// Execute the function if this script is run directly
if (require.main === module) {
  fixReCardNumbers()
    .then(() => {
      logger.info("Re- card number fix script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("Re- card number fix script failed", { error });
      process.exit(1);
    });
}
