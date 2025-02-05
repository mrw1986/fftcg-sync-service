// src/services/priceSync.ts
import { db, COLLECTION } from "../config/firebase";
import { tcgcsvApi } from "../utils/api";
import { CardPrice, SyncResult, SyncOptions } from "../types";
import { logger } from "../utils/logger";
import { Cache } from "../utils/cache";
import { RetryWithBackoff } from "../utils/retry";
import * as crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { OptimizedBatchProcessor } from "./batchProcessor";

export class PriceSyncService {
  private readonly CHUNK_SIZE = 2000;
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
    return Math.round(parseFloat(value.toString()) * 100);
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
      Number.isInteger(this.normalizePriceValue(data.marketPrice)) &&
      Number.isInteger(this.normalizePriceValue(data.lowPrice)) &&
      Number.isInteger(this.normalizePriceValue(data.highPrice)) &&
      Number.isInteger(this.normalizePriceValue(data.midPrice)) &&
      (data.directLowPrice === null || Number.isInteger(this.normalizePriceValue(data.directLowPrice)))
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

  private async processPrices(
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
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      await Promise.all(prices.map(async (price) => {
        try {
          result.processed++;

          const normalizedPrice = this.normalizePrice(price);
          if (!this.validatePrice(normalizedPrice)) {
            return;
          }

          const currentHash = this.calculateHash(normalizedPrice);
          const storedHash = hashMap.get(price.productId);

          if (currentHash === storedHash && !options.forceUpdate) {
            return;
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

          // Add main price document
          await this.batchProcessor.addOperation((batch) => {
            const priceRef = db.collection(COLLECTION.PRICES).doc(price.productId.toString());
            batch.set(priceRef, priceDoc, { merge: true });
          });

          // Add hash document
          await this.batchProcessor.addOperation((batch) => {
            const hashRef = db.collection(COLLECTION.PRICE_HASHES).doc(price.productId.toString());
            batch.set(hashRef, {
              hash: currentHash,
              lastUpdated: FieldValue.serverTimestamp(),
            }, { merge: true });
          });

          // Add historical price document
          await this.batchProcessor.addOperation((batch) => {
            const docId = `${price.productId}_${today.toISOString().split("T")[0]}`;
            const historicalRef = db.collection(COLLECTION.HISTORICAL_PRICES).doc(docId);
            batch.set(historicalRef, historicalDoc, { merge: true });
          });

          this.cache.set(`price_hash_${price.productId}`, currentHash);
          result.updated++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          result.errors.push(`Error processing price for product ${price.productId}: ${errorMessage}`);
          logger.error(`Error processing price for product ${price.productId}`, { error: errorMessage });
        }
      }));

      await this.batchProcessor.commitAll();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Batch processing error: ${errorMessage}`);
      logger.error("Batch processing error", { error: errorMessage });
    }

    return result;
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
        await this.retry.execute(() => tcgcsvApi.getGroups());

      logger.info(`Found ${groups.length} groups to process`);

      for (const group of groups) {
        if (this.isApproachingTimeout(result.timing.startTime)) {
          logger.warn("Approaching function timeout, stopping processing");
          break;
        }

        result.timing.groupStartTime = new Date();

        try {
          const prices = await this.retry.execute(() =>
            tcgcsvApi.getGroupPrices(group.groupId)
          );

          logger.info(`Processing ${prices.length} prices for group ${group.groupId}`);

          for (let i = 0; i < prices.length; i += this.CHUNK_SIZE) {
            if (this.isApproachingTimeout(result.timing.startTime)) {
              logger.warn("Approaching function timeout, stopping chunk processing");
              break;
            }

            const priceChunk = prices.slice(i, i + this.CHUNK_SIZE);
            const batchResults = await this.processPrices(
              priceChunk,
              group.groupId,
              options
            );

            result.itemsProcessed += batchResults.processed;
            result.itemsUpdated += batchResults.updated;
            result.errors.push(...batchResults.errors);
          }

          logger.info(`Completed group ${group.groupId}`, {
            processed: result.itemsProcessed,
            updated: result.itemsUpdated,
            errors: result.errors.length,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          result.errors.push(`Error processing prices for group ${
            group.groupId}: ${errorMessage}`);
          logger.error(`Error processing prices for group ${group.groupId}`, {
            error: errorMessage,
          });
        }
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
    } catch (error) {
      result.success = false;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Price sync failed: ${errorMessage}`);
      logger.error("Price sync failed", { error: errorMessage });
    }

    return result;
  }
}

export const priceSync = new PriceSyncService();
