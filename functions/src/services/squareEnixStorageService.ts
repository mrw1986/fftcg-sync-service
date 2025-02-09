import { db, COLLECTION } from "../config/firebase";
import { squareEnixSync } from "./squareEnixSync";
import { SyncResult } from "../types";
import * as crypto from "crypto";
import { logger } from "../utils/logger";
import { RetryWithBackoff } from "../utils/retry";
import { FieldValue } from "firebase-admin/firestore";
import { OptimizedBatchProcessor } from "./batchProcessor";
import { Cache } from "../utils/cache";

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

interface SquareEnixApiResponse {
  id: string;
  code: string;
  name_en: string;
  type_en: string;
  job_en: string;
  text_en: string;
  element: string[] | null;
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

export class SquareEnixStorageService {
  private readonly CHUNK_SIZE = 1000;
  private readonly MAX_EXECUTION_TIME = 510; // 8.5 minutes
  private readonly cache = new Cache<string>(15);
  private readonly retry = new RetryWithBackoff();
  private readonly batchProcessor: OptimizedBatchProcessor;

  constructor() {
    this.batchProcessor = new OptimizedBatchProcessor(db);
  }

  private isApproachingTimeout(startTime: Date, safetyMarginSeconds = 30): boolean {
    const executionTime = (new Date().getTime() - startTime.getTime()) / 1000;
    return executionTime > this.MAX_EXECUTION_TIME - safetyMarginSeconds;
  }

