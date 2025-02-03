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

      // Element translation map
      const elementTranslations: { [key: string]: string } = {
        "火": "Fire",
        "氷": "Ice",
        "風": "Wind",
        "土": "Earth",
        "雷": "Lightning",
        "水": "Water",
        "光": "Light",
        "闇": "Dark"
      };

      // Create the document data
      const cardDoc: SquareEnixCardDoc = {
        id: card.id,
        code: card.code,
        name: card.name_en,
        type: card.type_en,
        job: card.job_en,
        text: card.text_en,
        element: card.element ? card.element.map((e: string) => elementTranslations[e] || e) : [],
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
