// src/scripts/cleanupSetsField.ts
import { db, COLLECTION } from "../config/firebase";
import { logger } from "../utils/logger";
import { RetryWithBackoff } from "../utils/retry";
import { OptimizedBatchProcessor } from "../services/batchProcessor";
import { FieldValue } from "firebase-admin/firestore";

const retry = new RetryWithBackoff();
const batchProcessor = new OptimizedBatchProcessor(db);

async function main() {
  const startTime = Date.now();
  try {
    logger.info("Starting sets field cleanup");

    // Load all cards
    const cardsSnapshot = await retry.execute(() => db.collection(COLLECTION.CARDS).get());
    logger.info(`Loaded ${cardsSnapshot.size} cards`);

    let processedCount = 0;
    let updatedCount = 0;

    // Process all cards
    for (const doc of cardsSnapshot.docs) {
      processedCount++;
      const data = doc.data();

      // Only update if sets field exists
      if ("sets" in data) {
        updatedCount++;
        batchProcessor.addOperation((batch) => {
          batch.update(doc.ref, {
            sets: FieldValue.delete(),
            lastUpdated: FieldValue.serverTimestamp(),
          });
        });
      }

      // Log progress every 100 cards
      if (processedCount % 100 === 0) {
        logger.info(`Progress: ${processedCount}/${cardsSnapshot.size} cards processed`);
      }
    }

    // Commit all batches
    await batchProcessor.commitAll();

    const duration = (Date.now() - startTime) / 1000;
    logger.info("Cleanup completed", {
      totalCards: cardsSnapshot.size,
      processedCards: processedCount,
      updatedCards: updatedCount,
      durationSeconds: duration.toFixed(2),
    });

    return {
      success: true,
      totalCards: cardsSnapshot.size,
      processedCards: processedCount,
      updatedCards: updatedCount,
      durationSeconds: duration,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Cleanup failed", { error: errorMessage });
    return {
      success: false,
      error: errorMessage,
    };
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error("Fatal error", { error });
    process.exit(1);
  });
}
