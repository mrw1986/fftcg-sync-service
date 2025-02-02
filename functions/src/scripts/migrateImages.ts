// src/scripts/migrateImages.ts
import { db, COLLECTION } from "../config/firebase";
import { storageService } from "../services/storageService";
import { logger } from "../utils/logger";
import { RetryWithBackoff } from "../utils/retry";

const retry = new RetryWithBackoff();

async function migrateImages() {
  try {
    logger.info("Starting image migration");

    // Get all cards from Firestore
    const cardsSnapshot = await db.collection(COLLECTION.CARDS).get();
    const totalCards = cardsSnapshot.size;
    let processed = 0;
    let updated = 0;
    let errors = 0;

    logger.info(`Found ${totalCards} cards to process`);

    for (const cardDoc of cardsSnapshot.docs) {
      try {
        processed++;
        const card = cardDoc.data();
        const productId = card.productId;
        const groupId = card.groupId.toString();

        // Get original image URL from metadata
        const imageMetadata = await cardDoc.ref.collection("metadata").doc("image").get();
        const originalUrl = imageMetadata.exists ? imageMetadata.data()?.originalUrl : null;

        if (!originalUrl) {
          logger.info(`No original URL found for card ${productId}, skipping`);
          continue;
        }

        // Process and store images with new naming
        const imageResult = await retry.execute(() =>
          storageService.processAndStoreImage(originalUrl, productId, groupId)
        );

        // Update Firestore document with new URLs
        await cardDoc.ref.update({
          fullResUrl: imageResult.fullResUrl,
          highResUrl: imageResult.highResUrl,
          lowResUrl: imageResult.lowResUrl,
        });

        // Update image metadata
        await cardDoc.ref.collection("metadata").doc("image").set(
          imageResult.metadata,
          { merge: true }
        );

        updated++;

        if (processed % 100 === 0) {
          logger.info(`Progress: ${processed}/${totalCards} (${updated} updated, ${errors} errors)`);
        }
      } catch (error) {
        errors++;
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(`Error processing card ${cardDoc.id}:`, { error: errorMessage });
      }
    }

    logger.info("Migration completed", {
      processed,
      updated,
      errors,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Migration failed:", { error: errorMessage });
    throw error;
  }
}

// Run migration
migrateImages().catch(console.error);
