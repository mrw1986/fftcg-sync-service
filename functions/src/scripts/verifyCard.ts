// src/scripts/verifyCard.ts
import { db, COLLECTION } from "../config/firebase";
import { logger } from "../utils/logger";
import minimist from "minimist";

async function main() {
  try {
    // Parse command line arguments
    const argv = minimist(process.argv.slice(2), {
      string: ["card"],
      alias: {
        c: "card",
      },
    });

    const cardId = argv.card || "132429"; // Default to the example card if not specified

    logger.info(`Verifying card with ID: ${cardId}`);

    // Get the card from Firestore
    const cardDoc = await db.collection(COLLECTION.CARDS).doc(cardId).get();

    if (!cardDoc.exists) {
      console.log(`Card with ID ${cardId} not found in Firestore.`);
      await db.terminate();
      process.exit(1);
    }

    const card = cardDoc.data() || {};
    console.log("\n=== Card Data in Firestore ===\n");
    console.log(JSON.stringify(card, null, 2));
    console.log("\n============================\n");

    // Check specific fields
    console.log("\n=== Field Verification ===\n");
    console.log(`isNonCard: ${card.isNonCard}`);
    console.log(`cardType: ${card.cardType}`);
    console.log(`elements: ${JSON.stringify(card.elements)}`);
    console.log(`categories: ${JSON.stringify(card.categories)}`);
    console.log(`cost: ${card.cost}`);
    console.log(`power: ${card.power}`);
    console.log("\n=========================\n");

    // Clean shutdown
    await db.terminate();
    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Error verifying card:", { error: errorMessage });

    // Clean shutdown
    await db.terminate();
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);