  private sanitizeDocumentId(code: string): string {
    return code.replace(/\//g, ";");
  }

  private calculateHash(card: SquareEnixApiResponse): string {
    // Only hash essential card data fields that affect the card's properties
    logger.info("Raw card data:", {
      code: card.code,
      multicard: card.multicard,
      ex_burst: card.ex_burst,
    });

    const apiData = {
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
    const jsonData = JSON.stringify(apiData);
    logger.info("Square Enix Storage hash data:", {
      code: apiData.code,
      data: jsonData,
      hash: crypto.createHash("md5").update(jsonData).digest("hex"),
    });
    return crypto.createHash("md5").update(jsonData).digest("hex");
  }

  private async getStoredHashes(codes: string[]): Promise<Map<string, string>> {
    const hashMap = new Map<string, string>();
    const uncachedCodes: string[] = [];

    codes.forEach((code) => {
      const cacheKey = `hash_${code}`;
      const cached = this.cache.get(cacheKey);
      if (cached) {
        hashMap.set(code, cached);
      } else {
        uncachedCodes.push(code);
      }
    });

    if (uncachedCodes.length === 0) {
      return hashMap;
    }

    const chunks = [];
    for (let i = 0; i < uncachedCodes.length; i += 10) {
      chunks.push(uncachedCodes.slice(i, i + 10));
    }

    if (uncachedCodes.length > 0) {
      await Promise.all(
        chunks.map(async (chunk) => {
          const refs = chunk.map((code) => db.collection(COLLECTION.SQUARE_ENIX_HASHES).doc(code));
          const snapshots = await this.retry.execute(() => db.getAll(...refs));

          snapshots.forEach((snap, index) => {
            const code = chunk[index];
            const hash = snap.exists ? snap.data()?.hash : null;
            if (hash) {
              hashMap.set(code, hash);
              this.cache.set(`hash_${code}`, hash);
            }
          });
        })
      );
    }

    return hashMap;
  }

  private async processCards(
    cards: SquareEnixApiResponse[],
    startTime: Date,
    options: { forceUpdate?: boolean } = {}
  ): Promise<{
    processed: number;
    updated: number;
    errors: string[];
  }> {
    const result = {
      processed: 0,
      updated: 0,
      errors: [] as string[],
    };

    try {
      // Get all sanitized codes and hashes in one batch
      const codes = cards.map((card) => this.sanitizeDocumentId(card.code));
      const hashMap = await this.getStoredHashes(codes);

      // Get all existing documents in one batch
      const docRefs = codes.map((code) => db.collection(COLLECTION.SQUARE_ENIX_CARDS).doc(code));
      const docSnapshots = await this.retry.execute(() => db.getAll(...docRefs));
      const docMap = new Map(docSnapshots.map((doc) => [doc.id, doc]));

      await Promise.all(
        cards.map(async (card) => {
          try {
            if (this.isApproachingTimeout(startTime)) {
              logger.warn("Approaching function timeout, skipping remaining cards");
              return;
            }

            result.processed++;
            const sanitizedCode = this.sanitizeDocumentId(card.code);
            const currentHash = this.calculateHash(card);
            const storedHash = hashMap.get(sanitizedCode);
            const docSnapshot = docMap.get(sanitizedCode);

            // Skip if document exists AND hash exists AND hash matches (unless forcing update)
            if (docSnapshot?.exists && storedHash && currentHash === storedHash && !options.forceUpdate) {
              return;
            }

            logger.info(`Updating card ${card.code} because:`, {
              docExists: docSnapshot?.exists || false,
              hashExists: !!storedHash,
              hashMatch: currentHash === storedHash,
              currentHash,
              storedHash: storedHash || "none",
              forceUpdate: options.forceUpdate || false,
            });

            // Create card document with only Square Enix fields
            const cardDoc = {
              id: parseInt(card.id) || 0,
              code: card.code || "",
              name: card.name_en || "",
              type: card.type_en || "",
              job: card.type_en === "Summon" ? "" : card.job_en || "",
              text: card.text_en || "",
              element: card.element || [],
              rarity: card.rarity || "",
              cost: card.cost || "",
              power: card.power || "",
              category_1: card.category_1 || "",
              category_2: card.category_2 || null,
              multicard: card.multicard === "1",
              ex_burst: card.ex_burst === "1",
              set: card.set || [],
              images: {
                thumbs: card.images.thumbs || [],
                full: card.images.full || [],
              },
              processedImages: {
                highResUrl: null,
                lowResUrl: null,
              },
              lastUpdated: FieldValue.serverTimestamp(),
            };

            // Update card and hash in a single batch
            await this.batchProcessor.addOperation((batch) => {
              const docRef = db.collection(COLLECTION.SQUARE_ENIX_CARDS).doc(sanitizedCode);
              batch.set(docRef, cardDoc, { merge: true });

              batch.set(db.collection(COLLECTION.SQUARE_ENIX_HASHES).doc(sanitizedCode), {
                hash: currentHash,
                lastUpdated: FieldValue.serverTimestamp(),
              });
            });

            // Update cache immediately
            this.cache.set(`hash_${sanitizedCode}`, currentHash);
            result.updated++;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            result.errors.push(`Error processing card ${card.code}: ${errorMessage}`);
            logger.error(`Error processing card ${card.code}`, { error: errorMessage });
          }
        })
      );

      await this.batchProcessor.commitAll();

      logger.info(`Processed ${cards.length} cards`, {
        totalProcessed: result.processed,
        totalUpdated: result.updated,
        errors: result.errors.length,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Batch processing error: ${errorMessage}`);
      logger.error("Batch processing error", { error: errorMessage });
    }

    return result;
  }

  async syncSquareEnixCards(options: { forceUpdate?: boolean; limit?: number } = {}): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      itemsProcessed: 0,
      itemsUpdated: 0,
      errors: [],
      timing: {
        startTime: new Date(),
      },
    };

    try {
      logger.info("Starting Square Enix card sync", {
        forceUpdate: options.forceUpdate || false,
      });

      // Fetch all cards from API
      let cards = await this.retry.execute(() => squareEnixSync.fetchAllCards());

      // Apply limit if specified
      if (options.limit) {
        logger.info(`Limiting sync to first ${options.limit} cards`);
        cards = cards.slice(0, options.limit);
      }

      logger.info(`Retrieved ${cards.length} cards from Square Enix API`);

      // Process cards in chunks
      for (let i = 0; i < cards.length; i += this.CHUNK_SIZE) {
        if (this.isApproachingTimeout(result.timing.startTime)) {
          logger.warn("Approaching function timeout, stopping processing");
          break;
        }

        const cardChunk = cards.slice(i, i + this.CHUNK_SIZE);
        const batchResults = await this.processCards(cardChunk, result.timing.startTime, options);

        result.itemsProcessed += batchResults.processed;
        result.itemsUpdated += batchResults.updated;
        result.errors.push(...batchResults.errors);
      }

      result.timing.endTime = new Date();
      result.timing.duration = (result.timing.endTime.getTime() - result.timing.startTime.getTime()) / 1000;

      logger.info(`Square Enix sync completed in ${result.timing.duration}s`, {
        processed: result.itemsProcessed,
        updated: result.itemsUpdated,
        errors: result.errors.length,
      });
    } catch (error) {
      result.success = false;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Square Enix sync failed: ${errorMessage}`);
      logger.error("Square Enix sync failed", { error: errorMessage });
    }

    return result;
  }
}

export const squareEnixStorage = new SquareEnixStorageService();
