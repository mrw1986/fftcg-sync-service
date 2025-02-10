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
  name_en: string;
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
    name: card.name_en || "",
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
  const seCode = seCard.code;
  const isPromo = isPromoCard(tcgCard);
  const cardNumbers = getAllCardNumbers(tcgCard);

  if (isPromo) {
    const getBaseNumber = (num: string): string | null => {
      const match = num.match(/PR-\d+\/(.+)/);
      return match ? match[1] : null;
    };

    return cardNumbers.some((num) => {
      const baseNum = getBaseNumber(num);
      return baseNum === seCode;
    });
  }

  return cardNumbers.includes(seCode);
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

  const fields = {
    cardType: seCard.type_en,
    category: seCard.category_1,
    category_2: seCard.category_2 || undefined,
    cleanName: seCard.name_en,
    cost: seCard.cost ? parseInt(seCard.cost.trim()) || null : null,
    elements,
    job: seCard.type_en === "Summon" ? "" : seCard.job_en,
    name: seCard.name_en,
    power: seCard.power ? parseInt(seCard.power.trim()) || null : null,
    rarity: isPromo ? "Promo" : rarityMap[seCard.rarity as keyof typeof rarityMap] || seCard.rarity,
<<<<<<< HEAD
    set: seCard.set,
=======
    sets: seCard.set || [],
    cardNumbers: [seCard.code],
    isNonCard: false,
>>>>>>> 469b73138a20f472853a2b10d46cf1df8ebdceb6
  };

  for (const [field, value] of Object.entries(fields)) {
    const currentValue = tcgCard[field];
    if (currentValue === null || currentValue === undefined || JSON.stringify(currentValue) !== JSON.stringify(value)) {
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
      const match = Array.from(seCards.values()).find((seCard) => findCardNumberMatch(card, seCard as SquareEnixCard));
      if (!match) continue;

      matchCount++;

      // Get current hash
      const sanitizedCode = match.code.replace(/\//g, ";");
      const currentHash = calculateHash(match as SquareEnixCard);
      const storedHash = hashMap.get(sanitizedCode);

      // Only calculate updates if hash has changed or force update
      if (currentHash !== storedHash || options.forceUpdate) {
        const fieldUpdates = getFieldsToUpdate(card, match as SquareEnixCard);

        // Check for missing images
        if (card.highResUrl === null || card.lowResUrl === null || card.fullResUrl === null) {
          if (card.isNonCard) {
            // For non-card products, use placeholder immediately
            if (card.highResUrl === null) fieldUpdates.highResUrl = PLACEHOLDER_URL;
            if (card.fullResUrl === null) fieldUpdates.fullResUrl = PLACEHOLDER_URL;
            if (card.lowResUrl === null) fieldUpdates.lowResUrl = PLACEHOLDER_URL;
          } else {
            // For regular cards, try Square Enix images first
            const imageResults = await processImages(card, match as SquareEnixCard);

            if (card.highResUrl === null) {
              fieldUpdates.highResUrl = imageResults.highResUrl || PLACEHOLDER_URL;
              fieldUpdates.fullResUrl = imageResults.highResUrl || PLACEHOLDER_URL;
            }
            if (card.lowResUrl === null) {
              fieldUpdates.lowResUrl = imageResults.lowResUrl || PLACEHOLDER_URL;
            }
          }
        }

        if (Object.keys(fieldUpdates).length > 0) {
          updates.set(id, { match, updates: fieldUpdates, hash: currentHash });
          updateCount++;
          logger.info(`Updating card ${card.id} due to hash mismatch`, {
            currentHash,
            storedHash: storedHash || "none",
            sanitizedCode,
          });
        }
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
