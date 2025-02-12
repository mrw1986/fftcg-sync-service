import { db, COLLECTION } from "../config/firebase";
import { SyncOptions } from "../types";
import { logger } from "../utils/logger";
import { RetryWithBackoff } from "../utils/retry";
import { OptimizedBatchProcessor } from "../services/batchProcessor";
import { FieldValue } from "firebase-admin/firestore";
import * as crypto from "crypto";
import { storageService } from "../services/storageService";
export interface TcgCard {
  [key: string]: string | number | boolean | string[] | null | undefined;
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
  name: string; // Changed from name_en to match Firestore
  type_en: string;
  job_en: string;
  text_en: string;
  element: string[];
  rarity: string;
  cost: string;
  power: string;
  category_1: string;
  category_2?: string;
  multicard: string;
  ex_burst: string;
  set: string[];
  images: {
    thumbs: string[];
    full: string[];
  };
}

const retry = new RetryWithBackoff();
const batchProcessor = new OptimizedBatchProcessor(db);
const PLACEHOLDER_URL = "https://fftcgcompanion.com/card-images/image-coming-soon.jpeg";

const elementMap: Record<string, string> = {
  火: "Fire",
  氷: "Ice",
  風: "Wind",
  土: "Earth",
  雷: "Lightning",
  水: "Water",
  光: "Light",
  闇: "Dark",
};

function calculateHash(card: SquareEnixCard): string {
  logger.info("Raw card data:", {
    code: card.code,
    multicard: card.multicard,
    ex_burst: card.ex_burst,
  });

  const deltaData = {
    code: card.code || "",
    cleanName: card.name || "",
    type: card.type_en || "",
    job: card.type_en === "Summon" ? "" : card.job_en || "",
    text: card.text_en || "",
    element:
      card.type_en === "Crystal" || card.code.startsWith("C-")
        ? ["Crystal"]
        : (card.element || []).map((e: string) => elementMap[e] || e),
    rarity: card.rarity || "",
    cost: card.cost || "",
    power: card.power || "",
    category_1: card.category_1 || "",
    category_2: card.category_2 || null,
    multicard: card.multicard === "1",
    ex_burst: card.ex_burst === "1",
    set: card.set || [],
    cardNumbers: card.code.includes("/") ? card.code.split("/") : [card.code], // Include card numbers in hash
  };
  const jsonData = JSON.stringify(deltaData);
  logger.info("Update Cards hash data:", {
    code: deltaData.code,
    data: jsonData,
    hash: crypto.createHash("md5").update(jsonData).digest("hex"),
  });
  return crypto.createHash("md5").update(jsonData).digest("hex");
}

function getAllCardNumbers(card: TcgCard): string[] {
  const numbers: string[] = [];

  if (card.cardNumbers) {
    numbers.push(...card.cardNumbers);
  }
  if (card.fullCardNumber) {
    numbers.push(card.fullCardNumber);
  }
  if (card.number) {
    numbers.push(card.number);
  }
  if (card.primaryCardNumber) {
    numbers.push(card.primaryCardNumber);
  }

  return numbers;
}

function isPromoCard(card: TcgCard): boolean {
  return getAllCardNumbers(card).some((num) => num.includes("PR"));
}

function findCardNumberMatch(tcgCard: TcgCard, seCard: SquareEnixCard): boolean {
  // Normalize all numbers for comparison
  function normalizeForComparison(number: string): string {
    // Remove all separators and whitespace
    return number.replace(/[-\s.,;/]/g, "").toUpperCase();
  }

  const seCode = seCard.code;
  const isPromo = isPromoCard(tcgCard);
  const cardNumbers = getAllCardNumbers(tcgCard);

  // For promo cards, we need to match the base number after PR-###
  if (isPromo) {
    const getBaseNumber = (num: string): string | null => {
      const match = num.match(/PR-\d+\/(.+)/);
      return match ? normalizeForComparison(match[1]) : null;
    };

    const normalizedSeCode = normalizeForComparison(seCode);
    return cardNumbers.some((num) => {
      const baseNum = getBaseNumber(num);
      return baseNum === normalizedSeCode;
    });
  }

  // For non-promo cards, normalize both sides for comparison
  const normalizedSeCode = normalizeForComparison(seCode);
  return cardNumbers.some((num) => normalizeForComparison(num) === normalizedSeCode);
}

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

