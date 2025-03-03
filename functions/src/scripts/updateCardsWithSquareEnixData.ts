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
  id: string;
  name: string;
  cardNumbers?: string[] | null;
  fullCardNumber?: string | null;
  number?: string | null;
  primaryCardNumber?: string | null;
  power: number | null;
  cost: number | null;
  job?: string;
  rarity?: string;
  cardType?: string;
  category?: string;
  categories?: string[];
  cleanName?: string;
  elements?: string[];
  set?: string[];
  fullResUrl?: string | null;
  highResUrl?: string | null;
  lowResUrl?: string | null;
  groupId?: number;
  isNonCard: boolean;
  lastUpdated?: FirebaseFirestore.FieldValue;
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
  cost: number | null;
  power: number | null;
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

interface UpdateResult {
  success: boolean;
  totalCards?: number;
  matchesFound?: number;
  cardsUpdated?: number;
  durationSeconds?: number;
  error?: string;
}

interface HashData {
  code: string;
  element: string[];
  rarity: string;
  cost: number | null;
  power: number | null;
  category_1: string;
  category_2: string | null;
  categories: string[];
  multicard: boolean;
  ex_burst: boolean;
  set: string[];
  cardNumbers: string[];
}

interface ImageProcessResult {
  highResUrl: string | null;
  lowResUrl: string | null;
}

type FieldUpdates = Partial<TcgCard>;

interface UpdateInfo {
  match: SquareEnixCard;
  updates: FieldUpdates;
  hash: string;
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
  return /^(?:PR-\d{3}|[1-9]\d?-\d{3}[A-Z]|[A-C]-\d{3}|Re-\d{3}[A-Z])$/.test(number);
}

function isPromoCard(cardNumbers: string[] | null): boolean {
  if (!cardNumbers) {
    return false;
  }
  return cardNumbers.some((num) => /^(?:PR?|A)-\d{3}/.test(num));
}

function hasSpecialTerms(name: string): boolean {
  return /\((.*?)\)/g.test(name) && specialKeywords.some((term) => new RegExp(term, "i").test(name));
}

function calculateHash(card: SquareEnixCard, tcgCard?: TcgCard): string {
  // Normalize element array
  const normalizedElement =
    card.type_en === "Crystal" || card.code.startsWith("C-")
      ? ["Crystal"]
      : (card.element || [])
          .map((e: string) => elementMap[e] || e)
          .filter((e: string) => e)
          .sort();

  // Normalize set array
  const normalizedSet = (card.set || []).filter(Boolean).sort();

  // Normalize card numbers from Square Enix
  const seCardNumbers = (card.code.includes("/") ? card.code.split("/") : [card.code])
    .map((num) => num.trim())
    .filter(Boolean)
    .sort();

  // Get Re- prefix numbers from TCG card if available
  const reNumbers = tcgCard?.cardNumbers?.filter((num) => num.startsWith("Re-")) || [];

  // Combine SE numbers with Re- numbers
  const combinedCardNumbers = [...new Set([...seCardNumbers, ...reNumbers])].sort();

  // Build categories array for hash calculation
  const categories = [card.category_1];
  if (card.category_2) {
    categories.push(card.category_2);
  }

  // Only include fields that affect the card's properties
  const deltaData: HashData = {
    code: card.code || "",
    element: normalizedElement,
    rarity: card.rarity || "",
    cost: card.cost ? parseInt(String(card.cost)) || null : null,
    power: card.power ? parseInt(String(card.power)) || null : null,
    category_1: card.category_1 || "",
    category_2: card.category_2 || null,
    categories, // Include processed categories in hash calculation
    multicard: card.multicard,
    ex_burst: card.ex_burst,
    set: normalizedSet,
    cardNumbers: combinedCardNumbers, // Use combined card numbers including Re- prefix
  };

  const jsonData = JSON.stringify(deltaData);
  logger.info("Card hash data:", {
    code: deltaData.code,
    seCardNumbers,
    reNumbers,
    combinedCardNumbers,
    data: jsonData,
    hash: crypto.createHash("md5").update(jsonData).digest("hex"),
  });
  return crypto.createHash("md5").update(jsonData).digest("hex");
}

function getAllCardNumbers(card: TcgCard): string[] | null {
  if (card.isNonCard) {
    return null;
  }

  const numbers = new Set<string>();

  if (card.cardNumbers) card.cardNumbers.forEach((num) => numbers.add(num));
  if (card.fullCardNumber) numbers.add(card.fullCardNumber);
  if (card.number) numbers.add(card.number);
  if (card.primaryCardNumber) numbers.add(card.primaryCardNumber);

  return numbers.size > 0 ? Array.from(numbers) : null;
}

