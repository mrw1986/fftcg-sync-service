// src/scripts/updateCardsWithSquareEnixData.ts
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
  categories?: string[];
  cleanName?: string;
  elements?: string[];
  set?: string[];
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
  type_en: string;
  job_en: string;
  text_en: string;
  element: string[];
  rarity: string;
  cost: string;
  power: string;
  category_1: string;
  category_2?: string;
  multicard: boolean;
  ex_burst: boolean;
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

// Special keywords that indicate we should keep the current name
const specialKeywords = ["Full Art", ".*Promo.*", "Road.*", "Champion.*", ".*Anniversary.*"];

function isValidCardNumber(number: string): boolean {
  return /^(?:PR-\d{3}|[1-9]\d?-\d{3}[A-Z]|[A-C]-\d{3})$/.test(number);
}

function isPromoCard(cardNumbers: string[]): boolean {
  return cardNumbers.some((num) => /^(?:PR?|A)-\d{3}/.test(num));
}

function hasSpecialTerms(name: string): boolean {
  return /\((.*?)\)/g.test(name) && specialKeywords.some((term) => new RegExp(term, "i").test(name));
}

function calculateHash(card: SquareEnixCard): string {
  // Normalize element array
  const normalizedElement =
    card.type_en === "Crystal" || card.code.startsWith("C-")
      ? ["Crystal"]
      : (card.element || [])
          .map((e: string) => elementMap[e] || e)
          .filter((e: string) => e)
          .sort();

  // Normalize set array
  const normalizedSet = (card.set || []).filter((s: string) => s).sort();

  // Normalize card numbers
  const normalizedCardNumbers = (card.code.includes("/") ? card.code.split("/") : [card.code])
    .map((num) => num.trim())
    .filter((num) => num)
    .sort();

  // Build categories array for hash calculation
  const categories = [
    ...processCategory(card.category_1),
    ...(card.category_2 ? processCategory(card.category_2) : []),
  ];

  // Only include fields that affect the card's properties
  const deltaData = {
    code: card.code || "",
    element: normalizedElement,
    rarity: card.rarity || "",
    cost: card.cost || "",
    power: card.power || "",
    category_1: card.category_1 || "",
    category_2: card.category_2 || null,
    categories, // Include processed categories in hash calculation
    multicard: card.multicard,
    ex_burst: card.ex_burst,
    set: normalizedSet,
    cardNumbers: normalizedCardNumbers,
  };

  const jsonData = JSON.stringify(deltaData);
  logger.info("Card hash data:", {
    code: deltaData.code,
    data: jsonData,
    hash: crypto.createHash("md5").update(jsonData).digest("hex"),
  });
  return crypto.createHash("md5").update(jsonData).digest("hex");
}

function getAllCardNumbers(card: TcgCard): string[] {
  const numbers = new Set<string>();

  if (card.cardNumbers) card.cardNumbers.forEach((num) => numbers.add(num));
  if (card.fullCardNumber) numbers.add(card.fullCardNumber);
  if (card.number) numbers.add(card.number);
  if (card.primaryCardNumber) numbers.add(card.primaryCardNumber);

  return Array.from(numbers);
}

