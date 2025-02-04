import { db, COLLECTION } from "../config/firebase";
import { logger } from "../utils/logger";
import { RetryWithBackoff } from "../utils/retry";
import { OptimizedBatchProcessor } from "../services/batchProcessor";
import { FieldValue } from "firebase-admin/firestore";

interface TcgCard {
  id: string;
  name: string;
  cardNumbers?: string[];
  fullCardNumber?: string;
  number?: string;
  primaryCardNumber?: string;
  power?: string;
  cost?: string;
  job?: string;
  rarity?: string;
  cardType?: string;
  category?: string;
  elements?: string[];
}

interface SquareEnixCard {
  id: string;
  code: string;
  name: string;
  type: string;
  category_1: string;
  element: string[];
  job: string;
  power: string;
  cost: string;
  rarity: string;
}

const retry = new RetryWithBackoff();
const batchProcessor = new OptimizedBatchProcessor(db);

// Check if a TCG card matches a Square Enix card
function findCardNumberMatch(tcgCard: TcgCard, seCard: SquareEnixCard): boolean {
  // Check each possible number field
  if (tcgCard.cardNumbers?.includes(seCard.code)) {
    logger.info("Matched on cardNumbers array", { 
      tcgCard: tcgCard.id, 
      seCard: seCard.id,
      code: seCard.code 
    });
    return true;
  }

  if (tcgCard.fullCardNumber === seCard.code) {
    logger.info("Matched on fullCardNumber", { 
      tcgCard: tcgCard.id, 
      seCard: seCard.id,
      code: seCard.code 
    });
    return true;
  }

  if (tcgCard.number === seCard.code) {
    logger.info("Matched on number", { 
      tcgCard: tcgCard.id, 
      seCard: seCard.id,
      code: seCard.code 
    });
    return true;
  }

  if (tcgCard.primaryCardNumber === seCard.code) {
    logger.info("Matched on primaryCardNumber", { 
      tcgCard: tcgCard.id, 
      seCard: seCard.id,
      code: seCard.code 
    });
    return true;
  }

  return false;
}

// Get fields that need to be updated
function getFieldsToUpdate(tcgCard: TcgCard, seCard: SquareEnixCard): Partial<TcgCard> {
  const updates: Partial<TcgCard> = {};

  // Only update fields that are empty or missing in tcgCard
  if (!tcgCard.cardType && seCard.type) updates.cardType = seCard.type;
  if (!tcgCard.category && seCard.category_1) updates.category = seCard.category_1;
  if ((!tcgCard.elements || tcgCard.elements.length === 0) && seCard.element) {
    updates.elements = seCard.element;
  }
  if (!tcgCard.job && seCard.job) updates.job = seCard.job;
  if (!tcgCard.power && seCard.power) updates.power = seCard.power;
  if (!tcgCard.rarity && seCard.rarity) updates.rarity = seCard.rarity;

  return updates;
}

async function main() {
  try {
    logger.info("Starting card update process");

    // Fetch all cards
    const [tcgCardsSnapshot, seCardsSnapshot] = await Promise.all([
      retry.execute(() => 
        db.collection(COLLECTION.CARDS)
          .get()
      ),
      retry.execute(() => 
        db.collection(COLLECTION.SQUARE_ENIX_CARDS)
          .get()
      )
    ]);

    const tcgCards = tcgCardsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as TcgCard[];

    const seCards = seCardsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as SquareEnixCard[];

    logger.info(`Fetched ${tcgCards.length} TCG cards and ${seCards.length} Square Enix cards`);

    let matchCount = 0;
    let updateCount = 0;

    // Process each TCG card
    for (const tcgCard of tcgCards) {
      logger.info("Processing card", {
        id: tcgCard.id,
        name: tcgCard.name,
        numbers: {
          cardNumbers: tcgCard.cardNumbers,
          fullCardNumber: tcgCard.fullCardNumber,
          number: tcgCard.number,
          primaryCardNumber: tcgCard.primaryCardNumber
        }
      });

      // Find potential matches based on card numbers
      const matches = seCards.filter(seCard => findCardNumberMatch(tcgCard, seCard));

      if (matches.length === 0) continue;

      matchCount++;

      // Use the first valid match
      const match = matches[0];
      const updates = getFieldsToUpdate(tcgCard, match);

      // Only update if there are fields to update
      if (Object.keys(updates).length > 0) {
        logger.info("Updating card with Square Enix data", {
          tcgCard: {
            id: tcgCard.id,
            name: tcgCard.name,
            currentValues: {
              cardType: tcgCard.cardType,
              category: tcgCard.category,
              elements: tcgCard.elements,
              job: tcgCard.job,
              power: tcgCard.power,
              rarity: tcgCard.rarity
            }
          },
          seCard: {
            id: match.id,
            name: match.name,
            newValues: {
              cardType: match.type,
              category: match.category_1,
              elements: match.element,
              job: match.job,
              power: match.power,
              rarity: match.rarity
            }
          },
          updates
        });

        await batchProcessor.addOperation((batch) => {
          const cardRef = db.collection(COLLECTION.CARDS).doc(tcgCard.id);
          batch.update(cardRef, {
            ...updates,
            lastUpdated: FieldValue.serverTimestamp()
          });
        });
        updateCount++;
      } else {
        logger.info("No updates needed for card", {
          id: tcgCard.id,
          name: tcgCard.name
        });
      }
    }

    // Commit any remaining updates
    await batchProcessor.commitAll();

    logger.info("Update process completed", {
      totalCards: tcgCards.length,
      matchesFound: matchCount,
      cardsUpdated: updateCount
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Update process failed", { error: errorMessage });
    process.exit(1);
  }
}

// Run the update
main().catch(console.error);
