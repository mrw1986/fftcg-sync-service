import { db, COLLECTION } from "../config/firebase";
import { logger } from "../utils/logger";
import { RetryWithBackoff } from "../utils/retry";
import { OptimizedBatchProcessor } from "../services/batchProcessor";
import { FieldValue } from "firebase-admin/firestore";
import { storageService } from "../services/storageService";

export interface TcgCard {
  [key: string]: any; // Add index signature for dynamic field access
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
  category_2?: string;
  cleanName?: string;
  elements?: string[];
  sets?: string[];
  fullResUrl?: string | null;
  highResUrl?: string | null;
  lowResUrl?: string | null;
  groupId?: number;
  isNonCard: boolean;
}

export interface SquareEnixCard {
  id: string;
  code: string;
  name: string;
  type: string;
  category_1: string;
  category_2: string | null;
  element: string[];
  job: string;
  power: string;
  cost: string;
  rarity: string;
  set: string[];
  images: {
    thumbs: string[];
    full: string[];
  };
}

type FieldMappings = {
  [K in keyof TcgCard]?: any;
};

const retry = new RetryWithBackoff();
const batchProcessor = new OptimizedBatchProcessor(db);

// Helper to un-sanitize document IDs for comparison
function unSanitizeDocumentId(code: string): string {
  return code.replace(/;/g, "/");
}

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
    // Removed verbose match logging
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

// Process and store images using TCG card paths
async function processImages(
  tcgCard: TcgCard,
  seCard: SquareEnixCard
): Promise<{ highResUrl: string | null; lowResUrl: string | null }> {
  try {
    if (!tcgCard.groupId) {
      logger.warn("No groupId found for card", { id: tcgCard.id });
      return { highResUrl: null, lowResUrl: null };
    }

    const groupId = tcgCard.groupId;
    // Process full resolution image (maps to highResUrl)
    const fullResResult = groupId && seCard.images?.full?.length > 0
      ? await retry.execute(() =>
          storageService.processAndStoreImage(
            seCard.images.full[0],
            parseInt(tcgCard.id),
            groupId.toString(),
            true // Use maintainTcgcsvStructure flag
          )
        )
      : null;

    // Process thumbnail image (maps to lowResUrl)
    const thumbResult = groupId && seCard.images?.thumbs?.length > 0
      ? await retry.execute(() =>
          storageService.processAndStoreImage(
            seCard.images.thumbs[0],
            parseInt(tcgCard.id),
            groupId.toString(),
            true // Use maintainTcgcsvStructure flag
          )
        )
      : null;

    return {
      highResUrl: fullResResult?.highResUrl || null,
      lowResUrl: thumbResult?.lowResUrl || null,
    };
  } catch (error) {
    logger.error(`Failed to process images for card ${tcgCard.id}`, {
      error: error instanceof Error ? error.message : "Unknown error",
      seCardCode: seCard.code,
    });
    return { highResUrl: null, lowResUrl: null };
  }
}

