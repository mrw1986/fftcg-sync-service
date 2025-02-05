import { db, COLLECTION } from "../config/firebase";
import { squareEnixSync } from "./squareEnixSync";
import { SyncResult, SquareEnixCardDoc } from "../types";
import { logger } from "../utils/logger";
import { RetryWithBackoff } from "../utils/retry";
import { FieldValue } from "firebase-admin/firestore";
import { OptimizedBatchProcessor } from "./batchProcessor";
import { storageService } from "./storageService";
import { Cache } from "../utils/cache";

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
    return executionTime > (this.MAX_EXECUTION_TIME - safetyMarginSeconds);
  }

  private sanitizeDocumentId(code: string): string {
    // Replace forward slashes with semicolons to maintain uniqueness
    return code.replace(/\//g, ";");
  }

  private async processAndStoreImages(
    card: any,
    groupId: string
  ): Promise<{ fullResUrl: string | null; lowResUrl: string | null }> {
    try {
      // Process full resolution image
      const fullResResult = card.images?.full?.length > 0
        ? await this.retry.execute(() =>
            storageService.processAndStoreImage(
              card.images.full[0],
              card.id,
              groupId
            )
          )
        : null;

      // Process thumbnail image
      const thumbResult = card.images?.thumbs?.length > 0
        ? await this.retry.execute(() =>
            storageService.processAndStoreImage(
              card.images.thumbs[0],
              card.id,
              groupId
            )
          )
        : null;

      return {
        fullResUrl: fullResResult?.fullResUrl || null,
        lowResUrl: thumbResult?.lowResUrl || null,
      };
    } catch (error) {
      logger.error(`Failed to process images for card ${card.id}`, {
        error: error instanceof Error ? error.message : "Unknown error",
        cardCode: card.code,
      });
      return {
        fullResUrl: null,
        lowResUrl: null,
      };
    }
  }

  private async processCards(
    cards: any[],
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
      // Process all operations in parallel
      await Promise.all(cards.map(async (card) => {
        try {
          if (this.isApproachingTimeout(startTime)) {
            logger.warn("Approaching function timeout, skipping remaining cards");
            return;
          }

          result.processed++;

          // Check cache first
          const cacheKey = `hash_${card.code}`;
          const cachedCard = this.cache.get(cacheKey);
          if (cachedCard && !options.forceUpdate) {
            return;
          }

          // Process images and create document in parallel
          const [imageUrls] = await Promise.all([
            this.processAndStoreImages(card, "square-enix"),
            this.batchProcessor.addOperation((batch) => {
              const cardDoc: SquareEnixCardDoc = {
                id: card.id,
                code: card.code,
                name: card.name_en,
                type: card.type_en,
                job: card.job_en,
                text: card.text_en,
                element: card.element,
                rarity: card.rarity,
                cost: card.cost,
                power: card.power,
                category_1: card.category_1,
                category_2: card.category_2 || null,
                multicard: card.multicard === "1",
                ex_burst: card.ex_burst === "1",
                set: card.set,
                images: {
                  thumbs: card.images.thumbs,
                  full: card.images.full,
                },
                processedImages: {
                  fullResUrl: null, // Will be updated after image processing
                  lowResUrl: null,
                },
                lastUpdated: FieldValue.serverTimestamp(),
              };

              const docRef = db.collection(COLLECTION.SQUARE_ENIX_CARDS).doc(this.sanitizeDocumentId(card.code));
              batch.set(docRef, cardDoc, { merge: true });
            })
          ]);

          // Update image URLs if available
          if (imageUrls.fullResUrl || imageUrls.lowResUrl) {
            await this.batchProcessor.addOperation((batch) => {
              const docRef = db.collection(COLLECTION.SQUARE_ENIX_CARDS).doc(this.sanitizeDocumentId(card.code));
              batch.update(docRef, {
                "processedImages.fullResUrl": imageUrls.fullResUrl,
                "processedImages.lowResUrl": imageUrls.lowResUrl,
              });
            });
          }

          this.cache.set(cacheKey, card);
          result.updated++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          result.errors.push(`Error processing card ${card.code}: ${errorMessage}`);
          logger.error(`Error processing card ${card.code}`, { error: errorMessage });
        }
      }));

      // Commit all batched operations
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

  async syncSquareEnixCards(): Promise<SyncResult> {
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
      logger.info("Starting Square Enix card sync");

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
        const batchResults = await this.processCards(cardChunk, result.timing.startTime);

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
      result.timing.duration =
        (result.timing.endTime.getTime() - result.timing.startTime.getTime()) / 1000;

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
