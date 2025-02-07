import { db, COLLECTION } from "../config/firebase";
import { logger } from "../utils/logger";
import { RetryWithBackoff } from "../utils/retry";
import { OptimizedBatchProcessor } from "../services/batchProcessor";
import { FieldValue } from "firebase-admin/firestore";
import { storageService } from "../services/storageService";
import * as crypto from "crypto";
import { Cache } from "../utils/cache";

export interface TcgCard {
  [key: string]: string | number | boolean | string[] | null | undefined; // Specific types for dynamic access
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

// Define possible field value types
type CardFieldValue = string | number | boolean | string[] | null | undefined;

// Type guard to check if a value is a string array
function isStringArray(value: CardFieldValue): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

type FieldMappings = {
  [K in keyof TcgCard]?: CardFieldValue;
};

const retry = new RetryWithBackoff();
const batchProcessor = new OptimizedBatchProcessor(db);
const cache = new Cache<string>(15);

// Calculate hash for Square Enix card data
function calculateHash(card: SquareEnixCard): string {
  // Only include fields that affect the card's data, not metadata
  const deltaData = {
    type: card.type,
    category_1: card.category_1,
    category_2: card.category_2,
    element: card.element,
    job: card.job,
    power: card.power,
    cost: card.cost,
    rarity: card.rarity,
  };
  return crypto.createHash("md5").update(JSON.stringify(deltaData)).digest("hex");
}

// Get stored hashes for Square Enix cards using their document IDs
async function getStoredHashes(seCards: SquareEnixCard[]): Promise<Map<string, string>> {
  const hashMap = new Map<string, string>();
  const uncachedCards: SquareEnixCard[] = [];

  seCards.forEach((card) => {
    // Use sanitized code for cache key and document ID
    const sanitizedCode = card.code.replace(/\//g, ";");
    const cacheKey = `se_hash_${sanitizedCode}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      hashMap.set(card.code, cached); // Still map to unsanitized code for comparison
    } else {
      uncachedCards.push({
        ...card,
        id: sanitizedCode, // Use sanitized code as ID
      });
    }
  });

  if (uncachedCards.length === 0) {
    return hashMap;
  }

  const chunks = [];
  for (let i = 0; i < uncachedCards.length; i += 10) {
    chunks.push(uncachedCards.slice(i, i + 10));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      const refs = chunk.map((card) => db.collection(COLLECTION.SQUARE_ENIX_HASHES).doc(card.id));

      const snapshots = await retry.execute(() => db.getAll(...refs));

      snapshots.forEach((snap, index) => {
        const card = chunk[index];
        const hash = snap.exists ? snap.data()?.hash : null;
        if (hash) {
          hashMap.set(card.code, hash);
          cache.set(`se_hash_${card.id}`, hash);
        }
      });
    })
  );

  return hashMap;
}

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
  if (
    tcgCard.cardNumbers?.some((num) => {
      if (isPromo) {
        const baseNum = getBaseNumber(num);
        return baseNum === seCard.code;
      }
      return num === seCard.code;
    })
  ) {
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
        baseNumber: baseFullNumber,
      });
      return true;
    }

    if (baseNumber === seCard.code) {
      logger.info("Matched Promo on number base number", {
        tcgCard: tcgCard.id,
        seCard: seCard.id,
        code: seCard.code,
        baseNumber,
      });
      return true;
    }

    if (basePrimaryNumber === seCard.code) {
      logger.info("Matched Promo on primaryCardNumber base number", {
        tcgCard: tcgCard.id,
        seCard: seCard.id,
        code: seCard.code,
        baseNumber: basePrimaryNumber,
      });
      return true;
    }
  } else {
    // Regular non-Promo matching
    if (tcgCard.fullCardNumber === seCard.code) {
      logger.info("Matched on fullCardNumber", {
        tcgCard: tcgCard.id,
        seCard: seCard.id,
        code: seCard.code,
      });
      return true;
    }

    if (tcgCard.number === seCard.code) {
      logger.info("Matched on number", {
        tcgCard: tcgCard.id,
        seCard: seCard.id,
        code: seCard.code,
      });
      return true;
    }

    if (tcgCard.primaryCardNumber === seCard.code) {
      logger.info("Matched on primaryCardNumber", {
        tcgCard: tcgCard.id,
        seCard: seCard.id,
        code: seCard.code,
      });
      return true;
    }
  }

  return false;
}

// Check if a card is a Promo variant
function isPromoCard(card: TcgCard): boolean {
  const allNumbers = [...(card.cardNumbers || []), card.fullCardNumber, card.number, card.primaryCardNumber].filter(
    Boolean
  );

  return allNumbers.some((num) => num?.includes("PR"));
}

// Map Square Enix rarity abbreviation to full word
function mapRarity(abbreviation: string): string {
  const rarityMap: Record<string, string> = {
    C: "Common",
    R: "Rare",
    H: "Hero",
    L: "Legend",
    S: "Starter",
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
    const fullResResult =
      groupId && seCard.images?.full?.length > 0
        ? await retry.execute(() =>
            storageService.processAndStoreImage(seCard.images.full[0], parseInt(tcgCard.id), groupId.toString())
          )
        : null;

    // Process thumbnail image (maps to lowResUrl)
    const thumbResult =
      groupId && seCard.images?.thumbs?.length > 0
        ? await retry.execute(() =>
            storageService.processAndStoreImage(seCard.images.thumbs[0], parseInt(tcgCard.id), groupId.toString())
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
        placeholderUrl: PLACEHOLDER_URL,
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
          isNonCard: tcgCard.isNonCard,
        });
      }
      if (tcgCard.lowResUrl === null && imageResults.lowResUrl) {
        updates.lowResUrl = imageResults.lowResUrl;
        logger.info("Adding missing low res image URL from Square Enix", {
          id: tcgCard.id,
          name: tcgCard.name,
          newUrl: imageResults.lowResUrl,
          isNonCard: tcgCard.isNonCard,
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
          placeholderUrl: PLACEHOLDER_URL,
        });
      }
    }
  }

  // For Promo cards, force rarity to "Promo"
  if (isPromo) {
    if (tcgCard.rarity !== "Promo") {
      updates.rarity = "Promo";
      logger.info("Setting Promo rarity for card", {
        id: tcgCard.id,
        name: tcgCard.name,
        currentRarity: tcgCard.rarity,
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
    job: seCard.type === "Summon" || tcgCard.cardType === "Summon" ? null : seCard.job,
    name: seCard.name,
    power: parseNumber(seCard.power),
    rarity: isPromo ? "Promo" : mapRarity(seCard.rarity),
  };

  // Compare and update fields
  (Object.entries(fieldMappings) as Array<[keyof TcgCard, CardFieldValue]>).forEach(([field, value]) => {
    if (field === "cost" || field === "power") {
      const numericValue = typeof value === "number" ? value : undefined;
      if (
        numericValue !== undefined &&
        (tcgCard[field] === null || tcgCard[field] === undefined || tcgCard[field] !== numericValue)
      ) {
        updates[field] = numericValue;
        logger.info(`Updating ${field}`, {
          id: tcgCard.id,
          name: tcgCard.name,
          [`old${field.charAt(0).toUpperCase() + field.slice(1)}`]: tcgCard[field],
          [`new${field.charAt(0).toUpperCase() + field.slice(1)}`]: value,
          [`seCard${field.charAt(0).toUpperCase() + field.slice(1)}`]: field === "cost" ? seCard.cost : seCard.power,
          reason: tcgCard[field] === null || tcgCard[field] === undefined ? "NULL value" : "Value mismatch",
        });
      }
    } else if (isStringArray(value)) {
      const currentValue = tcgCard[field];
      if (currentValue === null || currentValue === undefined) {
        updates[field] = value;
      } else if (isStringArray(currentValue)) {
        // Only compare if both are string arrays
        if (JSON.stringify([...currentValue].sort()) !== JSON.stringify([...value].sort())) {
          updates[field] = value;
        }
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
          lowResUrl: tcgCard.lowResUrl,
        },
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
          rarity: seCard.rarity,
        },
      },
      updates,
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
      retry.execute(() => db.collection(COLLECTION.SQUARE_ENIX_CARDS).get()),
    ]);

    const tcgCards = tcgCardsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as TcgCard[];

    const seCards = seCardsSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id, // Use document ID directly
        ...data,
        code: unSanitizeDocumentId(doc.id), // Un-sanitize document ID for comparison
      };
    }) as SquareEnixCard[];

    logger.info("Loaded Square Enix cards", {
      total: seCards.length,
      sample: seCards.slice(0, 2).map((card) => ({
        id: card.id,
        code: card.code,
      })),
    });

    logger.info(`Fetched ${tcgCards.length} TCG cards and ${seCards.length} Square Enix cards`);

    let matchCount = 0;
    let updateCount = 0;

    // Get stored hashes for all Square Enix cards
    const hashMap = await getStoredHashes(seCards);

    // Process each TCG card
    for (const tcgCard of tcgCards) {
      const PLACEHOLDER_URL = "https://fftcgcompanion.com/card-images/image-coming-soon.jpeg";

      // Find potential matches based on card numbers
      const matches = seCards.filter((seCard) => findCardNumberMatch(tcgCard, seCard));

      if (matches.length === 0) {
        // If no matches found and card has no images, use placeholder (for both regular cards and non-cards)
        if (tcgCard.highResUrl === null && tcgCard.lowResUrl === null && tcgCard.fullResUrl === null) {
          logger.info("No Square Enix match found and no images exist, using placeholder", {
            id: tcgCard.id,
            name: tcgCard.name,
            cardNumbers: tcgCard.cardNumbers,
            number: tcgCard.number,
            primaryCardNumber: tcgCard.primaryCardNumber,
            fullCardNumber: tcgCard.fullCardNumber,
          });

          await batchProcessor.addOperation((batch) => {
            const cardRef = db.collection(COLLECTION.CARDS).doc(tcgCard.id);
            batch.update(cardRef, {
              highResUrl: PLACEHOLDER_URL,
              fullResUrl: PLACEHOLDER_URL,
              lowResUrl: PLACEHOLDER_URL,
              lastUpdated: FieldValue.serverTimestamp(),
            });
          });
          updateCount++;
        }
        continue;
      }

      matchCount++;

      // Use the first valid match
      const match = matches[0];
      const sanitizedCode = match.code.replace(/\//g, ";");

      // Calculate current hash and compare with stored hash
      const currentHash = calculateHash(match);
      const storedHash = hashMap.get(match.code);
      const updates = await getFieldsToUpdate(tcgCard, match);

      // Skip if hash matches and not forcing update
      if (currentHash === storedHash && !options.forceUpdate) {
        logger.info(`Skipping card ${tcgCard.id} - no changes detected`);
        continue;
      }

      const hasFieldUpdates = Object.keys(updates).length > 0;
      const hasHashChange = currentHash !== storedHash;

      // Log what's being updated and why
      logger.info(`Processing card ${tcgCard.id}`, {
        seCardCode: match.code,
        updates: {
          fields: hasFieldUpdates
            ? {
                updating: true,
                changes: updates,
              }
            : {
                updating: false,
              },
          hash: hasHashChange
            ? {
                updating: true,
                old: storedHash,
                new: currentHash,
              }
            : {
                updating: false,
              },
        },
      });

      // Update TCG card if there are field updates
      if (Object.keys(updates).length > 0) {
        batchProcessor.addOperation((batch) => {
          const cardRef = db.collection(COLLECTION.CARDS).doc(tcgCard.id);
          batch.update(cardRef, {
            ...updates,
            lastUpdated: FieldValue.serverTimestamp(),
          });
        });
      }

      // Only update Square Enix card and hash if the hash has changed
      if (currentHash !== storedHash) {
        // Update Square Enix card reference
        batchProcessor.addOperation((batch) => {
          const seCardRef = db.collection(COLLECTION.SQUARE_ENIX_CARDS).doc(sanitizedCode);
          batch.set(
            seCardRef,
            {
              id: sanitizedCode,
              productId: parseInt(tcgCard.id),
              groupId: tcgCard.groupId,
              lastUpdated: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        });

        // Update hash
        await batchProcessor.addOperation((batch) => {
          const hashRef = db.collection(COLLECTION.SQUARE_ENIX_HASHES).doc(sanitizedCode);
          batch.set(
            hashRef,
            {
              hash: currentHash,
              lastUpdated: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        });

        // Update cache
        cache.set(`se_hash_${sanitizedCode}`, currentHash);
      }

      // Increment update count if we made any changes
      if (Object.keys(updates).length > 0 || currentHash !== storedHash) {
        updateCount++;
      }
    }

    try {
      // Commit any remaining updates
      await batchProcessor.commitAll();

      // Return result without logging (cardSync.ts will handle logging)
      return {
        success: true,
        totalCards: tcgCards.length,
        matchesFound: matchCount,
        cardsUpdated: updateCount,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Failed to commit updates", { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Update process failed", { error: errorMessage });
    return {
      success: false,
      error: errorMessage,
    };
  }
}

// Run the update
main().catch(console.error);