// Get fields that need to be updated
export async function getFieldsToUpdate(tcgCard: TcgCard, seCard: SquareEnixCard): Promise<Partial<TcgCard>> {
  const updates: Partial<TcgCard> = {};
  const isPromo = isPromoCard(tcgCard);

  const PLACEHOLDER_URL = "https://fftcgcompanion.com/card-images/image-coming-soon.jpeg";

  // Check if any image URLs are missing
  if (tcgCard.highResUrl === null || tcgCard.lowResUrl === null || tcgCard.fullResUrl === null) {
    // For non-card products, use placeholder immediately if any URLs are missing
    if (tcgCard.isNonCard) {
      if (tcgCard.highResUrl === null) updates.highResUrl = PLACEHOLDER_URL;
      if (tcgCard.fullResUrl === null) updates.fullResUrl = PLACEHOLDER_URL;
      if (tcgCard.lowResUrl === null) updates.lowResUrl = PLACEHOLDER_URL;
      logger.info("Using placeholder image URLs for non-card product", {
        id: tcgCard.id,
        name: tcgCard.name,
        isNonCard: tcgCard.isNonCard,
        placeholderUrl: PLACEHOLDER_URL
      });
    } else {
      // For regular cards, try Square Enix images first
      const imageResults = await processImages(tcgCard, seCard);
      if (tcgCard.highResUrl === null && imageResults.highResUrl) {
        updates.highResUrl = imageResults.highResUrl;
        updates.fullResUrl = imageResults.highResUrl;
        logger.info("Adding missing high/full res image URLs from Square Enix", {
          id: tcgCard.id,
          name: tcgCard.name,
          newUrl: imageResults.highResUrl,
          isNonCard: tcgCard.isNonCard
        });
      }
      if (tcgCard.lowResUrl === null && imageResults.lowResUrl) {
        updates.lowResUrl = imageResults.lowResUrl;
        logger.info("Adding missing low res image URL from Square Enix", {
          id: tcgCard.id,
          name: tcgCard.name,
          newUrl: imageResults.lowResUrl,
          isNonCard: tcgCard.isNonCard
        });
      }

      // After trying Square Enix API, if we still have missing URLs, use placeholder
      if (tcgCard.highResUrl === null && !imageResults.highResUrl) updates.highResUrl = PLACEHOLDER_URL;
      if (tcgCard.fullResUrl === null && !imageResults.highResUrl) updates.fullResUrl = PLACEHOLDER_URL;
      if (tcgCard.lowResUrl === null && !imageResults.lowResUrl) updates.lowResUrl = PLACEHOLDER_URL;

      if (updates.highResUrl === PLACEHOLDER_URL || updates.lowResUrl === PLACEHOLDER_URL) {
        logger.info("Using placeholder for missing image URLs after Square Enix attempt", {
          id: tcgCard.id,
          name: tcgCard.name,
          isNonCard: tcgCard.isNonCard,
          placeholderUrl: PLACEHOLDER_URL
        });
      }
    }
  }

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

  // Field mappings based on screenshot alignment
  const fieldMappings: FieldMappings = {
    cardType: seCard.type,
    category: seCard.category_1,
    category_2: seCard.category_2 || undefined, // Use undefined instead of null to match optional field
    cleanName: seCard.name,
    cost: parseNumber(seCard.cost),
    elements: seCard.element,
    job: seCard.type === 'Summon' || tcgCard.cardType === 'Summon' ? null : seCard.job,
    name: seCard.name,
    power: parseNumber(seCard.power),
    rarity: isPromo ? 'Promo' : mapRarity(seCard.rarity)
  };

  // Compare and update fields
  (Object.entries(fieldMappings) as [keyof TcgCard, any][]).forEach(([field, value]) => {
    if (field === 'cost' || field === 'power') {
      if (value !== null && (tcgCard[field] === null || tcgCard[field] === undefined || tcgCard[field] !== value)) {
        updates[field] = value;
        logger.info(`Updating ${field}`, {
          id: tcgCard.id,
          name: tcgCard.name,
          [`old${field.charAt(0).toUpperCase() + field.slice(1)}`]: tcgCard[field],
          [`new${field.charAt(0).toUpperCase() + field.slice(1)}`]: value,
          [`seCard${field.charAt(0).toUpperCase() + field.slice(1)}`]: field === 'cost' ? seCard.cost : seCard.power,
          reason: tcgCard[field] === null || tcgCard[field] === undefined ? "NULL value" : "Value mismatch"
        });
      }
    } else if (Array.isArray(value)) {
      const currentValue = tcgCard[field] || [];
      if (tcgCard[field] === null || tcgCard[field] === undefined || 
          JSON.stringify(currentValue.sort()) !== JSON.stringify(value.sort())) {
        updates[field] = value;
      }
    } else if (tcgCard[field] === null || tcgCard[field] === undefined || tcgCard[field] !== value) {
      updates[field] = value;
    }
  });

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
          rarity: tcgCard.rarity,
          highResUrl: tcgCard.highResUrl,
          lowResUrl: tcgCard.lowResUrl
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

function parseArgs(args: string[]): { forceUpdate?: boolean; groupId?: string } {
  const options: { forceUpdate?: boolean; groupId?: string } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--force") {
      options.forceUpdate = true;
    } else if (arg === "--group") {
      // Look ahead for the group ID, but don't increment i yet
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("--")) {
        options.groupId = nextArg;
        i++; // Skip the group ID in the next iteration
      }
    } else if (!arg.startsWith("--")) {
      // If we find a non-flag argument and the previous arg was --group
      if (i > 0 && args[i - 1] === "--group") {
        options.groupId = arg;
      }
    }
  }

  return options;
}

