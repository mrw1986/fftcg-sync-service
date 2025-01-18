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
  private readonly BATCH_SIZE = 500; // Optimized batch size
  private readonly MAX_PARALLEL_BATCHES = 3; // Reduced parallel operations
  private readonly MAX_BATCH_OPERATIONS = 499; // Just under Firestore's limit

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

  private async getStoredHashes(productIds: number[]): Promise<Map<number, string>> {
    const hashMap = new Map<number, string>();
    const uncachedIds: number[] = [];

    // Check cache first
    productIds.forEach((id) => {
      const cacheKey = `price_hash_${id}`;
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

    await Promise.all(chunks.map(async (chunk) => {
      const refs = chunk.map((id) =>
        db.collection(COLLECTION.PRICE_HASHES).doc(id.toString())
      );

      const snapshots = await this.retry.execute(() =>
        db.getAll(...refs)
      );

      snapshots.forEach((snap, index) => {
        const id = chunk[index];
        const hash = snap.exists ? snap.data()?.hash : null;
        if (hash) {
          hashMap.set(id, hash);
          this.cache.set(`price_hash_${id}`, hash);
        }
      });
    }));

    return hashMap;
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

    try {
      // Pre-fetch all hashes in one go
      const productIds = prices.map((price) => price.productId);
      const hashMap = await this.getStoredHashes(productIds);

      // Prepare batches
      let mainBatch = db.batch();
      let historicalBatch = db.batch();
      let mainOps = 0;
      let historicalOps = 0;
      const batchPromises: Promise<WriteResult[]>[] = [];

      // Prepare date once
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const price of prices) {
        try {
          result.processed++;

          if (!this.validatePrice(price)) continue;

          const currentHash = this.calculateHash(price);
          const storedHash = hashMap.get(price.productId);

          if (currentHash === storedHash && !options.forceUpdate) {
            continue;
          }

          // Prepare documents
          const priceDoc = {
            productId: price.productId,
            lastUpdated: FieldValue.serverTimestamp(),
            groupId: parseInt(groupId),
            ...(price.normal && { normal: price.normal }),
            ...(price.foil && { foil: price.foil }),
          };

          const historicalDoc = {
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

          // Add to main batch
          const priceRef = db.collection(COLLECTION.PRICES).doc(price.productId.toString());
          mainBatch.set(priceRef, priceDoc, { merge: true });
          mainOps++;

          // Add hash update to same batch
          const hashRef = db.collection(COLLECTION.PRICE_HASHES).doc(price.productId.toString());
          mainBatch.set(hashRef, {
            hash: currentHash,
            lastUpdated: FieldValue.serverTimestamp(),
          }, { merge: true });
          mainOps++;

          // Add to historical batch
          const docId = `${price.productId}_${today.toISOString().split("T")[0]}`;
          const historicalRef = db.collection(COLLECTION.HISTORICAL_PRICES).doc(docId);
          historicalBatch.set(historicalRef, historicalDoc, { merge: true });
          historicalOps++;

          // Commit batches if reaching limits
          if (mainOps >= this.MAX_BATCH_OPERATIONS) {
            batchPromises.push(
              this.rateLimiter.add(() => this.retry.execute(() => mainBatch.commit()))
            );
            mainBatch = db.batch();
            mainOps = 0;
          }

          if (historicalOps >= this.MAX_BATCH_OPERATIONS) {
            batchPromises.push(
              this.rateLimiter.add(() => this.retry.execute(() => historicalBatch.commit()))
            );
            historicalBatch = db.batch();
            historicalOps = 0;
          }

          result.updated++;

          // Update cache
          this.cache.set(`price_hash_${price.productId}`, currentHash);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          result.errors.push(`Error processing price for product ${price.productId}: ${errorMessage}`);
        }
      }

      // Commit remaining batches
      if (mainOps > 0) {
        batchPromises.push(
          this.rateLimiter.add(() => this.retry.execute(() => mainBatch.commit()))
        );
      }

      if (historicalOps > 0) {
        batchPromises.push(
          this.rateLimiter.add(() => this.retry.execute(() => historicalBatch.commit()))
        );
      }

      // Wait for all batches to complete
      await Promise.all(batchPromises);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Batch processing error: ${errorMessage}`);
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
    // Split into optimally sized batches
    const batches: CardPrice[][] = [];
    for (let i = 0; i < prices.length; i += this.BATCH_SIZE) {
      batches.push(prices.slice(i, i + this.BATCH_SIZE));
    }

    const results = [];
    // Process batches with controlled parallelism
    for (let i = 0; i < batches.length; i += this.MAX_PARALLEL_BATCHES) {
      const currentBatches = batches.slice(i, i + this.MAX_PARALLEL_BATCHES);
      const batchPromises = currentBatches.map((batch) =>
        this.processPriceBatch(batch, groupId, options)
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Add delay between batch groups to prevent rate limiting
      if (i + this.MAX_PARALLEL_BATCHES < batches.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
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

      // Get groups to process
      const groups = options.groupId ?
        [{ groupId: options.groupId }] :
        await tcgcsvApi.getGroups();

      logger.info(`Found ${groups.length} groups to process`);

      // Process each group sequentially to prevent overload
      for (const group of groups) {
        result.timing.groupStartTime = new Date();
        try {
          // Get prices for current group
          const prices = await tcgcsvApi.getGroupPrices(group.groupId);
          logger.info(`Processing ${prices.length} prices for group ${group.groupId}`);

          // Process prices in optimized batches
          const batchResults = await this.processPriceBatches(
            prices,
            group.groupId,
            options
          );

          // Update results
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

    // Calculate final timing
    result.timing.endTime = new Date();
    result.timing.duration =
      (result.timing.endTime.getTime() - result.timing.startTime.getTime()) / 1000;

    // Log final results
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
