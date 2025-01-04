// src/services/priceSync.ts
import { db } from "../config/firebase";
import { tcgcsvApi } from "../utils/api";
import { CardPrice, SyncResult, SyncOptions, PriceChanges } from "../types";
import { logger } from "../utils/logger";
import { RateLimiter } from "../utils/rateLimiter";
import { Cache } from "../utils/cache";
import { RetryWithBackoff } from "../utils/retry";
import * as crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";

export class PriceSyncService {
  private readonly BATCH_SIZE = 1000;
  private readonly MAX_PARALLEL_BATCHES = 5;
  private readonly MAX_BATCH_OPERATIONS = 450;
  private readonly SHARD_COUNT = 10;

  private readonly rateLimiter = new RateLimiter();
  private readonly cache = new Cache<string>(15);
  private readonly retry = new RetryWithBackoff();

  private getCollectionRef(collectionName: string, productId: number) {
    const shardId = productId % this.SHARD_COUNT;
    return db.collection(`${collectionName}_${shardId}`);
  }

  private calculateHash(price: CardPrice): string {
    const relevantData = {
      normal: price.normal,
      foil: price.foil,
      lastUpdated: price.lastUpdated,
    };
    return crypto.createHash("md5").update(JSON.stringify(relevantData)).digest("hex");
  }

