// src/scripts/fixCardNames.ts
import { db, COLLECTION } from "../config/firebase";
import { logger } from "../utils/logger";
import { OptimizedBatchProcessor } from "../services/batchProcessor";
import { FieldValue } from "firebase-admin/firestore";

/**
 * This script fixes card names in the Firestore database that have incorrect formats
 * such as "Sephiroth (1" or "Sephiroth (B" instead of just "Sephiroth".
 * It also fixes names like "Lightning (19 (Full Art)" to "Lightning (Full Art)".
 *
 * It preserves names with complete parentheses containing special content like:
 * - "Moogle (Class Zero Cadet)"
 * - "Lann (Alternate Art Promo)"
 * - "Tifa (25th Anniversary Promo)"
 * - "Locke EX (April 2024)"
 */
async function fixCardNames() {
  logger.info("Starting card name fix script");

  const batchProcessor = new OptimizedBatchProcessor(db);
  let processed = 0;
  let updated = 0;

  // Special keywords that should be preserved
  const specialKeywords = [
    "Full Art",
    "Promo",
    "Road to World Championship",
    "Champion",
    "Anniversary",
    "Prerelease Promo",
    "Alternate Art Promo",
    "Full Art Reprint",
    "Buy A Box Promo",
    "Class Zero Cadet",
  ];

  // Month names for date detection
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  try {
    // Query for cards with names containing problematic patterns
    const cardsSnapshot = await db.collection(COLLECTION.CARDS).get();

    logger.info(`Found ${cardsSnapshot.size} cards total`);

    for (const doc of cardsSnapshot.docs) {
      processed++;
      const cardData = doc.data();
      const originalName = cardData.name;
      let newName = originalName;
      let needsUpdate = false;

      // Case 1: Fix incomplete parentheses like "Sephiroth (1" or "Sephiroth (B"
      const hasIncompleteParentheses = /\([A-C1-9](?!\))/.test(originalName);

      if (hasIncompleteParentheses) {
        // Check if it's a special case like "Lightning (19 (Full Art)"
        const partialContentMatch = originalName.match(/^(.*?)\s*\((\d+)\s+\((.*?)\)$/);

        if (partialContentMatch) {
          // This is a case like "Lightning (19 (Full Art)" -> "Lightning (Full Art)"
          const baseName = partialContentMatch[1];
          const specialContent = partialContentMatch[3];
          newName = `${baseName} (${specialContent})`;
          needsUpdate = true;
        } else {
          // This is a case like "Sephiroth (1" or "Sephiroth (B" -> "Sephiroth"
          newName = originalName.replace(/\s*\([A-C1-9][^)]*$/, "").trim();
          needsUpdate = true;
        }
      }

      // Skip update if the name contains special keywords that should be preserved
      const shouldPreserve = specialKeywords.some(
        (keyword) => originalName.includes(`(${keyword})`) || months.some((month) => originalName.includes(`(${month}`))
      );

      // Only update if:
      // 1. We need an update
      // 2. It's not a name we should preserve
      // 3. The name actually changed
      // 4. The name doesn't contain a month and year (like "April 2024")
      const containsMonthYear = months.some((month) => originalName.includes(month) && /\b\d{4}\b/.test(originalName));

      if (needsUpdate && !shouldPreserve && !containsMonthYear && originalName !== newName) {
        logger.info(`Fixing card name: "${originalName}" -> "${newName}"`, {
          cardId: doc.id,
          originalName,
          newName,
        });

        // Update the card document
        await batchProcessor.addOperation((batch) => {
          batch.update(doc.ref, {
            name: newName,
            lastUpdated: FieldValue.serverTimestamp(),
          });
        });

        updated++;
      }

      // Log progress every 100 cards
      if (processed % 100 === 0) {
        logger.info(`Progress: ${processed} cards processed, ${updated} updated`);
      }
    }

    // Commit all batched operations
    await batchProcessor.commitAll();

    logger.info(`Card name fix completed. Processed ${processed} cards, updated ${updated} cards.`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Error fixing card names", { error: errorMessage });
    throw error;
  }
}

// Execute the function if this script is run directly
if (require.main === module) {
  fixCardNames()
    .then(() => {
      logger.info("Card name fix script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("Card name fix script failed", { error });
      process.exit(1);
    });
}
