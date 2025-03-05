// src/scripts/checkCard.ts
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

    logger.info(`Checking card with ID: ${cardId}`);

    // Get the card from Firestore
    const cardDoc = await db.collection(COLLECTION.CARDS).doc(cardId).get();

    if (!cardDoc.exists) {
      console.log(`Card with ID ${cardId} not found in Firestore.`);
      await db.terminate();
      process.exit(1);
    }

    const card = cardDoc.data() || {};
    console.log("\n=== TCGCSV Card Data ===\n");
    console.log(JSON.stringify(card, null, 2));
    console.log("\n=======================\n");

    // Find matching Square Enix card
    console.log("Looking for matching Square Enix card...");

    // Get all card numbers for the card
    const cardNumbers: string[] = [];
    if (card.cardNumbers) cardNumbers.push(...card.cardNumbers);
    if (card.fullCardNumber) cardNumbers.push(card.fullCardNumber);
    if (card.primaryCardNumber) cardNumbers.push(card.primaryCardNumber);
    if (card.number) cardNumbers.push(card.number);

    // Remove duplicates
    const uniqueCardNumbers = [...new Set(cardNumbers)];
    console.log(`Card numbers: ${uniqueCardNumbers.join(", ")}`);

    // Try to find matching Square Enix card
    let matchedSeCard: any = null;
    for (const cardNumber of uniqueCardNumbers) {
      // Square Enix cards are stored with semicolons instead of slashes
      const sanitizedCode = cardNumber.replace(/\//g, ";");
      const seCardDoc = await db.collection(COLLECTION.SQUARE_ENIX_CARDS).doc(sanitizedCode).get();

      if (seCardDoc.exists) {
        matchedSeCard = seCardDoc.data();
        console.log(`Found matching Square Enix card with code: ${cardNumber}`);
        break;
      }
    }

    if (!matchedSeCard) {
      // Try a more flexible search
      console.log("No exact match found, trying a more flexible search...");

      const seCardsSnapshot = await db.collection(COLLECTION.SQUARE_ENIX_CARDS).get();
      const allSeCards = seCardsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      for (const seCardItem of allSeCards) {
        const seCardNumbers = seCardItem.id.split("_")[0].replace(/;/g, "/").split("/");

        for (const seCardNumber of seCardNumbers) {
          for (const cardNumber of uniqueCardNumbers) {
            // Normalize for comparison
            const normalizedSeNumber = seCardNumber.replace(/[-\s.,;/]/g, "").toUpperCase();
            const normalizedCardNumber = cardNumber.replace(/[-\s.,;/]/g, "").toUpperCase();

            if (normalizedSeNumber === normalizedCardNumber) {
              console.log(
                `Found matching Square Enix card with normalized code: ${seCardNumber} (original: ${seCardItem.id})`
              );
              matchedSeCard = seCardItem;
              break;
            }
          }
          if (matchedSeCard) break;
        }
        if (matchedSeCard) break;
      }
    }

    if (matchedSeCard) {
      console.log("\n=== Square Enix Card Data ===\n");
      console.log(JSON.stringify(matchedSeCard, null, 2));
      console.log("\n============================\n");

      // Compare fields
      console.log("\n=== Field Comparison ===\n");
      console.log(`cardType: TCGCSV=${card.cardType || "null"}, SE=${matchedSeCard.type_en || "null"}`);
      console.log(
        `categories: TCGCSV=${JSON.stringify(card.categories || [])}, SE=[${matchedSeCard.category_1 || ""}${
          matchedSeCard.category_2 ? ", " + matchedSeCard.category_2 : ""
        }]`
      );
      console.log(`cost: TCGCSV=${card.cost || "null"}, SE=${matchedSeCard.cost || "null"}`);
      console.log(`power: TCGCSV=${card.power || "null"}, SE=${matchedSeCard.power || "null"}`);
      console.log(
        `elements: TCGCSV=${JSON.stringify(card.elements || [])}, SE=${JSON.stringify(matchedSeCard.element || [])}`
      );
      console.log("\n======================\n");
    } else {
      console.log("No matching Square Enix card found.");
    }

    // Clean shutdown
    await db.terminate();
    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Error checking card:", { error: errorMessage });

    // Clean shutdown
    await db.terminate();
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);
