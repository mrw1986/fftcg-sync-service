import { db, COLLECTION } from "../config/firebase";
import { squareEnixSync } from "./squareEnixSync";
import { SyncResult } from "../types";
import { logger } from "../utils/logger";
import { RetryWithBackoff } from "../utils/retry";
import { FieldValue } from "firebase-admin/firestore";
import { OptimizedBatchProcessor } from "./batchProcessor";

export class SquareEnixStorageService {
  private readonly CHUNK_SIZE = 500;
  private readonly retry = new RetryWithBackoff();
  private readonly batchProcessor: OptimizedBatchProcessor;

  constructor() {
    this.batchProcessor = new OptimizedBatchProcessor(db);
  }

  private async processCards(cards: any[]): Promise<{
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
      // Process each card in the batch
      for (const card of cards) {
        try {
          result.processed++;

          // Store raw card data with auto-generated ID
          await this.batchProcessor.addOperation((batch) => {
            // Let Firestore auto-generate the document ID
            const docRef = db.collection(COLLECTION.SQUARE_ENIX_CARDS).doc();
            batch.set(docRef, {
              ...card,
              lastUpdated: FieldValue.serverTimestamp(),
            });
          });

          result.updated++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          result.errors.push(`Error processing card: ${errorMessage}`);
          logger.error("Error processing card", { error: errorMessage });
        }
      }

      // Commit the batch
      await this.batchProcessor.commitAll();
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
        const cardChunk = cards.slice(i, i + this.CHUNK_SIZE);
        const batchResults = await this.processCards(cardChunk);

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
