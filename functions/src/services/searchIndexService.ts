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

    // Add soundex code
    const soundexCode = this.soundex(cleanText);
    if (soundexCode) {
      terms.add(soundexCode);
    }

    return Array.from(terms);
  }

  private generateNumberSearchTerms(numbers: string[]): string[] {
    if (!numbers?.length) return [];

    const terms = new Set<string>();

    numbers.forEach((number) => {
      if (!number) return;

      // Clean and normalize the number
      const cleanNumber = number.toLowerCase().replace(/\s+/g, "");
      const withoutSpecial = cleanNumber.replace(/[^a-z0-9]/g, "");

      // Add full number
      terms.add(cleanNumber); // Original format (e.g., "1-001H")
      terms.add(withoutSpecial); // Without special chars (e.g., "1001H")

      // Add progressive substrings
      for (let i = 1; i < withoutSpecial.length; i++) {
        terms.add(withoutSpecial.substring(0, i));
      }

      // If number contains hyphen, add parts
      if (cleanNumber.includes("-")) {
        const [prefix, suffix] = cleanNumber.split("-");
        if (prefix) terms.add(prefix);
        if (suffix) terms.add(suffix);
      }
    });

    return Array.from(terms);
  }

  private soundex(s: string): string {
    if (!s) return "";

    // Convert to uppercase and get first character
    s = s.toUpperCase();
    const firstChar = s[0];

    // Map of characters to soundex codes
    const codes: Record<string, string> = {
      A: "",
      E: "",
      I: "",
      O: "",
      U: "",
      B: "1",
      F: "1",
      P: "1",
      V: "1",
      C: "2",
      G: "2",
      J: "2",
      K: "2",
      Q: "2",
      S: "2",
      X: "2",
      Z: "2",
      D: "3",
      T: "3",
      L: "4",
      M: "5",
      N: "5",
      R: "6",
    };

    // Convert remaining characters to codes
    const remaining = s
      .substring(1)
      .split("")
      .map((c) => codes[c] || "")
      .filter((code) => code !== "")
      .join("");

    // Build final soundex code
    const code = firstChar + remaining;
    return (code + "000").substring(0, 4);
  }

  private calculateSearchTermsHash(searchTerms: string[]): string {
    return crypto.createHash("md5").update(JSON.stringify(searchTerms.sort())).digest("hex");
  }

  private async processCardBatch(
    cards: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>
  ): Promise<number> {
    let updatedCount = 0;

    try {
      // Get all hashes in one batch
      const hashRefs = cards.docs.map((doc) => db.collection(COLLECTION.SEARCH_HASHES).doc(doc.id));
      const hashDocs = await this.retry.execute(() => db.getAll(...hashRefs));
      const hashMap = new Map(hashDocs.map((doc) => [doc.id, doc.exists ? doc.data()?.hash : null]));

      // Log hash information
      logger.info("Search term hashes:", {
        totalHashes: hashMap.size,
        sampleHashes: Array.from(hashMap.entries()).slice(0, 5),
      });

      const updates = new Map<string, { searchTerms: string[]; hash: string }>();

      // Process all cards first
      cards.docs.forEach((doc) => {
        const cardData = doc.data();

        // Skip if card numbers are missing
        if (!Array.isArray(cardData.cardNumbers)) return;

        // Skip if regular card has no name
        if (!cardData.isNonCard && !cardData.name) return;

        // Generate search terms
        const nameTerms = cardData.name ? this.generateSearchTerms(cardData.name) : [];
        const numberTerms = this.generateNumberSearchTerms(cardData.cardNumbers);

        // For regular cards, require name search terms
        if (!cardData.isNonCard && nameTerms.length === 0) return;

        // Combine all search terms
        const searchTerms = [...new Set([...nameTerms, ...numberTerms])];

        // Calculate hash of search terms
        const currentHash = this.calculateSearchTermsHash(searchTerms);
        const storedHash = hashMap.get(doc.id);

        // Only update if hash has changed
        if (currentHash !== storedHash) {
          updates.set(doc.id, { searchTerms, hash: currentHash });
          updatedCount++;
          logger.info(`Updating search terms for card ${doc.id}`, {
            currentHash,
            storedHash: storedHash || "none",
            searchTerms,
          });
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

  async updateSearchIndex(options: { limit?: number } = {}): Promise<{ totalProcessed: number; totalUpdated: number }> {
    let lastProcessedId: string | null = null;
    let totalProcessed = 0;
    let totalUpdated = 0;
    let retryCount = 0;
    const maxRetries = 3;

    try {
      await logger.info("Starting search index update", { options });

      let hasMoreCards = true;
      while (hasMoreCards) {
        try {
          // Query the next batch of cards
          let query = db.collection(COLLECTION.CARDS).orderBy("__name__");

          // Apply user limit if specified, otherwise use batch size
          const queryLimit = options.limit || this.BATCH_SIZE;
          query = query.limit(queryLimit);

          if (lastProcessedId) {
            query = query.startAfter(lastProcessedId);
          }

          // Log query parameters
          logger.info("Querying cards", {
            limit: queryLimit,
            lastProcessedId: lastProcessedId || "none",
          });

          const cards = await query.get();

          // Break if no more cards to process
          if (cards.empty) {
            hasMoreCards = false;
            continue;
          }

          // Process this batch
          const updatedCount = await this.processCardBatch(cards);

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

          // If we have a user-specified limit and we've reached it, stop
          if (options.limit && totalProcessed >= options.limit) {
            hasMoreCards = false;
            continue;
          }

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
