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
  power?: number;
  cost?: number;
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
  // For Promo cards, only match on the non-PR part of the number
  const isPromo = isPromoCard(tcgCard);
  
  // Helper to extract the base card number from a PR number
  const getBaseNumber = (num: string): string | null => {
    const match = num.match(/PR-\d+\/(.+)/);
    return match ? match[1] : null;
  };

  // Check each possible number field
  if (tcgCard.cardNumbers?.some(num => {
    if (isPromo) {
      const baseNum = getBaseNumber(num);
      return baseNum === seCard.code;
    }
    return num === seCard.code;
  })) {
    logger.info("Matched on cardNumbers array", { 
      tcgCard: tcgCard.id, 
      seCard: seCard.id,
      code: seCard.code,
      isPromo
    });
    return true;
  }

  if (isPromo) {
    const baseFullNumber = tcgCard.fullCardNumber ? getBaseNumber(tcgCard.fullCardNumber) : null;
    const baseNumber = tcgCard.number ? getBaseNumber(tcgCard.number) : null;
    const basePrimaryNumber = tcgCard.primaryCardNumber ? getBaseNumber(tcgCard.primaryCardNumber) : null;

    if (baseFullNumber === seCard.code) {
      logger.info("Matched Promo on fullCardNumber base number", { 
        tcgCard: tcgCard.id, 
        seCard: seCard.id,
        code: seCard.code,
        baseNumber: baseFullNumber
      });
      return true;
    }

    if (baseNumber === seCard.code) {
      logger.info("Matched Promo on number base number", { 
        tcgCard: tcgCard.id, 
        seCard: seCard.id,
        code: seCard.code,
        baseNumber
      });
      return true;
    }

    if (basePrimaryNumber === seCard.code) {
      logger.info("Matched Promo on primaryCardNumber base number", { 
        tcgCard: tcgCard.id, 
        seCard: seCard.id,
        code: seCard.code,
        baseNumber: basePrimaryNumber
      });
      return true;
    }
  } else {
    // Regular non-Promo matching
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
  }

  return false;
}

// Check if a card is a Promo variant
function isPromoCard(card: TcgCard): boolean {
  const allNumbers = [
    ...(card.cardNumbers || []),
    card.fullCardNumber,
    card.number,
    card.primaryCardNumber
  ].filter(Boolean);

  return allNumbers.some(num => num?.includes('PR'));
}

// Map Square Enix rarity abbreviation to full word
function mapRarity(abbreviation: string): string {
  const rarityMap: Record<string, string> = {
    'C': 'Common',
    'R': 'Rare',
    'H': 'Hero',
    'L': 'Legend',
    'S': 'Starter'
  };
  return rarityMap[abbreviation] || abbreviation;
}

// Convert string to number, return null if invalid
function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const num = parseInt(value.trim());
  return isNaN(num) ? null : num;
}

// Get fields that need to be updated
function getFieldsToUpdate(tcgCard: TcgCard, seCard: SquareEnixCard): Partial<TcgCard> {
  const updates: Partial<TcgCard> = {};
  const isPromo = isPromoCard(tcgCard);

  // For Promo cards, force rarity to "Promo"
  if (isPromo) {
    if (tcgCard.rarity !== 'Promo') {
      updates.rarity = 'Promo';
      logger.info("Setting Promo rarity for card", {
        id: tcgCard.id,
        name: tcgCard.name,
        currentRarity: tcgCard.rarity
      });
    }
  }

  // Compare and update fields
  if (tcgCard.cardType !== seCard.type) {
    updates.cardType = seCard.type;
  }

  if (tcgCard.category !== seCard.category_1) {
    updates.category = seCard.category_1;
  }

  // Convert and compare cost (string -> number)
  const seCost = parseNumber(seCard.cost);
  if (seCost !== null && tcgCard.cost !== seCost) {
    updates.cost = seCost;
    logger.info("Updating cost", {
      id: tcgCard.id,
      name: tcgCard.name,
      oldCost: tcgCard.cost,
      newCost: seCost,
      seCardCost: seCard.cost
    });
  }

  // Compare arrays
  const currentElements = tcgCard.elements || [];
  if (JSON.stringify(currentElements.sort()) !== JSON.stringify(seCard.element.sort())) {
    updates.elements = seCard.element;
  }

  if (tcgCard.job !== seCard.job) {
    updates.job = seCard.job;
  }

  if (tcgCard.name !== seCard.name) {
    updates.name = seCard.name;
  }

  // Convert and compare power (string -> number)
  const sePower = parseNumber(seCard.power);
  if (sePower !== null && tcgCard.power !== sePower) {
    updates.power = sePower;
    logger.info("Updating power", {
      id: tcgCard.id,
      name: tcgCard.name,
      oldPower: tcgCard.power,
      newPower: sePower,
      seCardPower: seCard.power
    });
  }

  // Only update rarity for non-Promo cards
  if (!isPromo && tcgCard.rarity !== mapRarity(seCard.rarity)) {
    updates.rarity = mapRarity(seCard.rarity);
  }

  // Log what's being updated and why
  if (Object.keys(updates).length > 0) {
    logger.info("Field differences found", {
      tcgCard: {
        id: tcgCard.id,
        name: tcgCard.name,
        currentValues: {
          cardType: tcgCard.cardType,
          category: tcgCard.category,
          cost: tcgCard.cost,
          elements: tcgCard.elements,
          job: tcgCard.job,
          name: tcgCard.name,
          power: tcgCard.power,
          rarity: tcgCard.rarity
        }
      },
      seCard: {
        id: seCard.id,
        name: seCard.name,
        values: {
          type: seCard.type,
          category_1: seCard.category_1,
          name: seCard.name,
          cost: seCard.cost,
          element: seCard.element,
          job: seCard.job,
          power: seCard.power,
          rarity: seCard.rarity
        }
      },
      updates
    });
  }

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
