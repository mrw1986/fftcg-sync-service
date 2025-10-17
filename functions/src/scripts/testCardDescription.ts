import { db, COLLECTION } from "../config/firebase";
import { squareEnixSync } from "../services/squareEnixSync";
import { logger } from "../utils/logger";
import { translateDescription } from "../utils/elementTranslator";

async function testCardDescription() {
  try {
    // Get the specific card from Square Enix API
    logger.info("Fetching cards from Square Enix API");
    const seCards = await squareEnixSync.fetchAllCards();
    logger.info(`Fetched ${seCards.length} cards from Square Enix API`);

    // Find the specific card we're interested in
    const seCard = seCards.find((card) => card.code === "24-005L");

    if (!seCard) {
      logger.error("Square Enix card 24-005L (Clive) not found");
      return;
    }

    logger.info("Found Square Enix card:", {
      code: seCard.code,
      name: seCard.name_en,
      text: seCard.text_en,
      textLength: seCard.text_en?.length,
    });

    // Get the TCG card from Firestore
    const tcgCard = await db.collection(COLLECTION.CARDS).doc("593784").get();

    if (!tcgCard.exists) {
      logger.error("TCG card 593784 not found in Firestore");
      return;
    }

    const tcgData = tcgCard.data();

    logger.info("TCG card data:", {
      id: tcgCard.id,
      name: tcgData?.name,
      description: tcgData?.description,
      descriptionLength: tcgData?.description?.length,
    });

    // Test description translation
    const processedDescription = translateDescription(seCard.text_en);
    logger.info("Processed Square Enix description:", {
      original: seCard.text_en,
      processed: processedDescription,
      originalLength: seCard.text_en?.length,
      processedLength: processedDescription?.length,
    });

    // Compare descriptions
    logger.info("Description comparison:", {
      squareEnix: {
        raw: seCard.text_en,
        length: seCard.text_en?.length,
      },
      tcgplayer: {
        stored: tcgData?.description,
        length: tcgData?.description?.length,
      },
      processed: {
        text: processedDescription,
        length: processedDescription?.length,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Test failed:", { error: errorMessage });
  } finally {
    await db.terminate();
  }
}

testCardDescription().catch(console.error);
