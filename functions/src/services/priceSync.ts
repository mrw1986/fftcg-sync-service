import { db } from "../config/firebase";
import { tcgcsvApi } from "../utils/api";
import { CardPrice, SyncResult, SyncTiming } from "../types";
import { logger } from "../utils/logger";
import * as crypto from "crypto";

export class PriceSyncService {
  private readonly PRICES_COLLECTION = "prices";
  private readonly HISTORICAL_PRICES_COLLECTION = "historicalPrices";
  private readonly HASH_COLLECTION = "priceHashes";

  private calculateHash(price: CardPrice): string {
    const relevantData = {
      normal: price.normal,
      foil: price.foil,
      lastUpdated: price.lastUpdated,
    };
    return crypto.createHash("md5").update(JSON.stringify(relevantData)).digest("hex");
  }

  private async getStoredHash(productId: number): Promise<string | null> {
    const doc = await db.collection(this.HASH_COLLECTION).doc(productId.toString()).get();
    return doc.exists ? doc.data()?.hash : null;
  }

  private async updateStoredHash(productId: number, hash: string): Promise<void> {
    await db.collection(this.HASH_COLLECTION).doc(productId.toString()).set({
      hash,
      lastUpdated: new Date(),
    });
  }

  private updateTiming(timing: SyncTiming): void {
    timing.lastUpdateTime = new Date();
    if (timing.startTime) {
      timing.duration = (timing.lastUpdateTime.getTime() - timing.startTime.getTime()) / 1000;
    }
    logger.info(`Price sync progress - Duration: ${timing.duration}s`, {
      lastUpdate: timing.lastUpdateTime,
      duration: timing.duration,
    });
  }

  private async saveHistoricalPrice(price: CardPrice, groupId: string): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const docId = `${price.productId}_${today.toISOString().split("T")[0]}`;

    // Check if we already have today's record
    const docRef = db.collection(this.HISTORICAL_PRICES_COLLECTION).doc(docId);
    const doc = await docRef.get();

    if (doc.exists) {
      logger.info(`Historical price for ${price.productId} already exists for today, skipping`);
      return;
    }

    const historicalPrice = {
      productId: price.productId,
      groupId,
      date: today,
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

    await docRef.set(historicalPrice);
    logger.info(`Saved historical price for product ${price.productId} for date ${today.toISOString().split("T")[0]}`);
  }

  async syncPrices(options: { groupId?: string; forceUpdate?: boolean } = {}): Promise<SyncResult> {
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

      // Use options.groupId if provided, otherwise get all groups
      const groups = options.groupId ? [{ groupId: options.groupId }] : await tcgcsvApi.getGroups();

      logger.info(`Found ${groups.length} groups to process`);

      for (const group of groups) {
        result.timing.groupStartTime = new Date();
        try {
          logger.info(`Processing prices for group ${group.groupId}`);
          const prices = await tcgcsvApi.getGroupPrices(group.groupId);
          logger.info(`Retrieved ${prices.length} prices for group ${group.groupId}`);

          for (const price of prices) {
            try {
              result.itemsProcessed++;
              this.updateTiming(result.timing);

              // Always save historical price data
              await this.saveHistoricalPrice(price, group.groupId);

              // Check if current price has changed
              const currentHash = this.calculateHash(price);
              const storedHash = await this.getStoredHash(price.productId);

              // Skip updating current price if unchanged
              if (currentHash === storedHash) {
                logger.info(`Skipping price update for ${price.productId} - no changes`);
                continue;
              }

              // Update current price
              const priceDoc = {
                ...price,
                lastUpdated: new Date(),
              };

              await db
                .collection(this.PRICES_COLLECTION)
                .doc(price.productId.toString())
                .set(priceDoc, { merge: true });

              // Update hash
              await this.updateStoredHash(price.productId, currentHash);

              result.itemsUpdated++;
              logger.info(`Updated current price for product ${price.productId}`);
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : "Unknown error";
              result.errors.push(`Error processing price for product ${price.productId}: ${errorMessage}`);
              logger.error(`Error processing price for product ${price.productId}`, { error: errorMessage });
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          result.errors.push(`Error processing prices for group ${group.groupId}: ${errorMessage}`);
          logger.error(`Error processing prices for group ${group.groupId}`, { error: errorMessage });
        }
      }
    } catch (error) {
      result.success = false;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Price sync failed: ${errorMessage}`);
      logger.error("Price sync failed", { error: errorMessage });
    }

    result.timing.endTime = new Date();
    result.timing.duration = (result.timing.endTime.getTime() - result.timing.startTime.getTime()) / 1000;

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