export async function main() {
  try {
    const args = process.argv.slice(2);
    const options = parseArgs(args);

    logger.info("Starting card update process", { options });

    // Fetch cards based on groupId
    const [tcgCardsSnapshot, seCardsSnapshot] = await Promise.all([
      retry.execute(async () => {
        const cardsRef = db.collection(COLLECTION.CARDS);
        if (options.groupId) {
          return cardsRef.where("groupId", "==", parseInt(options.groupId)).get();
        }
        return cardsRef.get();
      }),
      retry.execute(() => 
        db.collection(COLLECTION.SQUARE_ENIX_CARDS)
          .get()
      )
    ]);

    const tcgCards = tcgCardsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as TcgCard[];

    const seCards = seCardsSnapshot.docs.map(doc => {
      const data = doc.data();
      // Un-sanitize the code for comparison
      return {
        id: doc.id,
        ...data,
        code: unSanitizeDocumentId(data.code)
      };
    }) as SquareEnixCard[];

    logger.info(`Fetched ${tcgCards.length} TCG cards and ${seCards.length} Square Enix cards`);

    let matchCount = 0;
    let updateCount = 0;

    // Process each TCG card
    for (const tcgCard of tcgCards) {
      // Removed verbose card processing log

      const PLACEHOLDER_URL = "https://fftcgcompanion.com/card-images/image-coming-soon.jpeg";

      // Find potential matches based on card numbers
      const matches = seCards.filter(seCard => findCardNumberMatch(tcgCard, seCard));

      if (matches.length === 0) {
        // If no matches found and card has no images, use placeholder (for both regular cards and non-cards)
        if (tcgCard.highResUrl === null &&
            tcgCard.lowResUrl === null &&
            tcgCard.fullResUrl === null) {
          logger.info("No Square Enix match found and no images exist, using placeholder", {
            id: tcgCard.id,
            name: tcgCard.name,
            cardNumbers: tcgCard.cardNumbers,
            number: tcgCard.number,
            primaryCardNumber: tcgCard.primaryCardNumber,
            fullCardNumber: tcgCard.fullCardNumber
          });

          await batchProcessor.addOperation((batch) => {
            const cardRef = db.collection(COLLECTION.CARDS).doc(tcgCard.id);
            batch.update(cardRef, {
              highResUrl: PLACEHOLDER_URL,
              fullResUrl: PLACEHOLDER_URL,
              lowResUrl: PLACEHOLDER_URL,
              lastUpdated: FieldValue.serverTimestamp()
            });
          });
          updateCount++;
        }
        continue;
      }

      matchCount++;

      // Use the first valid match
      const match = matches[0];
      const updates = await getFieldsToUpdate(tcgCard, match);

      // Update if there are fields to update or force flag is set
      if (Object.keys(updates).length > 0 || options.forceUpdate) {
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
              rarity: tcgCard.rarity,
              highResUrl: tcgCard.highResUrl,
              lowResUrl: tcgCard.lowResUrl
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

      // Update Square Enix card with productId and groupId if it exists
      await batchProcessor.addOperation((batch) => {
        // Use sanitized code as document ID
        const sanitizedCode = match.code.replace(/\//g, ";");
        const seCardRef = db.collection(COLLECTION.SQUARE_ENIX_CARDS).doc(sanitizedCode);
        batch.set(seCardRef, {
          id: match.id, // Keep the id field for reference
          productId: parseInt(tcgCard.id),
          groupId: tcgCard.groupId,
          lastUpdated: FieldValue.serverTimestamp()
        }, { merge: true });
      });
    }

    try {
      // Commit any remaining updates
      await batchProcessor.commitAll();

      // Return result without logging (cardSync.ts will handle logging)
      return {
        success: true,
        totalCards: tcgCards.length,
        matchesFound: matchCount,
        cardsUpdated: updateCount
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Failed to commit updates", { error: errorMessage });
      return {
        success: false,
        error: errorMessage
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Update process failed", { error: errorMessage });
    return {
      success: false,
      error: errorMessage
    };
  }
}

// Run the update
main().catch(console.error);
