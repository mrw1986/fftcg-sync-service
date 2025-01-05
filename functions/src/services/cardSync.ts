// src/services/cardSync.ts
import { db, COLLECTION } from "../config/firebase";
import { tcgcsvApi } from "../utils/api";
import { storageService } from "./storageService";
import { CardProduct, SyncResult, CardHashData, SyncOptions, CardChanges } from "../types";
import { logger } from "../utils/logger";
import { RateLimiter } from "../utils/rateLimiter";
import { Cache } from "../utils/cache";
import { RetryWithBackoff } from "../utils/retry";
import * as crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";

export class CardSyncService {
  private readonly BATCH_SIZE = 500; // Optimized batch size
  private readonly MAX_PARALLEL_BATCHES = 3; // Reduced for better control
  private readonly MAX_BATCH_OPERATIONS = 499; // Just under Firestore's limit
  private readonly IMAGE_CONCURRENCY = 5; // Control parallel image processing

  private readonly rateLimiter = new RateLimiter();
  private readonly cache = new Cache<string>(15);
  private readonly retry = new RetryWithBackoff();

  private calculateHash(data: CardHashData): string {
    return crypto
      .createHash("md5")
      .update(JSON.stringify(data))
      .digest("hex");
  }

  private async getStoredHashes(productIds: number[]): Promise<Map<number, string>> {
    const hashMap = new Map<number, string>();
    const uncachedIds: number[] = [];

    // Check cache first
    productIds.forEach(id => {
      const cacheKey = `hash_${id}`;
      const cached = this.cache.get(cacheKey);
      if (cached) {
        hashMap.set(id, cached);
      } else {
        uncachedIds.push(id);
      }
    });

    if (uncachedIds.length === 0) {
      return hashMap;
    }

    // Batch get uncached hashes
    const chunks = [];
    for (let i = 0; i < uncachedIds.length; i += 10) {
      chunks.push(uncachedIds.slice(i, i + 10));
    }

    await Promise.all(chunks.map(async chunk => {
      const refs = chunk.map(id => 
        db.collection(COLLECTION.CARD_HASHES).doc(id.toString())
      );
      
      const snapshots = await this.retry.execute(() => 
        db.getAll(...refs)
      );

      snapshots.forEach((snap, index) => {
        const id = chunk[index];
        const hash = snap.exists ? snap.data()?.hash : null;
        if (hash) {
          hashMap.set(id, hash);
          this.cache.set(`hash_${id}`, hash);
        }
      });
    }));

    return hashMap;
  }

  private async updateStoredHash(productId: number, hash: string): Promise<void> {
    this.cache.set(`hash_${productId}`, hash);
    // Actual DB update will be handled in batch operations
  }

  private getCardNumbers(card: CardProduct): string[] {
    const numbers: string[] = [];
    card.extendedData
      .filter((data) => data.name === "Number")
      .forEach((numberField) => {
        const vals = numberField.value.split(/[,;/]/).map((n) => n.trim());
        numbers.push(...vals);
      });

    if (numbers.length === 0) {
      numbers.push(`P${card.productId}`);
    }

    return [...new Set(numbers)];
  }

  private isNonCardProduct(card: CardProduct): boolean {
    const cardType = card.extendedData.find((data) => data.name === "CardType")?.value;
    return !cardType || cardType.toLowerCase() === "sealed product";
  }

  private async saveDeltaUpdate(
    batch: FirebaseFirestore.WriteBatch,
    card: CardProduct, 
    changes: CardChanges
  ): Promise<void> {
    const deltaRef = db.collection(COLLECTION.CARD_DELTAS).doc();
    batch.set(deltaRef, {
      productId: card.productId,
      changes,
      timestamp: FieldValue.serverTimestamp(),
    });
  }