function findCardNumberMatch(tcgCard: TcgCard, seCard: SquareEnixCard): boolean {
  function normalizeForComparison(number: string): string {
    return number.replace(/[-\s.,;/]/g, "").toUpperCase();
  }

  const seCode = seCard.code;
  const isPromo = isPromoCard(getAllCardNumbers(tcgCard));
  const cardNumbers = getAllCardNumbers(tcgCard);

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

    const fullResResult =
      groupId && seCard.images?.full?.length > 0
        ? await retry.execute(() =>
            storageService.processAndStoreImage(seCard.images.full[0], parseInt(tcgCard.id), groupId.toString())
          )
        : null;

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

function processCategory(category: string): string[] {
  if (!category) return [];
  // Split on the HTML entity for middot
  const parts = category.split(/\s*&middot;\s*/);
  // Return first part and any additional parts that aren't just a number (like "VII")
  return [parts[0]].concat(parts.slice(1).filter((part) => !/^\s*[IVX]+\s*$/.test(part)));
}

function arraysEqual(a: any[], b: any[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return JSON.stringify(sortedA) === JSON.stringify(sortedB);
}

function getFieldsToUpdate(tcgCard: TcgCard, seCard: SquareEnixCard): Partial<TcgCard> {
  const updates: Partial<TcgCard> = {};

  // Skip updates for non-card products
  if (tcgCard.isNonCard) {
    logger.info(`Skipping updates for non-card product ${tcgCard.id}`);
    return updates;
  }

  // Process name
  const isPromo = isPromoCard(tcgCard.cardNumbers || []);
  const hasSpecialName = hasSpecialTerms(tcgCard.name);

  // Only update name if:
  // 1. Not a promo card
  // 2. Current name doesn't have special terms
  if (!isPromo && !hasSpecialName) {
    updates.name = seCard.name;
  }

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

  // Build categories array by merging existing categories with Square Enix categories
  const seCategories = [
    ...processCategory(seCard.category_1),
    ...(seCard.category_2 ? processCategory(seCard.category_2) : []),
  ];
  const existingCategories = tcgCard.categories || [];
  const categories = [...new Set([...existingCategories, ...seCategories])];

  // Only update card numbers if they're invalid
  const hasValidNumbers = (tcgCard.cardNumbers || []).every(isValidCardNumber);
  const usesForwardSlash = tcgCard.fullCardNumber?.includes("/");

  if (!hasValidNumbers || !usesForwardSlash) {
    updates.cardNumbers = seCard.code.includes("/")
      ? seCard.code
          .split("/")
          .map((num) => num.trim())
          .filter((num) => isValidCardNumber(num))
      : [seCard.code].filter((num) => isValidCardNumber(num));

    updates.fullCardNumber = seCard.code;
  }

  const fields = {
    cardType: seCard.type_en,
    category: seCard.category_1,
    category_2: seCard.category_2 || undefined,
    categories,
    cost: seCard.cost ? parseInt(seCard.cost.trim()) || null : null,
    elements,
    job: seCard.type_en === "Summon" ? "" : seCard.job_en,
    power: seCard.power ? parseInt(seCard.power.trim()) || null : null,
    rarity: isPromo ? "Promo" : rarityMap[seCard.rarity as keyof typeof rarityMap] || seCard.rarity,
    set: seCard.set || [], // Always update set from Square Enix data
  };

  // Update fields that have changed
  for (const [field, value] of Object.entries(fields)) {
    const currentValue = tcgCard[field];
    if (currentValue === null || currentValue === undefined) {
      updates[field] = value;
    } else if (Array.isArray(currentValue) && Array.isArray(value)) {
      if (!arraysEqual(currentValue, value)) {
        updates[field] = value;
      }
    } else if (JSON.stringify(currentValue) !== JSON.stringify(value)) {
      updates[field] = value;
    }
  }

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
      return {
        ...data,
        code: doc.id.split("_")[0].replace(/;/g, "/"), // Extract card number from document ID
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

    // Create TCG cards map and Square Enix cards array
    const tcgCards = new Map(tcgCardsSnapshot.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() } as TcgCard]));
    const seCards = freshSeCards.map((card) => ({ ...card } as SquareEnixCard));

    logger.info(`Loaded ${tcgCards.size} TCG cards and ${seCards.length} Square Enix cards`);

    let matchCount = 0;
    let updateCount = 0;
    const updates = new Map();

    // Get all hashes in one batch at the start
    const hashRefs = Array.from(seCards.values()).map((card) =>
      db.collection(COLLECTION.SQUARE_ENIX_HASHES).doc(card.code.replace(/\//g, ";"))
    );
    const hashDocs = await retry.execute(() => db.getAll(...hashRefs));
    const hashMap = new Map(hashDocs.map((doc) => [doc.id, doc.exists ? doc.data()?.hash : null]));

    // Process all cards
    for (const [id, tcgCard] of tcgCards) {
      const card = tcgCard as TcgCard;
      let fieldUpdates: Partial<TcgCard> = {};
      let currentHash: string | null = null;
      let storedHash: string | null = null;
      let sanitizedCode: string | null = null;

      // Log TCG card info once
      logger.info("Processing TCG card:", {
        cardId: card.id,
        cardNumbers: getAllCardNumbers(card),
        cardSet: card.set,
      });

      // Find matching Square Enix card by number and set
      const match = seCards.find((seCard) => {
        const numberMatches = findCardNumberMatch(card, seCard);
        if (!numberMatches) return false;

        // If TCG card has no set, accept any Square Enix card and update set later
        const setMatches = !card.set ? true : arraysEqual(card.set, seCard.set || []);
        if (numberMatches) {
          logger.info("Found number match:", {
            cardId: card.id,
            seCardCode: seCard.code,
            seCardSet: seCard.set,
            tcgCardSet: card.set,
            setMatches,
          });
        }
        return numberMatches && setMatches;
      });

      if (!match) {
        logger.info("No match found for card:", { cardId: card.id });
      }

      if (match) {
        matchCount++;
        sanitizedCode = match.code.replace(/\//g, ";");
        currentHash = calculateHash(match as SquareEnixCard);
        storedHash = hashMap.get(sanitizedCode);

        logger.info(`Processing card ${card.id}:`, {
          hashExists: !!storedHash,
          hashMatch: currentHash === storedHash,
          currentHash,
          storedHash: storedHash || "none",
          forceUpdate: options.forceUpdate || false,
        });

        // Only update if hash doesn't match or force update
        if (!storedHash || currentHash !== storedHash || options.forceUpdate) {
          fieldUpdates = getFieldsToUpdate(card, match as SquareEnixCard);
        }
      }

      // Handle image URLs
      const hasNullUrls = card.highResUrl === null || card.lowResUrl === null || card.fullResUrl === null;
      if (hasNullUrls) {
        let imageResults = null;
        const hasSquareEnixImages =
          match && !card.isNonCard && match.images?.full?.length > 0 && match.images?.thumbs?.length > 0;

        if (hasSquareEnixImages) {
          imageResults = await processImages(card, match);
        }

        if (imageResults?.highResUrl && imageResults?.lowResUrl) {
          fieldUpdates.highResUrl = imageResults.highResUrl;
          fieldUpdates.lowResUrl = imageResults.lowResUrl;
        }

        if (card.highResUrl === null) fieldUpdates.highResUrl = PLACEHOLDER_URL;
        if (card.lowResUrl === null) fieldUpdates.lowResUrl = PLACEHOLDER_URL;
        if (card.fullResUrl === null) fieldUpdates.fullResUrl = PLACEHOLDER_URL;
      }

      if (Object.keys(fieldUpdates).length > 0) {
        updates.set(id, { match, updates: fieldUpdates, hash: currentHash });
        updateCount++;
      }
    }

    // Batch process all updates
    if (updates.size > 0) {
      for (const [id, { match, updates: fieldUpdates, hash }] of updates) {
        if (Object.keys(fieldUpdates).length > 0) {
          batchProcessor.addOperation((batch) => {
            batch.update(db.collection(COLLECTION.CARDS).doc(id), {
              ...fieldUpdates,
              lastUpdated: FieldValue.serverTimestamp(),
            });
          });
        }

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
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error("Fatal error", { error });
    process.exit(1);
  });
}
