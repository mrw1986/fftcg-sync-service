import { db, COLLECTION } from "../config/firebase";
import { squareEnixSync } from "./squareEnixSync";
import { SyncResult } from "../types";
import * as crypto from "crypto";
import { logger } from "../utils/logger";
import { RetryWithBackoff } from "../utils/retry";
import { FieldValue } from "firebase-admin/firestore";
import { OptimizedBatchProcessor } from "./batchProcessor";
import { Cache } from "../utils/cache";

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
    // Only hash essential card data fields, excluding element and metadata
    const apiData = {
      id: card.id,
      code: card.code,
      name: card.name_en,
      type: card.type_en,
      job: card.job_en,
      text: card.text_en,
      rarity: card.rarity,
      cost: card.cost,
      power: card.power,
      category_1: card.category_1,
      category_2: card.category_2,
      multicard: card.multicard,
      ex_burst: card.ex_burst,
      set: card.set,
      images: {
        thumbs: card.images.thumbs,
        full: card.images.full,
      },
    };
    return crypto.createHash("md5").update(JSON.stringify(apiData)).digest("hex");
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

    // Log hash retrieval stats
    logger.info("Loading stored hashes", {
      totalCodes: codes.length,
      cachedCount: hashMap.size,
      uncachedCount: uncachedCodes.length,
    });

    if (uncachedCodes.length > 0) {
      await Promise.all(
        chunks.map(async (chunk) => {
          const refs = chunk.map((code) => db.collection(COLLECTION.SQUARE_ENIX_HASHES).doc(code));
          const snapshots = await this.retry.execute(() => db.getAll(...refs));

          snapshots.forEach((snap, index) => {
            const code = chunk[index];
            const hash = snap.exists ? snap.data()?.hash : null;
            logger.info(`Retrieved hash for ${code}`, {
              exists: snap.exists,
              hash: hash || "none",
            });
            if (hash) {
              hashMap.set(code, hash);
              this.cache.set(`hash_${code}`, hash);
            }
          });
        })
      );

      logger.info("Finished loading stored hashes", {
        totalLoaded: hashMap.size,
        sampleHashes: Array.from(hashMap.entries()).slice(0, 5),
      });
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
      // Get all sanitized codes
      const codes = cards.map((card) => this.sanitizeDocumentId(card.code));
      const hashMap = await this.getStoredHashes(codes);

      // Track cards that change frequently
      const frequentChanges = new Set<string>();

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

            // Get current document state
            const docRef = db.collection(COLLECTION.SQUARE_ENIX_CARDS).doc(sanitizedCode);
            const docSnapshot = await this.retry.execute(() => docRef.get());

            // Log detailed diagnostics for first 5 cards and any that change
            if (result.processed <= 5 || currentHash !== storedHash) {
              logger.info(`Card ${card.code} details`, {
                sanitizedCode,
                currentHash,
                storedHash: storedHash || "none",
                hashChanged: currentHash !== storedHash,
                rawData: {
                  code: card.code,
                  name: card.name_en,
                  type: card.type_en,
                  job: card.job_en,
                  text: card.text_en,
                  rarity: card.rarity,
                  cost: card.cost,
                  power: card.power,
                  category_1: card.category_1,
                  category_2: card.category_2,
                  multicard: card.multicard === "1",
                  ex_burst: card.ex_burst === "1",
                  set: card.set,
                },
              });

              // If hash changed, verify stored hash and check what changed
              if (currentHash !== storedHash) {
                const hashDoc = await this.retry.execute(() =>
                  db.collection(COLLECTION.SQUARE_ENIX_HASHES).doc(sanitizedCode).get()
                );
                const existingDoc = docSnapshot.exists ? docSnapshot.data() : null;
                logger.info(`Hash verification for ${card.code}`, {
                  inMap: storedHash,
                  inFirestore: hashDoc.exists ? hashDoc.data()?.hash : "not_found",
                  lastUpdated: hashDoc.exists ? hashDoc.data()?.lastUpdated : null,
                  existingFields: {
                    productId: existingDoc?.productId,
                    groupId: existingDoc?.groupId,
                    lastUpdated: existingDoc?.lastUpdated,
                  },
                });

                if (frequentChanges.has(sanitizedCode)) {
                  logger.warn(`Card ${card.code} changes frequently`, {
                    currentHash,
                    storedHash,
                    element: card.element || [],
                  });
                } else {
                  frequentChanges.add(sanitizedCode);
                }
              }
            }

            // Log hash details
            logger.info(`Hash check for ${card.code}`, {
              currentHash,
              storedHash: storedHash || "none",
              docExists: docSnapshot.exists,
              forceUpdate: options.forceUpdate,
            });

            // Skip if document exists AND hash exists AND hash matches (unless forcing update)
            if (docSnapshot.exists && storedHash && currentHash === storedHash && !options.forceUpdate) {
              return;
            }

            // Log why we're updating
            logger.info(`Updating card ${card.code} because:`, {
              reason: !docSnapshot.exists
                ? "doc missing"
                : !storedHash
                ? "hash missing"
                : currentHash !== storedHash
                ? "hash mismatch"
                : "force update",
            });

            // Create card document with only Square Enix fields
            const cardDoc = {
              id: parseInt(card.id) || 0,
              code: card.code || "",
              name: card.name_en || "",
              type: card.type_en || "",
              job: card.job_en || "",
              text: card.text_en || "",
              element: card.element || [], // Elements already processed by squareEnixSync
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

            // Log document state before update
            logger.info(`Document state before update for ${card.code}`, {
              before: docSnapshot.exists ? docSnapshot.data() : null,
            });

            // Update card and hash in a single batch
            await this.batchProcessor.addOperation((batch) => {
              // Use merge to preserve existing fields like productId and groupId
              batch.set(docRef, cardDoc, { merge: true });

              // Log what we're setting
              logger.info(`Setting document for ${card.code}`, {
                cardDoc,
                merge: true,
              });
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

      // Log summary of frequently changing cards
      if (frequentChanges.size > 0) {
        logger.warn(`Found ${frequentChanges.size} frequently changing cards`, {
          cards: Array.from(frequentChanges),
        });
      }

      logger.info(`Processed ${cards.length} cards`, {
        totalProcessed: result.processed,
        totalUpdated: result.updated,
        errors: result.errors.length,
        frequentChanges: frequentChanges.size,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Batch processing error: ${errorMessage}`);
      logger.error("Batch processing error", { error: errorMessage });
    }

    return result;
  }

  async syncSquareEnixCards(options: { forceUpdate?: boolean } = {}): Promise<SyncResult> {
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
      const cards = await this.retry.execute(() => squareEnixSync.fetchAllCards());
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

        logger.info(`Processed batch of ${cardChunk.length} cards`, {
          totalProcessed: result.itemsProcessed,
          totalUpdated: result.itemsUpdated,
          errors: result.errors.length,
        });
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
