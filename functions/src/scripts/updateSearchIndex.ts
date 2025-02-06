import { db, COLLECTION } from "../config/firebase";
import { logger } from "../utils/logger";
import { OptimizedBatchProcessor } from "../services/batchProcessor";
import { FieldValue } from "firebase-admin/firestore";

interface SearchMap {
  [key: string]: {
    k: string;   // The key/term being indexed
    w: string;   // The full word this term is from
    p: number;   // Position in the text
  }[];
}

interface CardSearchData {
  name: string;
  cardNumbers: string[];
}

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
    terms.forEach(term => {
      if (!searchMap[term]) {
        searchMap[term] = [];
      }

      // Add term data with position information
      searchMap[term].push({
        k: term,           // The search term
        w: word,          // The full word
        p: position       // Position in text
      });
    });
  });

  return searchMap;
}

function generateNumberSearchMap(numbers: string[]): SearchMap {
  const searchMap: SearchMap = {};

  numbers.forEach((number, position) => {
    // Clean and normalize the number
    const cleanNumber = number.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // Generate n-grams for the number
    const terms = generateNGrams(cleanNumber);

    // Add each term to the search map
    terms.forEach(term => {
      if (!searchMap[term]) {
        searchMap[term] = [];
      }

      // Add term data with position information
      searchMap[term].push({
        k: term,           // The search term
        w: cleanNumber,    // The full number
        p: position        // Position in array
      });
    });
  });

  return searchMap;
}

async function processCardBatch(
  cards: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>,
  batchProcessor: OptimizedBatchProcessor
): Promise<void> {
  for (const doc of cards.docs) {
    const cardData = doc.data() as CardSearchData;
    
    // Skip if card data is missing required fields
    if (!cardData.name || !Array.isArray(cardData.cardNumbers)) {
      logger.warn(`Skipping card ${doc.id} - missing required fields`);
      continue;
    }

    // Generate search maps
    const nameSearchMap = generateSearchMap(cardData.name);
    const numberSearchMap = generateNumberSearchMap(cardData.cardNumbers);

    // Update the card document with the search maps
    await batchProcessor.addOperation((batch) => {
      const cardRef = db.collection(COLLECTION.CARDS).doc(doc.id);
      batch.update(cardRef, {
        searchName: nameSearchMap,      // Map for name-based search
        searchNumber: numberSearchMap,  // Map for number-based search
        searchLastUpdated: FieldValue.serverTimestamp()
      });
    });
  }
}

export async function main(): Promise<void> {
  const batchProcessor = new OptimizedBatchProcessor(db);
  const batchSize = 500;
  let lastProcessedId: string | null = null;
  let totalProcessed = 0;
  
  try {
    logger.info("Starting search index update");

    while (true) {
      // Query the next batch of cards
      let query = db.collection(COLLECTION.CARDS)
        .orderBy('__name__')  // Use document ID for ordering
        .limit(batchSize);

      if (lastProcessedId) {
        query = query.startAfter(lastProcessedId);
      }

      const cards = await query.get();

      // Break if no more cards to process
      if (cards.empty) {
        break;
      }

      // Process this batch
      await processCardBatch(cards, batchProcessor);
      
      // Commit any remaining operations
      await batchProcessor.commitAll();

      // Update progress tracking
      lastProcessedId = cards.docs[cards.docs.length - 1].id;
      totalProcessed += cards.docs.length;

      logger.info(`Processed ${totalProcessed} cards`);
    }

    logger.info(`Search index update completed. Total cards processed: ${totalProcessed}`);
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