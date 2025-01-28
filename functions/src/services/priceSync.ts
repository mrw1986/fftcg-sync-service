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
  private readonly BATCH_SIZE = 500;
  private readonly MAX_PARALLEL_BATCHES = 3;
  private readonly MAX_BATCH_OPERATIONS = 499;

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

  private normalizePriceValue(value: number | null): number | null {
  if (value === null || value === undefined) return null;
  // Convert to float and fix to 2 decimal places
  return Number(parseFloat(value.toString()).toFixed(2));
}

  private validatePriceData(data: {
    directLowPrice: number | null;
    highPrice: number;
    lowPrice: number;
    marketPrice: number;
    midPrice: number;
  } | null | undefined): boolean {
    if (!data) return false;
    return (
      typeof this.normalizePriceValue(data.marketPrice) === "number" &&
      typeof this.normalizePriceValue(data.lowPrice) === "number" &&
      typeof this.normalizePriceValue(data.highPrice) === "number" &&
      typeof this.normalizePriceValue(data.midPrice) === "number" &&
      (data.directLowPrice === null || typeof this.normalizePriceValue(data.directLowPrice) === "number")
    );
  }

  private validatePrice(price: CardPrice): boolean {
    return this.validatePriceData(price.normal) || this.validatePriceData(price.foil);
  }

  private normalizePrice(price: CardPrice): CardPrice {
    const normalized: CardPrice = {
      productId: price.productId,
      lastUpdated: price.lastUpdated,
    };

    if (price.normal) {
      normalized.normal = {
        directLowPrice: this.normalizePriceValue(price.normal.directLowPrice),
        highPrice: this.normalizePriceValue(price.normal.highPrice) || 0,
        lowPrice: this.normalizePriceValue(price.normal.lowPrice) || 0,
        marketPrice: this.normalizePriceValue(price.normal.marketPrice) || 0,
        midPrice: this.normalizePriceValue(price.normal.midPrice) || 0,
        subTypeName: "Normal",
      };
    }

    if (price.foil) {
      normalized.foil = {
        directLowPrice: this.normalizePriceValue(price.foil.directLowPrice),
        highPrice: this.normalizePriceValue(price.foil.highPrice) || 0,
        lowPrice: this.normalizePriceValue(price.foil.lowPrice) || 0,
        marketPrice: this.normalizePriceValue(price.foil.marketPrice) || 0,
        midPrice: this.normalizePriceValue(price.foil.midPrice) || 0,
        subTypeName: "Foil",
      };
    }

    return normalized;
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
      const productIds = prices.map((price) => price.productId);
      const hashMap = await this.getStoredHashes(productIds);

      let mainBatch = db.batch();
      let historicalBatch = db.batch();
      let mainOps = 0;
      let historicalOps = 0;
      const batchPromises: Promise<WriteResult[]>[] = [];

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const price of prices) {
        try {
          result.processed++;

          const normalizedPrice = this.normalizePrice(price);
          if (!this.validatePrice(normalizedPrice)) continue;

          const currentHash = this.calculateHash(normalizedPrice);
          const storedHash = hashMap.get(price.productId);

          if (currentHash === storedHash && !options.forceUpdate) {
            continue;
          }

          const priceDoc = {
            productId: normalizedPrice.productId,
            lastUpdated: FieldValue.serverTimestamp(),
            groupId: parseInt(groupId),
            ...(normalizedPrice.normal && { normal: normalizedPrice.normal }),
            ...(normalizedPrice.foil && { foil: normalizedPrice.foil }),
          };

          const historicalDoc = {
            productId: normalizedPrice.productId,
            groupId,
            date: today,
            timestamp: FieldValue.serverTimestamp(),
            ...(normalizedPrice.normal && {
              normal: {
                directLow: normalizedPrice.normal.directLowPrice,
                high: normalizedPrice.normal.highPrice,
                low: normalizedPrice.normal.lowPrice,
                market: normalizedPrice.normal.marketPrice,
                mid: normalizedPrice.normal.midPrice,
              },
            }),
            ...(normalizedPrice.foil && {
              foil: {
                directLow: normalizedPrice.foil.directLowPrice,
                high: normalizedPrice.foil.highPrice,
                low: normalizedPrice.foil.lowPrice,
                market: normalizedPrice.foil.marketPrice,
                mid: normalizedPrice.foil.midPrice,
              },
            }),
          };

          const priceRef = db.collection(COLLECTION.PRICES).doc(price.productId.toString());
          mainBatch.set(priceRef, priceDoc, { merge: true });
          mainOps++;

          const hashRef = db.collection(COLLECTION.PRICE_HASHES).doc(price.productId.toString());
          mainBatch.set(hashRef, {
            hash: currentHash,
            lastUpdated: FieldValue.serverTimestamp(),
          }, { merge: true });
          mainOps++;

          const docId = `${price.productId}_${today.toISOString().split("T")[0]}`;
          const historicalRef = db.collection(COLLECTION.HISTORICAL_PRICES).doc(docId);
          historicalBatch.set(historicalRef, historicalDoc, { merge: true });
          historicalOps++;

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
          this.cache.set(`price_hash_${price.productId}`, currentHash);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          result.errors.push(`Error processing price for product ${price.productId}: ${errorMessage}`);
        }
      }

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
    const batches: CardPrice[][] = [];
    for (let i = 0; i < prices.length; i += this.BATCH_SIZE) {
      batches.push(prices.slice(i, i + this.BATCH_SIZE));
    }

    const results = [];
    for (let i = 0; i < batches.length; i += this.MAX_PARALLEL_BATCHES) {
      const currentBatches = batches.slice(i, i + this.MAX_PARALLEL_BATCHES);
      const batchPromises = currentBatches.map((batch) =>
        this.processPriceBatch(batch, groupId, options)
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

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
          logger.info(`Processing ${prices.length} prices for group ${group.groupId}`);

          const batchResults = await this.processPriceBatches(
            prices,
            group.groupId,
            options
          );

          result.itemsProcessed += batchResults.processed;
          result.itemsUpdated += batchResults.updated;
          result.errors.push(...batchResults.errors);

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
