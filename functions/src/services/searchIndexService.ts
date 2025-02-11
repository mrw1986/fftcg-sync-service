import { db, COLLECTION } from "../config/firebase";
import * as crypto from "crypto";
import { OptimizedBatchProcessor } from "./batchProcessor";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "../utils/logger";
import { RetryWithBackoff } from "../utils/retry";

export class SearchIndexService {
  private readonly batchProcessor: OptimizedBatchProcessor;
  private readonly BATCH_SIZE = 500;
  private readonly retry: RetryWithBackoff;

  constructor() {
    this.batchProcessor = new OptimizedBatchProcessor(db);
    this.retry = new RetryWithBackoff();
  }

  private generateSearchTerms(text: string): string[] {
    if (!text) return [];

    const terms = new Set<string>();
    const cleanText = text.toLowerCase().trim();

    // Add full word
    terms.add(cleanText);

    // Add progressive substrings for prefix search
    for (let i = 1; i < cleanText.length; i++) {
      terms.add(cleanText.substring(0, i));
    }

    // We no longer use soundex codes

    return Array.from(terms);
  }

  private generateNumberSearchTerms(numbers: string[]): string[] {
    if (!numbers?.length) return [];

    const terms = new Set<string>();

    numbers.forEach((number) => {
      if (!number) return;

      // Clean and normalize the number
      const cleanNumber = number.toLowerCase().replace(/\s+/g, "");

      // Add first character
      if (cleanNumber.length > 0) {
        terms.add(cleanNumber[0]);
      }

      // Handle numbers with hyphen (e.g., "13-114h" or "pr-101")
      if (cleanNumber.includes("-")) {
        const [prefix, suffix] = cleanNumber.split("-");

        // Add full prefix (e.g., "13" or "pr")
        if (prefix) {
          terms.add(prefix);
        }

        // Add prefix with hyphen (e.g., "13-" or "pr-")
        if (prefix) {
          terms.add(`${prefix}-`);
        }

        // Add progressive parts with hyphen
        if (prefix && suffix) {
          let current = "";
          for (const char of suffix) {
            current += char;
            terms.add(`${prefix}-${current}`);
          }
        }
      } else {
        // For numbers without hyphen, just add the full number
        terms.add(cleanNumber);
      }
    });

    return Array.from(terms);
  }

  private calculateSearchTermsHash(searchTerms: string[]): string {
    return crypto.createHash("md5").update(JSON.stringify(searchTerms.sort())).digest("hex");
  }

  private async processCardBatch(
    cards: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>,
    options: { forceUpdate?: boolean } = {}
  ): Promise<number> {
    let updatedCount = 0;

    try {
      // Get all hashes in one batch
      const hashRefs = cards.docs.map((doc) => db.collection(COLLECTION.SEARCH_HASHES).doc(doc.id));
      const hashDocs = await this.retry.execute(() => db.getAll(...hashRefs));
      const hashMap = new Map(hashDocs.map((doc) => [doc.id, doc.exists ? doc.data()?.hash : null]));

      const updates = new Map<string, { searchTerms: string[]; hash: string }>();

      // Process all cards first
      cards.docs.forEach((doc) => {
        const cardData = doc.data();

        // Skip if card numbers are missing
        if (!Array.isArray(cardData.cardNumbers)) return;

        // Skip if regular card has no cleanName
        if (!cardData.isNonCard && !cardData.cleanName) return;

        // Generate search terms
        const nameTerms = cardData.cleanName ? this.generateSearchTerms(cardData.cleanName) : [];
        const numberTerms = this.generateNumberSearchTerms(cardData.cardNumbers);

        // For regular cards, require name search terms
        if (!cardData.isNonCard && nameTerms.length === 0) return;

        // Combine all search terms
        const searchTerms = [...new Set([...nameTerms, ...numberTerms])];

        // Calculate hash of search terms
        const currentHash = this.calculateSearchTermsHash(searchTerms);
        const storedHash = hashMap.get(doc.id);

        // Update if hash has changed, searchTerms is missing, or force update is enabled
        if (currentHash !== storedHash || !cardData.searchTerms || options.forceUpdate) {
          updates.set(doc.id, { searchTerms, hash: currentHash });
          updatedCount++;
        }
      });

      // Batch all updates
      if (updates.size > 0) {
        for (const [id, { searchTerms, hash }] of updates) {
          this.batchProcessor.addOperation((batch: FirebaseFirestore.WriteBatch) => {
            const cardRef = db.collection(COLLECTION.CARDS).doc(id);
            batch.update(cardRef, {
              searchTerms: searchTerms,
              searchLastUpdated: FieldValue.serverTimestamp(),
            });

            const hashRef = db.collection(COLLECTION.SEARCH_HASHES).doc(id);
            batch.set(hashRef, {
              hash,
              lastUpdated: FieldValue.serverTimestamp(),
            });
          });
        }

        await this.batchProcessor.commitAll();
      }

      return updatedCount;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await logger.error(`Error processing batch:`, { error: errorMessage });
      throw error;
    }
  }

  async updateSearchIndex(
    options: { limit?: number; forceUpdate?: boolean } = {}
  ): Promise<{ totalProcessed: number; totalUpdated: number }> {
    let lastProcessedId: string | null = null;
    let totalProcessed = 0;
    let totalUpdated = 0;
    let retryCount = 0;
    const maxRetries = 3;

    try {
      await logger.info("Starting search index update");

      let hasMoreCards = true;
      while (hasMoreCards) {
        try {
          // Query the next batch of cards
          let query = db.collection(COLLECTION.CARDS).orderBy("__name__").limit(this.BATCH_SIZE);

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
          const updatedCount = await this.processCardBatch(cards, { forceUpdate: options.forceUpdate });

          // Update progress tracking
          lastProcessedId = cards.docs[cards.docs.length - 1].id;
          totalProcessed += cards.docs.length;
          totalUpdated += updatedCount;
          retryCount = 0; // Reset retry count on success

          // Log progress after each batch
          await logger.info("Progress:", {
            batchSize: cards.docs.length,
            totalProcessed,
            totalUpdated,
          });

          // Small delay between batches
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (batchError) {
          const errorMessage = batchError instanceof Error ? batchError.message : String(batchError);
          await logger.error("Batch error:", { error: errorMessage });

          retryCount++;
          if (retryCount >= maxRetries) {
            throw new Error(`Failed after ${maxRetries} retries`);
          }

          // Exponential backoff
          const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Log final completion with total counts
      await logger.info("Search index update completed:", {
        totalProcessed,
        totalUpdated,
        success: true,
      });

      return { totalProcessed, totalUpdated };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await logger.error("Search index update failed:", { error: errorMessage });
      throw error;
    }
  }
}

export const searchIndex = new SearchIndexService();