  private async getStoredHash(productId: number): Promise<string | null> {
    const cacheKey = `price_hash_${productId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const doc = await this.retry.execute(() =>
      this.getCollectionRef("priceHashes", productId)
        .doc(productId.toString())
        .get()
    );

    const hash = doc.exists ? doc.data()?.hash : null;
    if (hash) this.cache.set(cacheKey, hash);

    return hash;
  }

  private async updateStoredHash(productId: number, hash: string): Promise<void> {
    await this.retry.execute(() =>
      this.getCollectionRef("priceHashes", productId)
        .doc(productId.toString())
        .set({
          hash,
          lastUpdated: FieldValue.serverTimestamp(),
        }, { merge: true })
    );
    this.cache.set(`price_hash_${productId}`, hash);
  }

  private validatePrice(price: CardPrice): boolean {
    const validatePriceData = (data: typeof price.normal | typeof price.foil) => {
      if (!data) return false;
      return (
        typeof data.marketPrice === "number" &&
        data.marketPrice >= 0 &&
        typeof data.lowPrice === "number" &&
        data.lowPrice >= 0 &&
        typeof data.highPrice === "number" &&
        data.highPrice >= 0
      );
    };

    return validatePriceData(price.normal) || validatePriceData(price.foil);
  }

  private async saveDeltaUpdate(price: CardPrice, changes: PriceChanges): Promise<void> {
    await this.rateLimiter.add(async () => {
      await this.getCollectionRef("priceDeltas", price.productId)
        .add({
          productId: price.productId,
          changes,
          timestamp: FieldValue.serverTimestamp(),
        });
    });
  }

  private async saveHistoricalPrice(price: CardPrice, groupId: string): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const docId = `${price.productId}_${today.toISOString().split("T")[0]}`;

    // Check cache first
    const cacheKey = `historical_${docId}`;
    if (this.cache.get(cacheKey)) {
      return;
    }

    const historicalRef = this.getCollectionRef("historicalPrices", price.productId)
      .doc(docId);

    const doc = await historicalRef.get();
    if (doc.exists) {
      this.cache.set(cacheKey, "exists");
      return;
    }

    const historicalPrice = {
      productId: price.productId,
      groupId,
      date: today,
      timestamp: FieldValue.serverTimestamp(),
      ...(price.normal && {
        normal: {
          directLow: price.normal.directLowPrice,
          high: price.normal.highPrice,
          low: price.normal.lowPrice,
          market: price.normal.marketPrice,
          mid: price.normal.midPrice,
        },
      }),
      ...(price.foil && {
        foil: {
          directLow: price.foil.directLowPrice,
          high: price.foil.highPrice,
          low: price.foil.lowPrice,
          market: price.foil.marketPrice,
          mid: price.foil.midPrice,
        },
      }),
    };

    await this.rateLimiter.add(async () => {
      await this.retry.execute(() => historicalRef.set(historicalPrice));
    });

    this.cache.set(cacheKey, "exists");
  }

  private async processPriceBatch(
    prices: CardPrice[],
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
    const productIds = prices.map((price) => price.productId);
    const hashPromises = productIds.map((id) => this.getStoredHash(id));
    const storedHashes = await Promise.all(hashPromises);
    const hashMap = new Map(productIds.map((id, index) => [id, storedHashes[index]]));

    for (const price of prices) {
      try {
        result.processed++;

        if (!this.validatePrice(price)) {
          logger.info(`Skipping price for product ${price.productId} - invalid data`);
          continue;
        }

        const currentHash = this.calculateHash(price);
        const storedHash = hashMap.get(price.productId);

        if (currentHash === storedHash && !options.forceUpdate) {
          logger.info(`Skipping price update for ${price.productId} - no changes`);
          continue;
        }

        writeQueue.push(async () => {
          const priceDoc = {
            productId: price.productId,
            lastUpdated: FieldValue.serverTimestamp(),
            groupId: parseInt(groupId),
            ...(price.normal && { normal: price.normal }),
            ...(price.foil && { foil: price.foil }),
          };

          const priceRef = this.getCollectionRef("prices", price.productId)
            .doc(price.productId.toString());

          batch.set(priceRef, priceDoc, { merge: true });
          batchCount++;

          if (batchCount >= this.MAX_BATCH_OPERATIONS) {
            await commitBatch();
          }

          await Promise.all([
            this.updateStoredHash(price.productId, currentHash),
            this.saveHistoricalPrice(price, groupId),
            this.saveDeltaUpdate(price, priceDoc),
          ]);

          result.updated++;
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        result.errors.push(`Error processing price for product ${price.productId}: ${errorMessage}`);
        logger.error(`Error processing price for product ${price.productId}`, { error: errorMessage });
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

  private async processPriceBatches(
    prices: CardPrice[],
    groupId: string,
    options: { forceUpdate?: boolean } = {}
  ): Promise<{
    processed: number;
    updated: number;
    errors: string[];
  }> {
    const batches = [];
    for (let i = 0; i < prices.length; i += this.BATCH_SIZE) {
      batches.push(prices.slice(i, i + this.BATCH_SIZE));
    }

    const results = [];
    for (let i = 0; i < batches.length; i += this.MAX_PARALLEL_BATCHES) {
      const batchPromises = batches
        .slice(i, i + this.MAX_PARALLEL_BATCHES)
        .map((batch) => this.processPriceBatch(batch, groupId, options));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Add delay between large batch processing
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

  async syncPrices(options: SyncOptions = {}): Promise<SyncResult> {
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
      logger.info("Starting price sync", { options });

      const groups = options.groupId ?
        [{ groupId: options.groupId }] :
        await tcgcsvApi.getGroups();

      logger.info(`Found ${groups.length} groups to process`);

      for (const group of groups) {
        result.timing.groupStartTime = new Date();
        try {
          const prices = await tcgcsvApi.getGroupPrices(group.groupId);

          const batchResults = await this.processPriceBatches(
            prices,
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
            `Error processing prices for group ${group.groupId}: ${errorMessage}`
          );
          logger.error(`Error processing prices for group ${group.groupId}`, {
            error: errorMessage,
          });
        }
      }
    } catch (error) {
      result.success = false;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Price sync failed: ${errorMessage}`);
      logger.error("Price sync failed", { error: errorMessage });
    }

    result.timing.endTime = new Date();
    result.timing.duration =
      (result.timing.endTime.getTime() - result.timing.startTime.getTime()) / 1000;

    logger.info(`Price sync completed in ${result.timing.duration}s`, {
      processed: result.itemsProcessed,
      updated: result.itemsUpdated,
      errors: result.errors.length,
      timing: result.timing,
    });

    return result;
  }
}

export const priceSync = new PriceSyncService();
