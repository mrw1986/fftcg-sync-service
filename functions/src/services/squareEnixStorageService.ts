import { db, COLLECTION } from "../config/firebase";
import { squareEnixSync } from "./squareEnixSync";
import { SyncResult } from "../types";
import * as crypto from "crypto";
import { logger } from "../utils/logger";
import { RetryWithBackoff } from "../utils/retry";
import { FieldValue } from "firebase-admin/firestore";
import { OptimizedBatchProcessor } from "./batchProcessor";

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
  cost: string | null;
  power: string | null;
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
  private readonly retry = new RetryWithBackoff();
  private readonly batchProcessor: OptimizedBatchProcessor;

  constructor() {
    this.batchProcessor = new OptimizedBatchProcessor(db);
  }

  private isApproachingTimeout(startTime: Date, safetyMarginSeconds = 30): boolean {
    const executionTime = (new Date().getTime() - startTime.getTime()) / 1000;
    return executionTime > this.MAX_EXECUTION_TIME - safetyMarginSeconds;
  }

  private sanitizeDocumentId(card: SquareEnixApiResponse): string {
    // Include set in the ID to handle duplicate card numbers
    const set = card.set?.[0] || "Unknown";
    const sanitizedSet = set.replace(/[^a-zA-Z0-9]/g, "");
    return `${card.code.replace(/\//g, ";")}_${sanitizedSet}`;
  }

  private calculateHash(card: SquareEnixApiResponse): string {
    // Only hash essential card data fields that affect the card's properties
    logger.info("Raw card data:", {
      code: card.code,
      multicard: card.multicard,
      ex_burst: card.ex_burst,
      set: card.set,
    });

    // Normalize element array
    const normalizedElement =
      card.type_en === "Crystal" || card.code.startsWith("C-") ?
        ["Crystal"] :
        (card.element || []).filter((e: string) => e).sort();

    // Normalize set array
    const normalizedSet = (card.set || []).filter((s: string) => s).sort();

    // Only include fields that affect the card's properties
    const apiData = {
      code: card.code || "",
      element: normalizedElement,
      rarity: card.rarity || "",
      cost: card.cost ? parseInt(card.cost.trim()) || null : null,
      power: card.power ? parseInt(card.power.trim()) || null : null,
      category_1: card.category_1 || "",
      category_2: card.category_2 || null,
      multicard: card.multicard,
      ex_burst: card.ex_burst,
      set: normalizedSet,
      cardNumbers: (card.code.includes("/") ? card.code.split("/") : [card.code])
        .map((num) => num.trim())
        .filter((num) => num)
        .sort(),
    };
    const jsonData = JSON.stringify(apiData);
    logger.info("Square Enix Storage hash data:", {
      code: apiData.code,
      data: jsonData,
      hash: crypto.createHash("md5").update(jsonData).digest("hex"),
    });
    return crypto.createHash("md5").update(jsonData).digest("hex");
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
      // Get all existing documents and hashes in one batch
      const codes = cards.map((card) => this.sanitizeDocumentId(card));
      const docRefs = codes.map((code) => db.collection(COLLECTION.SQUARE_ENIX_CARDS).doc(code));
      const hashRefs = codes.map((code) => db.collection(COLLECTION.SQUARE_ENIX_HASHES).doc(code));
      const [docSnapshots, hashSnapshots] = await Promise.all([
        this.retry.execute(() => db.getAll(...docRefs)),
        this.retry.execute(() => db.getAll(...hashRefs)),
      ]);
      const docMap = new Map(docSnapshots.map((doc) => [doc.id, doc]));
      const hashMap = new Map(hashSnapshots.map((doc) => [doc.id, doc.exists ? doc.data()?.hash : null]));

      await Promise.all(
        cards.map(async (card) => {
          try {
            if (this.isApproachingTimeout(startTime)) {
              logger.warn("Approaching function timeout, skipping remaining cards");
              return;
            }

            result.processed++;
            const sanitizedCode = this.sanitizeDocumentId(card);
            const docSnapshot = docMap.get(sanitizedCode);
            const incomingHash = this.calculateHash(card);

            // Get stored hash from map
            const existingHash = hashMap.get(sanitizedCode);

            logger.info(`Processing card ${card.code}:`, {
              docExists: docSnapshot?.exists || false,
              hashMatch: incomingHash === existingHash,
              incomingHash,
              existingHash: existingHash || "none",
              forceUpdate: options.forceUpdate || false,
            });

            // Skip if document exists and hashes match (unless forcing update)
            if (docSnapshot?.exists && incomingHash === existingHash && !options.forceUpdate) {
              return;
            }

            // Create card document with only Square Enix fields
            const cardDoc = {
              id: parseInt(card.id) || 0,
              code: card.code.replace(/;/g, "/") || "", // Store unsanitized code in document
              name: card.name_en || "",
              type: card.type_en || "",
              job: card.type_en === "Summon" ? "" : card.job_en || "",
              text: card.text_en || "",
              element:
                card.type_en === "Crystal" || card.code.startsWith("C-") ?
                  ["Crystal"] :
                  (card.element || []).map((e) => elementMap[e] || e),
              rarity: card.rarity || "",
              cost: card.cost ? parseInt(card.cost.trim()) || null : null,
              power: card.power ? parseInt(card.power.trim()) || null : null,
              category_1: card.category_1 || "",
              category_2: card.category_2 || null,
              multicard: card.multicard,
              ex_burst: card.ex_burst,
              set: card.set || [],
              lastUpdated: FieldValue.serverTimestamp(),
            };

            // Update card and hash in a single batch
            await this.batchProcessor.addOperation((batch) => {
              const docRef = db.collection(COLLECTION.SQUARE_ENIX_CARDS).doc(sanitizedCode);
              batch.set(docRef, cardDoc, { merge: true });

              batch.set(db.collection(COLLECTION.SQUARE_ENIX_HASHES).doc(sanitizedCode), {
                hash: incomingHash,
                lastUpdated: FieldValue.serverTimestamp(),
              });
            });

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
