// src/scripts/cleanupElements.ts
import { db } from "../config/firebase";
import { logger } from "../utils/logger";
import { FieldValue } from "firebase-admin/firestore";

async function cleanupElementsData(): Promise<void> {
  try {
    logger.info("Starting elements cleanup...");
    const cardsSnapshot = await db.collection("cards").get();
    const totalCards = cardsSnapshot.size;

    logger.info(`Found ${totalCards} cards to process`);

    // Process in batches of 500 (Firestore batch limit)
    const batchSize = 500;
    let batchCount = 0;
    let processedCount = 0;
    let batch = db.batch();
    let changes = 0;

    for (const doc of cardsSnapshot.docs) {
      const data = doc.data();

      // Only process if elements array exists
      if (data.elements !== undefined) {
        batch.update(doc.ref, {
          elements: FieldValue.delete(),
        });
        changes++;
      }

      // Delete Element document in extendedData
      const elementRef = doc.ref.collection("extendedData").doc("Element");
      batch.delete(elementRef);
      changes++;

      batchCount++;
      processedCount++;

      // Commit when batch is full
      if (batchCount >= batchSize) {
        await batch.commit();
        logger.info(`Processed ${processedCount}/${totalCards} cards (${changes} changes)`);
        batch = db.batch();
        batchCount = 0;
      }
    }

    // Commit any remaining operations
    if (batchCount > 0) {
      await batch.commit();
      logger.info(`Processed ${processedCount}/${totalCards} cards (${changes} changes)`);
    }

    logger.info("Elements cleanup completed successfully", {
      totalProcessed: processedCount,
      totalChanges: changes,
    });
  } catch (error) {
    logger.error("Elements cleanup failed", { error });
    throw error;
  }
}

// Execute if run directly
if (require.main === module) {
  cleanupElementsData()
    .then(() => {
      console.log("Cleanup completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Cleanup failed:", error);
      process.exit(1);
    });
}