  private async processCardBatch(
    cards: CardProduct[],
    groupId: string,
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
      // Pre-fetch all hashes in one go
      const productIds = cards.map(card => card.productId);
      const hashMap = await this.getStoredHashes(productIds);

      // Prepare batches
      let mainBatch = db.batch();
      let batchCount = 0;
      const batchPromises: Promise<void>[] = [];

      // Process images in controlled parallel chunks
      const imageProcessingChunks: Array<Promise<{
        card: CardProduct;
        imageResult: Awaited<ReturnType<typeof storageService.processAndStoreImage>>;
      }>> = [];

      // Process images with controlled concurrency
      for (let i = 0; i < cards.length; i += this.IMAGE_CONCURRENCY) {
        const chunk = cards.slice(i, i + this.IMAGE_CONCURRENCY);
        const chunkPromises = chunk.map(async card => {
          try {
            const cardNumbers = this.getCardNumbers(card);
            const primaryCardNumber = cardNumbers[0];
            
            const imageResult = await this.retry.execute(() =>
              storageService.processAndStoreImage(
                card.imageUrl,
                card.productId,
                groupId,
                primaryCardNumber
              )
            );

            return { card, imageResult };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            result.errors.push(`Image processing failed for card ${card.productId}: ${errorMessage}`);
            throw error;
          }
        });

        imageProcessingChunks.push(...chunkPromises);

        // Add delay between image processing chunks
        if (i + this.IMAGE_CONCURRENCY < cards.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Wait for current chunk of image processing to complete
      const processedImages = await Promise.allSettled(imageProcessingChunks);

      // Process successful image results and create Firestore operations
      for (const imagePromiseResult of processedImages) {
        if (imagePromiseResult.status === "rejected") {
          continue;
        }

        const { card, imageResult } = imagePromiseResult.value;
        result.processed++;

        try {
          const relevantData: CardHashData = {
            name: card.name,
            cleanName: card.cleanName,
            modifiedOn: card.modifiedOn,
            extendedData: card.extendedData,
          };

          const currentHash = this.calculateHash(relevantData);
          const storedHash = hashMap.get(card.productId);

          if (currentHash === storedHash && !options.forceUpdate) {
            logger.info(`Skipping card ${card.productId} - no changes`);
            continue;
          }

          const cardNumbers = this.getCardNumbers(card);
          const primaryCardNumber = cardNumbers[0];

          const cardDoc = {
            productId: card.productId,
            name: card.name,
            cleanName: card.cleanName,
            highResUrl: imageResult.highResUrl,
            lowResUrl: imageResult.lowResUrl,
            lastUpdated: FieldValue.serverTimestamp(),
            groupId: parseInt(groupId),
            isNonCard: this.isNonCardProduct(card),
            cardNumbers,
            primaryCardNumber,
          };

          // Main card document
          const cardRef = db.collection(COLLECTION.CARDS)
            .doc(card.productId.toString());
          mainBatch.set(cardRef, cardDoc, { merge: true });
          batchCount++;

          // Extended data subcollection
          const extendedDataRef = cardRef.collection("extendedData");
          card.extendedData.forEach((data) => {
            mainBatch.set(extendedDataRef.doc(data.name), data);
            batchCount++;
          });

          // Image metadata
          mainBatch.set(
            cardRef.collection("metadata").doc("image"),
            imageResult.metadata
          );
          batchCount++;

          // Update hash
          const hashRef = db.collection(COLLECTION.CARD_HASHES)
            .doc(card.productId.toString());
          mainBatch.set(hashRef, {
            hash: currentHash,
            lastUpdated: FieldValue.serverTimestamp(),
          }, { merge: true });
          batchCount++;

          // Save delta update in same batch
          await this.saveDeltaUpdate(mainBatch, card, cardDoc);
          batchCount++;

          // Update cache
          await this.updateStoredHash(card.productId, currentHash);

          // Commit batch if reaching limit
          if (batchCount >= this.MAX_BATCH_OPERATIONS) {
            batchPromises.push(
              this.rateLimiter.add(() => 
                this.retry.execute(() => mainBatch.commit())
              ).then(() => void 0)
            );
            mainBatch = db.batch();
            batchCount = 0;
          }

          result.updated++;
          logger.info(
            `Updated card ${card.productId}: ${card.name} with numbers: ${cardNumbers.join(", ")}`
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          result.errors.push(`Error processing card ${card.productId}: ${errorMessage}`);
          logger.error(`Error processing card ${card.productId}`, { error: errorMessage });
        }
      }

      // Commit any remaining batch operations
      if (batchCount > 0) {
        batchPromises.push(
          this.rateLimiter.add(() => 
            this.retry.execute(() => mainBatch.commit())
          ).then(() => void 0)
        );
      }

      // Wait for all batch commits to complete
      await Promise.all(batchPromises);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Batch processing error: ${errorMessage}`);
      logger.error("Batch processing error", { error: errorMessage });
    }

    return result;
  }

  private async processCardBatches(
    cards: CardProduct[],
    groupId: string,
    options: { forceUpdate?: boolean } = {}
  ): Promise<{
    processed: number;
    updated: number;
    errors: string[];
  }> {
    // Split into optimally sized batches
    const batches: CardProduct[][] = [];
    for (let i = 0; i < cards.length; i += this.BATCH_SIZE) {
      batches.push(cards.slice(i, i + this.BATCH_SIZE));
    }

    const results = [];
    // Process batches with controlled parallelism
    for (let i = 0; i < batches.length; i += this.MAX_PARALLEL_BATCHES) {
      const currentBatches = batches.slice(i, i + this.MAX_PARALLEL_BATCHES);
      const batchPromises = currentBatches.map(batch =>
        this.processCardBatch(batch, groupId, options)
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Add delay between batch groups to prevent rate limiting
      if (i + this.MAX_PARALLEL_BATCHES < batches.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Combine results
    return results.reduce(
      (acc, curr) => ({
        processed: acc.processed + curr.processed,
        updated: acc.updated + curr.updated,
        errors: [...acc.errors, ...curr.errors],
      }),
      { processed: 0, updated: 0, errors: [] }
    );
  }

  async syncCards(options: SyncOptions = {}): Promise<SyncResult> {
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
      logger.info("Starting card sync", { options });

      // Get groups to process
      const groups = options.groupId
        ? [{ groupId: options.groupId }]
        : await tcgcsvApi.getGroups();

      logger.info(`Found ${groups.length} groups to process`);

      // Process each group sequentially to prevent overload
      for (const group of groups) {
        result.timing.groupStartTime = new Date();
        try {
          // Get cards for current group with retry
          const cards = await this.retry.execute(() =>
            tcgcsvApi.getGroupProducts(group.groupId)
          );

          logger.info(`Processing ${cards.length} cards for group ${group.groupId}`);

          // Process cards in optimized batches
          const batchResults = await this.processCardBatches(
            cards,
            group.groupId,
            options
          );

          // Update results
          result.itemsProcessed += batchResults.processed;
          result.itemsUpdated += batchResults.updated;
          result.errors.push(...batchResults.errors);

          // Calculate and log group timing
          const groupEndTime = new Date();
          const groupDuration = 
            (groupEndTime.getTime() - result.timing.groupStartTime!.getTime()) / 1000;

          logger.info(`Completed group ${group.groupId} in ${groupDuration}s`, {
            processed: batchResults.processed,
            updated: batchResults.updated,
            errors: batchResults.errors.length,
          });

          // Add delay between groups
          if (groups.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 3000));
          }

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          result.errors.push(
            `Error processing cards for group ${group.groupId}: ${errorMessage}`
          );
          logger.error(`Error processing group ${group.groupId}`, {
            error: errorMessage,
          });
        }
      }

    } catch (error) {
      result.success = false;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Card sync failed: ${errorMessage}`);
      logger.error("Card sync failed", { error: errorMessage });
    }

    // Calculate final timing
    result.timing.endTime = new Date();
    result.timing.duration =
      (result.timing.endTime.getTime() - result.timing.startTime.getTime()) / 1000;

    // Log final results
    logger.info(`Card sync completed in ${result.timing.duration}s`, {
      processed: result.itemsProcessed,
      updated: result.itemsUpdated,
      errors: result.errors.length,
      timing: result.timing,
    });

    return result;
  }
}

export const cardSync = new CardSyncService();