function getFieldsToUpdate(tcgCard: TcgCard, seCard: SquareEnixCard): Partial<TcgCard> {
  const updates: Partial<TcgCard> = {};
  const isPromo = isPromoCard(tcgCard);

  const elements =
    seCard.type_en === "Crystal" || seCard.code.startsWith("C-")
      ? ["Crystal"]
      : seCard.element.map((e: string) => elementMap[e] || e);

  const rarityMap = {
    C: "Common",
    R: "Rare",
    H: "Hero",
    L: "Legend",
    S: "Starter",
  } as const;

  // Normalize card numbers like cardSync.ts does
  function normalizeCardNumber(number: string): string {
    // Remove all separators and whitespace
    const clean = number.replace(/[-\s.,;]/g, "").toUpperCase();

    // Any number starting with P (but not PR) is invalid
    if (clean.startsWith("P") && !clean.startsWith("PR")) {
      logger.warn(`Invalid card number format (starts with P): ${number}`);
      return "N/A";
    }

    // Handle PR prefix case (PR-###)
    if (clean.startsWith("PR")) {
      const match = clean.match(/^PR0*(\d{1,3})/);
      if (!match) {
        logger.warn(`Invalid PR card number format: ${number}`);
        return "N/A";
      }
      const paddedNum = match[1].padStart(3, "0");
      return `PR-${paddedNum}`;
    }

    // Handle A-### format
    if (clean.startsWith("A")) {
      const match = clean.match(/^A0*(\d{1,3})/);
      if (match) {
        const paddedNum = match[1].padStart(3, "0");
        return `A-${paddedNum}`;
      }
    }

    // Handle B-### format (Bonus cards)
    if (clean.startsWith("B")) {
      const match = clean.match(/^B0*(\d{1,3})/);
      if (match) {
        const paddedNum = match[1].padStart(3, "0");
        return `B-${paddedNum}`;
      }
    }

    // Handle C-### format (Crystal cards)
    if (clean.startsWith("C")) {
      const match = clean.match(/^C0*(\d{1,3})/);
      if (match) {
        const paddedNum = match[1].padStart(3, "0");
        return `C-${paddedNum}`;
      }
    }

    // Handle numeric prefix cases (#-###X or ##-###X)
    const match = clean.match(/^(\d{1,2})(\d{3})([A-Z])$/);
    if (match) {
      const [, prefix, nums, letter] = match;
      const prefixNum = parseInt(prefix);
      if (prefixNum < 1 || prefixNum > 99) {
        logger.warn(`Invalid card number prefix: ${number}`);
        return "N/A";
      }
      return `${prefix}-${nums}${letter}`;
    }

    logger.warn(`Unable to normalize card number: ${number}`);
    return "N/A";
  }

  // Get and normalize TCG card numbers - preserve all numbers
  const tcgNumbers = getAllCardNumbers(tcgCard)
    .map((num) => normalizeCardNumber(num)) // Normalize each number
    .filter((num) => num !== "N/A"); // Remove invalid numbers

  // Get and normalize Square Enix numbers - split on forward slash
  const seCode = seCard.code;
  const seNumbers = seCode.includes("/")
    ? seCode
        .split("/")
        .map((num) => normalizeCardNumber(num.trim()))
        .filter((num) => num !== "N/A")
    : [normalizeCardNumber(seCode)].filter((num) => num !== "N/A");

  // Log all numbers for debugging
  logger.info("Card number details:", {
    cardId: tcgCard.id,
    seCode,
    seNumbers,
    tcgCardNumbers: tcgCard.cardNumbers,
    tcgFullCardNumber: tcgCard.fullCardNumber,
    tcgNumber: tcgCard.number,
    tcgPrimaryCardNumber: tcgCard.primaryCardNumber,
    normalizedTcgNumbers: tcgNumbers,
  });

  logger.info("Raw card numbers:", {
    cardId: tcgCard.id,
    rawTcgNumbers: getAllCardNumbers(tcgCard),
    normalizedTcgNumbers: tcgNumbers,
    rawSeCode: seCard.code,
    normalizedSeNumbers: seNumbers,
  });

  logger.info("Processing card numbers:", {
    cardId: tcgCard.id,
    tcgNumbers,
    seNumbers,
    seOriginalCode: seCard.code,
    currentCardNumbers: tcgCard.cardNumbers,
    fullCardNumber: tcgCard.fullCardNumber,
    number: tcgCard.number,
    primaryCardNumber: tcgCard.primaryCardNumber,
  });

  const fields = {
    cardType: seCard.type_en,
    category: seCard.category_1,
    category_2: seCard.category_2 || undefined,
    cleanName: seCard.name,
    cost: seCard.cost ? parseInt(seCard.cost.trim()) || null : null,
    elements,
    job: seCard.type_en === "Summon" ? "" : seCard.job_en,
    power: seCard.power ? parseInt(seCard.power.trim()) || null : null,
    rarity: isPromo ? "Promo" : rarityMap[seCard.rarity as keyof typeof rarityMap] || seCard.rarity,
    set: seCard.set || [],
    cardNumbers: [...tcgNumbers, ...seNumbers]
      .map((num) => num.replace(/\//g, ";")) // Replace any remaining slashes with semicolons
      .filter((num) => num !== "N/A") // Remove any invalid numbers
      .filter((num, index, self) => self.indexOf(num) === index), // Remove duplicates while preserving order
    isNonCard: false,
  };

  logger.info("Final card numbers:", {
    cardId: tcgCard.id,
    finalNumbers: fields.cardNumbers,
  });

  // Always update cleanName and cardNumbers
  updates.cleanName = fields.cleanName;
  updates.cardNumbers = fields.cardNumbers;

  // Update other fields only if they've changed
  for (const [field, value] of Object.entries(fields)) {
    if (field === "cleanName" || field === "cardNumbers") continue; // Skip since we're always updating these
    const currentValue = tcgCard[field];
    if (currentValue === null || currentValue === undefined || JSON.stringify(currentValue) !== JSON.stringify(value)) {
      updates[field] = value;
    }
  }

  logger.info("Update decision:", {
    cardId: tcgCard.id,
    currentCardNumbers: tcgCard.cardNumbers,
    newCardNumbers: fields.cardNumbers,
    willUpdate: true,
    cardNumbersChanged: JSON.stringify(tcgCard.cardNumbers) !== JSON.stringify(fields.cardNumbers),
  });

  return updates;
}

export async function main(options: SyncOptions = {}) {
  const startTime = Date.now();
  try {
    logger.info("Starting card update process");

    // Load Square Enix cards from Firestore
    logger.info("Loading Square Enix cards from Firestore");
    const seCardsSnapshot = await db.collection(COLLECTION.SQUARE_ENIX_CARDS).get();
    const freshSeCards = seCardsSnapshot.docs.map((doc) => {
      const data = doc.data();
      // Convert boolean fields back to strings to match API format
      return {
        ...data,
        code: doc.id.replace(/;/g, "/"),
        multicard: data.multicard ? "1" : "0",
        ex_burst: data.ex_burst ? "1" : "0",
      };
    });
    logger.info(`Loaded ${freshSeCards.length} cards from Square Enix collection`);

    // Load TCG cards
    const query = db.collection(COLLECTION.CARDS);
    const limitedQuery = options.limit ? query.limit(options.limit) : query;
    if (options.limit) {
      logger.info(`Limiting update to first ${options.limit} cards`);
    }
    const tcgCardsSnapshot = await retry.execute(() => limitedQuery.get());

    // Create lookup maps
    const tcgCards = new Map(tcgCardsSnapshot.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() } as TcgCard]));
    const seCards = new Map(
      freshSeCards.map((card) => [card.code, { ...card, id: card.code.replace(/\//g, ";") } as SquareEnixCard])
    );

    logger.info(`Loaded ${tcgCards.size} TCG cards and ${seCards.size} Square Enix cards`);

    let matchCount = 0;
    let updateCount = 0;
    const updates = new Map();

    // Get all hashes in one batch at the start
    const hashRefs = Array.from(seCards.values()).map((card) =>
      db.collection(COLLECTION.SQUARE_ENIX_HASHES).doc(card.code.replace(/\//g, ";"))
    );
    const hashDocs = await retry.execute(() => db.getAll(...hashRefs));
    const hashMap = new Map(hashDocs.map((doc) => [doc.id, doc.exists ? doc.data()?.hash : null]));

    logger.info("Loaded hashes", {
      totalHashes: hashMap.size,
      sampleHashes: Array.from(hashMap.entries()).slice(0, 5),
    });

    // Process all cards
    for (const [id, tcgCard] of tcgCards) {
      const card = tcgCard as TcgCard;
      // Initialize updates and tracking variables
      let fieldUpdates: Partial<TcgCard> = {};
      let currentHash: string | null = null;
      let storedHash: string | null = null;
      let sanitizedCode: string | null = null;

      // Find Square Enix match if exists
      const match = Array.from(seCards.values()).find((seCard) => findCardNumberMatch(card, seCard as SquareEnixCard));

      if (match) {
        matchCount++;
        sanitizedCode = match.code.replace(/\//g, ";");
        currentHash = calculateHash(match as SquareEnixCard);
        storedHash = hashMap.get(sanitizedCode);

        // Get field updates if hash changed or force update
        if (currentHash !== storedHash || options.forceUpdate) {
          fieldUpdates = getFieldsToUpdate(card, match as SquareEnixCard);
        }
      }

      // Handle image URLs for all cards
      const hasNullUrls = card.highResUrl === null || card.lowResUrl === null || card.fullResUrl === null;

      if (hasNullUrls) {
        // Try Square Enix images first if we have a match
        let imageResults = null;
        const hasSquareEnixImages =
          match && !card.isNonCard && match.images?.full?.length > 0 && match.images?.thumbs?.length > 0;

        if (hasSquareEnixImages) {
          imageResults = await processImages(card, match);
        }

        const hasValidImages = imageResults && imageResults.highResUrl && imageResults.lowResUrl;

        // If we have valid Square Enix images, use those
        if (hasValidImages && imageResults) {
          fieldUpdates.highResUrl = imageResults.highResUrl;
          fieldUpdates.lowResUrl = imageResults.lowResUrl;
        }

        // If any URLs are still null after trying Square Enix images, use placeholder
        if (card.highResUrl === null) fieldUpdates.highResUrl = PLACEHOLDER_URL;
        if (card.lowResUrl === null) fieldUpdates.lowResUrl = PLACEHOLDER_URL;
        if (card.fullResUrl === null) fieldUpdates.fullResUrl = PLACEHOLDER_URL;

        logger.info("Image URL updates:", {
          cardId: card.id,
          hasSquareEnixImages,
          hasValidImages,
          currentUrls: {
            high: card.highResUrl,
            low: card.lowResUrl,
            full: card.fullResUrl,
          },
          updates: {
            high: fieldUpdates.highResUrl,
            low: fieldUpdates.lowResUrl,
            full: fieldUpdates.fullResUrl,
          },
        });
      }

      if (Object.keys(fieldUpdates).length > 0) {
        updates.set(id, { match, updates: fieldUpdates, hash: currentHash });
        updateCount++;
        logger.info(`Updating card ${card.id}`, {
          reason: hasNullUrls ? "null URLs" : "hash mismatch",
          currentHash,
          storedHash: storedHash || "none",
          sanitizedCode,
        });
      }
    }

    // Batch process all updates
    if (updates.size > 0) {
      for (const [id, { match, updates: fieldUpdates, hash }] of updates) {
        // Always update the card document if we have field updates
        if (Object.keys(fieldUpdates).length > 0) {
          batchProcessor.addOperation((batch) => {
            batch.update(db.collection(COLLECTION.CARDS).doc(id), {
              ...fieldUpdates,
              lastUpdated: FieldValue.serverTimestamp(),
            });
          });
        }

        // Only update hash if we have a Square Enix match
        if (match && hash) {
          const sanitizedCode = match.code.replace(/\//g, ";");
          batchProcessor.addOperation((batch) => {
            batch.set(
              db.collection(COLLECTION.SQUARE_ENIX_HASHES).doc(sanitizedCode),
              {
                hash,
                lastUpdated: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          });
        }
      }

      await batchProcessor.commitAll();
    }

    const duration = (Date.now() - startTime) / 1000;
    logger.info("Sync completed", {
      totalCards: tcgCards.size,
      matchesFound: matchCount,
      cardsUpdated: updateCount,
      durationSeconds: duration.toFixed(2),
    });

    return {
      success: true,
      totalCards: tcgCards.size,
      matchesFound: matchCount,
      cardsUpdated: updateCount,
      durationSeconds: duration,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Update process failed", { error: errorMessage });
    return {
      success: false,
      error: errorMessage,
    };
  } finally {
    // Only exit if running directly
    if (require.main === module) {
      process.exit(0);
    }
  }
}

// Only run if called directly
if (require.main === module) {
  main().catch((error) => {
    logger.error("Fatal error", { error });
    process.exit(1);
  });
}
