// src/services/cardSync.ts
import { db } from "../config/firebase";
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
  private readonly BATCH_SIZE = 1000;
  private readonly MAX_PARALLEL_BATCHES = 5;
  private readonly MAX_BATCH_OPERATIONS = 450; // Buffer below Firestore's 500 limit
  private readonly SHARD_COUNT = 10;

  private readonly rateLimiter = new RateLimiter();
  private readonly cache = new Cache<string>(15); // 15 minute TTL
  private readonly retry = new RetryWithBackoff();

  private getCollectionRef(collectionName: string, productId: number) {
    const shardId = productId % this.SHARD_COUNT;
    return db.collection(`${collectionName}_${shardId}`);
  }

  private calculateHash(data: CardHashData): string {
    return crypto
      .createHash("md5")
      .update(JSON.stringify(data))
      .digest("hex");
  }

  private async getStoredHash(productId: number): Promise<string | null> {
    const cacheKey = `hash_${productId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const doc = await this.retry.execute(() =>
      this.getCollectionRef("cardHashes", productId)
        .doc(productId.toString())
        .get()
    );

    const hash = doc.exists ? doc.data()?.hash : null;
    if (hash) this.cache.set(cacheKey, hash);

    return hash;
  }

  private async updateStoredHash(productId: number, hash: string): Promise<void> {
    await this.retry.execute(() =>
      this.getCollectionRef("cardHashes", productId)
        .doc(productId.toString())
        .set({
          hash,
          lastUpdated: FieldValue.serverTimestamp(),
        }, { merge: true })
    );
    this.cache.set(`hash_${productId}`, hash);
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

  private async saveDeltaUpdate(card: CardProduct, changes: CardChanges): Promise<void> {
    await this.rateLimiter.add(async () => {
      await this.getCollectionRef("cardDeltas", card.productId)
        .add({
          productId: card.productId,
          changes,
          timestamp: FieldValue.serverTimestamp(),
        });
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

    const writeQueue: Array<() => Promise<void>> = [];
    const batch = db.batch();
    let batchCount = 0;

    const commitBatch = async () => {
      if (batchCount >= this.MAX_BATCH_OPERATIONS) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (batchCount > 0) {
        await this.rateLimiter.add(async () => {
          await this.retry.execute(() => batch.commit());
        });
        batchCount = 0;
      }
    };

    // Pre-fetch hashes in bulk
    const productIds = cards.map((card) => card.productId);
    const hashPromises = productIds.map((id) => this.getStoredHash(id));
    const storedHashes = await Promise.all(hashPromises);
    const hashMap = new Map(productIds.map((id, index) => [id, storedHashes[index]]));

    for (const card of cards) {
      try {
        result.processed++;

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

        const imagePromise = this.retry.execute(() =>
          storageService.processAndStoreImage(
            card.imageUrl,
            card.productId,
            groupId,
            primaryCardNumber
          )
        );

        writeQueue.push(async () => {
          const imageResult = await imagePromise;
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

          const cardRef = this.getCollectionRef("cards", card.productId)
            .doc(card.productId.toString());

          batch.set(cardRef, cardDoc, { merge: true });

          // Store extended data in subcollection
          const extendedDataRef = cardRef.collection("extendedData");
          card.extendedData.forEach((data) => {
            batch.set(extendedDataRef.doc(data.name), data);
          });

          // Store image metadata in subcollection
          batch.set(
            cardRef.collection("metadata").doc("image"),
            imageResult.metadata
          );

          batchCount++;

          if (batchCount >= this.MAX_BATCH_OPERATIONS) {
            await commitBatch();
          }

          await this.updateStoredHash(card.productId, currentHash);
          await this.saveDeltaUpdate(card, cardDoc);

          result.updated++;
          logger.info(
            `Updated card ${card.productId}: ${card.name} with numbers: ${cardNumbers.join(", ")}`
          );
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        result.errors.push(`Error processing card ${card.productId}: ${errorMessage}`);
        logger.error(`Error processing card ${card.productId}`, { error: errorMessage });
      }
    }

    // Process queued writes with controlled concurrency
    const chunks = [];
    for (let i = 0; i < writeQueue.length; i += this.MAX_PARALLEL_BATCHES) {
      chunks.push(writeQueue.slice(i, i + this.MAX_PARALLEL_BATCHES));
    }

    for (const chunk of chunks) {
      await Promise.all(chunk.map((write) => write()));
      await commitBatch();
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
    const batches = [];
    for (let i = 0; i < cards.length; i += this.BATCH_SIZE) {
      batches.push(cards.slice(i, i + this.BATCH_SIZE));
    }

    const results = [];
    for (let i = 0; i < batches.length; i += this.MAX_PARALLEL_BATCHES) {
      const batchPromises = batches
        .slice(i, i + this.MAX_PARALLEL_BATCHES)
        .map((batch) => this.processCardBatch(batch, groupId, options));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Add delay between large batch processing to prevent rate limiting
      if (i + this.MAX_PARALLEL_BATCHES < batches.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

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

      const groups = options.groupId ?
        [{ groupId: options.groupId }] :
        await tcgcsvApi.getGroups();

      logger.info(`Found ${groups.length} groups to process`);

      for (const group of groups) {
        result.timing.groupStartTime = new Date();
        try {
          const cards = await tcgcsvApi.getGroupProducts(group.groupId);

          // Process cards in optimized batches
          const batchResults = await this.processCardBatches(
            cards,
            group.groupId,
            options
          );

          result.itemsProcessed += batchResults.processed;
          result.itemsUpdated += batchResults.updated;
          result.errors.push(...batchResults.errors);

          // Add delay between groups to prevent rate limiting
          if (groups.length > 1) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          result.errors.push(
            `Error processing group ${group.groupId}: ${errorMessage}`
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

    result.timing.endTime = new Date();
    result.timing.duration =
      (result.timing.endTime.getTime() - result.timing.startTime.getTime()) / 1000;

    logger.logSyncStats({
      startTime: result.timing.startTime,
      endTime: result.timing.endTime,
      totalItems: result.itemsProcessed,
      successCount: result.itemsUpdated,
      errorCount: result.errors.length,
      duration: result.timing.duration,
    });

    return result;
  }
}

export const cardSync = new CardSyncService();
