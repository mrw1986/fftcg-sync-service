import { db, COLLECTION } from "../config/firebase";
import { logger } from "../utils/logger";
import { OptimizedBatchProcessor } from "../services/batchProcessor";
import { FieldValue } from "firebase-admin/firestore";
import * as crypto from "crypto";
import { Cache } from "../utils/cache";
import { RetryWithBackoff } from "../utils/retry";

interface SearchMap {
  [key: string]: {
    k: string; // The key/term being indexed
    w: string; // The full word this term is from
    p: number; // Position in the text
  }[];
}

interface CardSearchData {
  name: string;
  cardNumbers: string[];
}

const cache = new Cache<string>(15);
const retry = new RetryWithBackoff();

function generateNGrams(text: string, minGramSize = 2): string[] {
  const normalized = text.toLowerCase().trim();
  const terms: string[] = [];

  // Add full word
  terms.push(normalized);

  // Add n-grams
  for (let i = 0; i < normalized.length - minGramSize + 1; i++) {
    for (let j = minGramSize; j <= normalized.length - i; j++) {
      terms.push(normalized.slice(i, i + j));
    }
  }

  return [...new Set(terms)];
}

function generateSearchMap(text: string): SearchMap {
  const searchMap: SearchMap = {};
  const words = text.toLowerCase().trim().split(/\s+/);

  words.forEach((word, position) => {
    // Generate n-grams for the word
    const terms = generateNGrams(word);

    // Add each term to the search map
    terms.forEach((term) => {
      if (!searchMap[term]) {
        searchMap[term] = [];
      }

      // Add term data with position information
      searchMap[term].push({
        k: term, // The search term
        w: word, // The full word
        p: position, // Position in text
      });
    });
  });

  return searchMap;
}

function generateNumberSearchMap(numbers: string[]): SearchMap {
  const searchMap: SearchMap = {};

  numbers.forEach((number, position) => {
    // Clean and normalize the number
    const cleanNumber = number.toLowerCase().replace(/[^a-z0-9]/g, "");

    // Generate n-grams for the number
    const terms = generateNGrams(cleanNumber);

    // Add each term to the search map
    terms.forEach((term) => {
      if (!searchMap[term]) {
        searchMap[term] = [];
      }

      // Add term data with position information
      searchMap[term].push({
        k: term, // The search term
        w: cleanNumber, // The full number
        p: position, // Position in array
      });
    });
  });

  return searchMap;
}

function calculateHash(cardData: CardSearchData): string {
  const data = {
    name: cardData.name || "",
    cardNumbers: cardData.cardNumbers || [],
  };
  return crypto.createHash("md5").update(JSON.stringify(data)).digest("hex");
}

async function getStoredHashes(cardIds: string[]): Promise<Map<string, string>> {
  const hashMap = new Map<string, string>();
  const uncachedIds: string[] = [];

  cardIds.forEach((id) => {
    const cacheKey = `search_hash_${id}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      hashMap.set(id, cached);
    } else {
      uncachedIds.push(id);
    }
  });

  if (uncachedIds.length === 0) {
    return hashMap;
  }

  const chunks = [];
  for (let i = 0; i < uncachedIds.length; i += 10) {
    chunks.push(uncachedIds.slice(i, i + 10));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      const refs = chunk.map((id) => db.collection(COLLECTION.SEARCH_HASHES).doc(id));
      const snapshots = await retry.execute(() => db.getAll(...refs));

      snapshots.forEach((snap, index) => {
        const id = chunk[index];
        const hash = snap.exists ? snap.data()?.hash : null;
        if (hash) {
          hashMap.set(id, hash);
          cache.set(`search_hash_${id}`, hash);
        }
      });
    })
  );

  return hashMap;
}

async function processCardBatch(
  cards: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>,
  batchProcessor: OptimizedBatchProcessor
): Promise<number> {
  let updatedCount = 0;
  const cardIds = cards.docs.map((doc) => doc.id);
  const hashMap = await getStoredHashes(cardIds);

  for (const doc of cards.docs) {
    const cardData = doc.data() as CardSearchData;

    // Skip if card data is missing required fields
    if (!cardData.name || !Array.isArray(cardData.cardNumbers)) {
      logger.warn(`Skipping card ${doc.id} - missing required fields`);
      continue;
    }

    // Calculate current hash
    const currentHash = calculateHash(cardData);
    const storedHash = hashMap.get(doc.id);

    // Skip if hash matches
    if (currentHash === storedHash) {
      continue;
    }

    // Generate search maps
    const nameSearchMap = generateSearchMap(cardData.name);
    const numberSearchMap = generateNumberSearchMap(cardData.cardNumbers);

    // Update the card document and hash in a single batch
    await batchProcessor.addOperation((batch) => {
      const cardRef = db.collection(COLLECTION.CARDS).doc(doc.id);
      batch.update(cardRef, {
        searchName: nameSearchMap,
        searchNumber: numberSearchMap,
        searchLastUpdated: FieldValue.serverTimestamp(),
      });

      // Update hash
      const hashRef = db.collection(COLLECTION.SEARCH_HASHES).doc(doc.id);
      batch.set(
        hashRef,
        {
          hash: currentHash,
          lastUpdated: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    // Update cache immediately
    cache.set(`search_hash_${doc.id}`, currentHash);
    updatedCount++;
  }

  return updatedCount;
}

export async function main(): Promise<void> {
  const batchProcessor = new OptimizedBatchProcessor(db);
  const batchSize = 500;
  let lastProcessedId: string | null = null;
  let totalProcessed = 0;
  let totalUpdated = 0;

  try {
    logger.info("Starting search index update");

    let hasMoreCards = true;
    while (hasMoreCards) {
      // Query the next batch of cards
      let query = db
        .collection(COLLECTION.CARDS)
        .orderBy("__name__") // Use document ID for ordering
        .limit(batchSize);

      if (lastProcessedId) {
        query = query.startAfter(lastProcessedId);
      }

      const cards = await query.get();

      // Break if no more cards to process
      if (cards.empty) {
        hasMoreCards = false;
        continue;
      }

      // Process this batch
      const updatedCount = await processCardBatch(cards, batchProcessor);

      // Commit any remaining operations
      await batchProcessor.commitAll();

      // Update progress tracking
      lastProcessedId = cards.docs[cards.docs.length - 1].id;
      totalProcessed += cards.docs.length;
      totalUpdated += updatedCount;

      logger.info(`Processed batch`, {
        batchSize: cards.docs.length,
        totalProcessed,
        totalUpdated,
      });
    }

    logger.info(`Search index update completed`, {
      totalProcessed,
      totalUpdated,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Search index update failed", { error: errorMessage });
    throw error;
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error("Script failed", { error });
    process.exit(1);
  });
}
