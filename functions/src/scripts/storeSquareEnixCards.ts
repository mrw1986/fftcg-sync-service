import { squareEnixSync } from "../services/squareEnixSync";
import { logger } from "../utils/logger";
import { db, COLLECTION } from "../config/firebase";
import { FieldValue } from "firebase-admin/firestore";
import { SquareEnixCardDoc } from "../types";

async function main() {
  try {
    logger.info("Starting Square Enix cards storage process");

    // Fetch cards from API
    const cards = await squareEnixSync.fetchAllCards();
    logger.info(`Fetched ${cards.length} cards from Square Enix API`);

    // Create a batch to handle multiple writes
    let batch = db.batch();
    let operationCount = 0;
    const BATCH_SIZE = 500; // Firestore batch limit is 500

    // Process each card
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      
      // Verify the card has an id
      if (!card.id) {
        logger.error(`Card at index ${i} missing id`, { card });
        continue;
      }

      // Create the document data
      const cardDoc: SquareEnixCardDoc = {
        id: card.id,
        code: card.code,
        name: {
          en: card.name_en,
          de: card.name_de,
          es: card.name_es,
          fr: card.name_fr,
          it: card.name_it,
          ja: card.name_ja,
        },
        type: {
          en: card.type_en,
          de: card.type_de,
          es: card.type_es,
          fr: card.type_fr,
          it: card.type_it,
          ja: card.type_ja,
        },
        job: {
          en: card.job_en,
          de: card.job_de,
          es: card.job_es,
          fr: card.job_fr,
          it: card.job_it,
          ja: card.job_ja,
        },
        text: {
          en: card.text_en,
          de: card.text_de,
          es: card.text_es,
          fr: card.text_fr,
          it: card.text_it,
          ja: card.text_ja,
        },
        element: card.element,
        rarity: card.rarity,
        cost: card.cost,
        power: card.power,
        category_1: card.category_1,
        category_2: card.category_2,
        multicard: card.multicard === "1",
        ex_burst: card.ex_burst === "1",
        set: card.set,
        images: {
          thumbs: card.images.thumbs,
          full: card.images.full,
        },
        lastUpdated: FieldValue.serverTimestamp(),
      };

      // Add document to batch using id as document ID
      batch.set(
        db.collection(COLLECTION.SQUARE_ENIX_CARDS).doc(card.id.toString()),
        cardDoc
      );
      operationCount++;

      // If we've reached batch size limit, commit and start new batch
      if (operationCount === BATCH_SIZE) {
        await batch.commit();
        logger.info(`Committed batch of ${operationCount} documents`);
        batch = db.batch();
        operationCount = 0;
      }
    }

    // Commit any remaining documents
    if (operationCount > 0) {
      await batch.commit();
      logger.info(`Committed final batch of ${operationCount} documents`);
    }

    logger.info("Successfully stored all Square Enix cards in Firestore");

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to store Square Enix cards", { error: errorMessage });
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);