function findCardNumberMatch(tcgCard: TcgCard, seCard: SquareEnixCard): boolean {
  function normalizeForComparison(number: string): string {
    return number.replace(/[-\s.,;/]/g, "").toUpperCase();
  }

  // Get all Square Enix card numbers (split by forward slash)
  const seNumbers = seCard.code.split("/").map((n) => normalizeForComparison(n.trim()));

  // Get all TCG card numbers
  const tcgNumbers = getAllCardNumbers(tcgCard);
  if (!tcgNumbers) {
    return false;
  }

  // For each TCG card number, check if it matches any Square Enix number
  return tcgNumbers.some((tcgNum) => {
    const normalizedTcgNum = normalizeForComparison(tcgNum);

    // For promo cards, extract and compare the base number
    if (isPromoCard([tcgNum])) {
      const match = tcgNum.match(/PR-\d+\/(.+)/);
      if (match) {
        const baseNum = normalizeForComparison(match[1]);
        return seNumbers.some((seNum) => baseNum === seNum);
      }
      return false;
    }

    // For non-promo cards, directly compare normalized numbers
    return seNumbers.some((seNum) => normalizedTcgNum === seNum);
  });
}

async function processImages(tcgCard: TcgCard, seCard: SquareEnixCard): Promise<ImageProcessResult> {
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

function getFieldsToUpdate(tcgCard: TcgCard, seCard: SquareEnixCard): FieldUpdates {
  const updates: FieldUpdates = {
    lastUpdated: FieldValue.serverTimestamp(),
  };

  // Handle non-card products
  if (tcgCard.isNonCard) {
    logger.info(`Setting null values for non-card product ${tcgCard.id}`);
    updates.cardNumbers = null;
    updates.primaryCardNumber = null;
    updates.fullCardNumber = null;
    updates.number = null;
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

  // Process categories
  function splitCategory(category: string | undefined): string[] {
    if (!category) return [];
    return category
      .replace(/&middot;/g, "\u00B7") // Replace HTML entity with actual middot
      .split(/\u00B7/)
      .map((c) => c.trim())
      .filter(Boolean);
  }

  // Get unique categories while preserving DFF category priority
  function getUniqueOrderedCategories(categories: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    // First pass: add DFF categories while maintaining order
    categories.forEach((cat) => {
      if (cat.includes("DFF") && !seen.has(cat)) {
        seen.add(cat);
        result.push(cat);
      }
    });

    // Second pass: add remaining categories while maintaining order
    categories.forEach((cat) => {
      if (!seen.has(cat)) {
        seen.add(cat);
        result.push(cat);
      }
    });

    return result;
  }

  // Process and deduplicate categories
  const cat1 = splitCategory(seCard.category_1);
  const cat2 = splitCategory(seCard.category_2);
  const seCategories = getUniqueOrderedCategories([...cat1, ...cat2]);

  // Only update if categories have changed
  if (!arraysEqual(tcgCard.categories || [], seCategories)) {
    // Join with actual middot for category string
    const seCategory = seCategories.join("\u00B7");
    updates.category = seCategory;
    updates.categories = seCategories;
  }

  // Handle card numbers
  if (tcgCard.isNonCard) {
    // For non-card products, set all number fields to null
    updates.cardNumbers = null;
    updates.fullCardNumber = null;
    updates.primaryCardNumber = null;
    updates.number = null;
  } else {
    // For valid cards, process card numbers
    const validNumbers = seCard.code.includes("/")
      ? seCard.code
          .split("/")
          .map((num) => num.trim())
          .filter((num) => isValidCardNumber(num))
      : [seCard.code].filter((num) => isValidCardNumber(num));

    // Set all number fields to null if no valid numbers found
    if (validNumbers.length === 0) {
      updates.cardNumbers = null;
      updates.fullCardNumber = null;
      updates.primaryCardNumber = null;
      updates.number = null;
    } else {
      // Preserve "Re-" prefix numbers from TCGCSV API sync
      const existingCardNumbers = tcgCard.cardNumbers || [];
      const reNumbers = existingCardNumbers.filter((num) => num.startsWith("Re-"));

      // Merge SE numbers with Re- numbers, removing duplicates
      const mergedNumbers = [...new Set([...validNumbers, ...reNumbers])];

      logger.info(`Merging card numbers for ${tcgCard.id}:`, {
        seNumbers: validNumbers,
        existingReNumbers: reNumbers,
        mergedNumbers: mergedNumbers,
      });

      // Update card numbers
      updates.cardNumbers = mergedNumbers;

      // For fullCardNumber, combine all numbers with forward slash
      updates.fullCardNumber = mergedNumbers.join("/");

      // For primaryCardNumber and number, prefer non-Re- numbers
      const nonReNumber = validNumbers.find((num) => !num.startsWith("Re-"));
      updates.primaryCardNumber = nonReNumber || validNumbers[0];
      updates.number = nonReNumber || validNumbers[0];
    }
  }

  const fields = {
    cardType: seCard.type_en === "Crystal" || seCard.code.startsWith("C-") ? "Crystal" : seCard.type_en,
    job: seCard.type_en === "Summon" ? "" : seCard.job_en,
    rarity: isPromo ? "Promo" : rarityMap[seCard.rarity as keyof typeof rarityMap] || seCard.rarity,
    set: seCard.set || [], // Always update set from Square Enix data
    elements,
  };

  // Update fields that have changed
  for (const [field, value] of Object.entries(fields)) {
    const currentValue = tcgCard[field as keyof TcgCard];
    if (currentValue === null || currentValue === undefined) {
      updates[field as keyof FieldUpdates] = value as never;
    } else if (Array.isArray(currentValue) && Array.isArray(value)) {
      if (!arraysEqual(currentValue, value)) {
        updates[field as keyof FieldUpdates] = value as never;
      }
    } else if (JSON.stringify(currentValue) !== JSON.stringify(value)) {
      updates[field as keyof FieldUpdates] = value as never;
    }
  }

  return updates;
}

function normalizeSet(set: string): string {
  return set.trim().toLowerCase();
}

function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;

  // If arrays contain strings, normalize them before comparison
  const sortedA = [...a].sort().map((item) => (typeof item === "string" ? normalizeSet(item) : item));
  const sortedB = [...b].sort().map((item) => (typeof item === "string" ? normalizeSet(item) : item));

  return JSON.stringify(sortedA) === JSON.stringify(sortedB);
}

export async function main(options: SyncOptions = {}): Promise<UpdateResult> {
  const startTime = Date.now();
  try {
    logger.info("Starting card update process");

    // Load Square Enix cards from Firestore
    logger.info("Loading Square Enix cards from Firestore");
    const seCardsSnapshot = await db.collection(COLLECTION.SQUARE_ENIX_CARDS).get();
    const freshSeCards = seCardsSnapshot.docs.map((doc) => {
      const data = doc.data();
      logger.info(`Loading Square Enix card ${doc.id}:`, {
        cost: data.cost,
        power: data.power,
        costType: typeof data.cost,
        powerType: typeof data.power,
      });
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
    const updates = new Map<string, UpdateInfo>();

    // Get all hashes in one batch at the start
    const hashRefs = Array.from(seCards.values()).map((card) =>
      db.collection(COLLECTION.SQUARE_ENIX_HASHES).doc(card.code.replace(/\//g, ";"))
    );
    const hashDocs = await retry.execute(() => db.getAll(...hashRefs));
    const hashMap = new Map(hashDocs.map((doc) => [doc.id, doc.exists ? doc.data()?.hash : null]));

    // Process all cards
    for (const [id, tcgCard] of tcgCards) {
      const card = tcgCard;
      let fieldUpdates: FieldUpdates = {
        lastUpdated: FieldValue.serverTimestamp(),
      };
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

        // Check if any set matches between the cards
        const setMatches =
          !card.set ||
          !seCard.set ||
          card.set.some((tcgSet) => seCard.set.some((seSet) => normalizeSet(tcgSet) === normalizeSet(seSet)));
        if (numberMatches) {
          logger.info("Found number match:", {
            cardId: card.id,
            seCardCode: seCard.code,
            seCardSet: card.set,
            tcgCardSet: card.set,
            setMatches,
          });
        }
        return numberMatches && setMatches;
      });

      if (!match) {
        logger.info("No match found for card:", { cardId: card.id });
        continue;
      }

      matchCount++;
      sanitizedCode = match.code.replace(/\//g, ";");
      // Pass the TCG card to calculateHash to include Re- prefix numbers in hash calculation
      currentHash = calculateHash(match, card);
      storedHash = hashMap.get(sanitizedCode);

      logger.info(`Processing card ${card.id}:`, {
        hashExists: !!storedHash,
        hashMatch: currentHash === storedHash,
        currentHash,
        storedHash: storedHash || "none",
        forceUpdate: options.forceUpdate || false,
        cardNumbers: card.cardNumbers,
      });

      // Always get field updates and force cost/power updates
      fieldUpdates = getFieldsToUpdate(card, match);

      // Force cost/power updates from Square Enix data
      logger.info("Updating cost/power values:", {
        cardId: card.id,
        currentCost: card.cost,
        newCost: match.cost,
        currentPower: card.power,
        newPower: match.power,
      });

      // Always update cost/power from Square Enix data
      fieldUpdates.cost = match.cost;
      fieldUpdates.power = match.power;

      // Handle image URLs
      const hasNullUrls = card.highResUrl === null || card.lowResUrl === null || card.fullResUrl === null;
      if (hasNullUrls) {
        let imageResults: ImageProcessResult | null = null;
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

      if (Object.keys(fieldUpdates).length > 1) {
        // > 1 because lastUpdated is always present
        // Recalculate hash with the updated card numbers to ensure it's accurate
        const updatedHash = calculateHash(match, {
          ...card,
          cardNumbers: fieldUpdates.cardNumbers || card.cardNumbers,
        } as TcgCard);

        updates.set(id, { match, updates: fieldUpdates, hash: updatedHash });
        updateCount++;
      }
    }

    // Batch process all updates
    if (updates.size > 0) {
      for (const [id, { match, updates: fieldUpdates, hash }] of updates) {
        if (Object.keys(fieldUpdates).length > 1) {
          // > 1 because lastUpdated is always present
          batchProcessor.addOperation((batch) => {
            batch.update(db.collection(COLLECTION.CARDS).doc(id), fieldUpdates);
          });
        }

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
