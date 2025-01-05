// src/services/priceSync.ts
import { db, COLLECTION } from "../config/firebase";
import { tcgcsvApi } from "../utils/api";
import { CardPrice, SyncResult, SyncOptions } from "../types";
import { logger } from "../utils/logger";
import { RateLimiter } from "../utils/rateLimiter";
import { Cache } from "../utils/cache";
import { RetryWithBackoff } from "../utils/retry";
import * as crypto from "crypto";
import { FieldValue, WriteResult } from "firebase-admin/firestore";

export class PriceSyncService {
  private readonly BATCH_SIZE = 1000;
  private readonly MAX_PARALLEL_BATCHES = 5;
  private readonly MAX_BATCH_OPERATIONS = 450;

  private readonly rateLimiter = new RateLimiter();
  private readonly cache = new Cache<string>(15);
  private readonly retry = new RetryWithBackoff();

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
      db.collection(COLLECTION.PRICE_HASHES)
        .doc(productId.toString())
        .get()
    );

    const hash = doc.exists ? doc.data()?.hash : null;
    if (hash) this.cache.set(cacheKey, hash);

    return hash;
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

    let batch = db.batch();
    let batchCount = 0;
    const batchPromises: Promise<WriteResult[]>[] = []; // Updated type here

    // Pre-fetch all hashes at once
    const productIds = prices.map((price) => price.productId);
    const hashPromises = productIds.map((id) => this.getStoredHash(id));
    const storedHashes = await Promise.all(hashPromises);
    const hashMap = new Map(productIds.map((id, index) => [id, storedHashes[index]]));

    // Prepare historical prices in bulk
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let historicalBatch = db.batch();
    let historicalCount = 0;

    for (const price of prices) {
      try {
        result.processed++;

        if (!this.validatePrice(price)) continue;

        const currentHash = this.calculateHash(price);
        const storedHash = hashMap.get(price.productId);

        if (currentHash === storedHash && !options.forceUpdate) continue;

        // Main price document
        const priceDoc = {
          productId: price.productId,
          lastUpdated: FieldValue.serverTimestamp(),
          groupId: parseInt(groupId),
          ...(price.normal && { normal: price.normal }),
          ...(price.foil && { foil: price.foil }),
        };

        // Add to main batch
        const priceRef = db.collection(COLLECTION.PRICES)
          .doc(price.productId.toString());
        batch.set(priceRef, priceDoc, { merge: true });
        batchCount++;

        // Add to historical batch
        const docId = `${price.productId}_${today.toISOString().split("T")[0]}`;
        const historicalRef = db.collection(COLLECTION.HISTORICAL_PRICES).doc(docId);
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
        historicalBatch.set(historicalRef, historicalPrice, { merge: true });
        historicalCount++;

        // Update hash in same batch
        const hashRef = db.collection(COLLECTION.PRICE_HASHES)
          .doc(price.productId.toString());
        batch.set(hashRef, {
          hash: currentHash,
          lastUpdated: FieldValue.serverTimestamp(),
        }, { merge: true });
        batchCount++;

        // Commit batch if reaching limit
        if (batchCount >= this.MAX_BATCH_OPERATIONS) {
          batchPromises.push(
            this.rateLimiter.add(async () => this.retry.execute(() => batch.commit())) // Added async
          );
          batch = db.batch();
          batchCount = 0;
        }

        // Commit historical batch if reaching limit
        if (historicalCount >= this.MAX_BATCH_OPERATIONS) {
          batchPromises.push(
            this.rateLimiter.add(async () => this.retry.execute(() => historicalBatch.commit())) // Added async
          );
          historicalBatch = db.batch();
          historicalCount = 0;
        }

        result.updated++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        result.errors.push(`Error processing price for product ${price.productId}: ${errorMessage}`);
      }
    }

    // Commit any remaining batches
    if (batchCount > 0) {
      batchPromises.push(
        this.rateLimiter.add(async () => this.retry.execute(() => batch.commit())) // Added async
      );
    }

    if (historicalCount > 0) {
      batchPromises.push(
        this.rateLimiter.add(async () => this.retry.execute(() => historicalBatch.commit())) // Added async
      );
    }

    // Wait for all batch commits to complete
    await Promise.all(batchPromises);

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

          // Add delay between groups
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
