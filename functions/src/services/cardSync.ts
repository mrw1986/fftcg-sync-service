// src/services/cardSync.ts
import { db, COLLECTION } from "../config/firebase";
import { tcgcsvApi } from "../utils/api";
import { storageService } from "./storageService";
import { CardProduct, SyncResult, CardHashData, SyncOptions } from "../types";
import { logger } from "../utils/logger";
import { Cache } from "../utils/cache";
import { RetryWithBackoff } from "../utils/retry";
import * as crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { OptimizedBatchProcessor } from "./batchProcessor";

export class CardSyncService {
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

  private getElements(card: CardProduct): string[] {
    const elementField = card.extendedData.find((data) => data.name === "Element");
    if (!elementField?.value) return [];

    const valueStr = String(elementField.value);
    return valueStr
      .split(/[;,]/)
      .map((element: string) => element.trim())
      .filter((element: string) => element.length > 0)
      .map((element: string) => element.charAt(0).toUpperCase() + element.slice(1).toLowerCase());
  }

  private getExtendedValue(card: CardProduct, fieldName: string): string | null {
    const field = card.extendedData.find(data => data.name === fieldName);
    return field?.value?.toString() || null;
  }

  private normalizeNumericValue(value: string | number | null | undefined): number | null {
    if (value === undefined || value === null || value === "") return null;
    const num = typeof value === "number" ? value : parseFloat(String(value));
    return isNaN(num) ? null : num;
  }

  private normalizeName(name: string | number): string {
    const nameStr = String(name);
    return nameStr.charAt(0).toUpperCase() + nameStr.slice(1);
  }

  private normalizeCardNumber(number: string): string {
    const clean = number.replace(/[-\s]/g, "");

    if (clean.startsWith("PR")) {
      const num = clean.slice(2);
      return `PR-${num}`;
    }

    const match = clean.match(/^(\d{1,2})(\d{3}[A-Za-z]?)$/);
    if (match) {
      const [, prefix, rest] = match;
      return `${prefix}-${rest}`;
    }

    return clean;
  }

  private getCardNumbers(card: CardProduct): string[] {
    const numbers: string[] = [];
    card.extendedData
      .filter((data) => data.name === "Number")
      .forEach((numberField) => {
        const valueStr = String(numberField.value);
        const vals = valueStr.split(/[,;/]/).map((n: string) => n.trim());
        numbers.push(...vals.map((num: string) => this.normalizeCardNumber(num)));
      });

    if (numbers.length === 0) {
      numbers.push(this.normalizeCardNumber(`P${card.productId}`));
    }

    return [...new Set(numbers)];
  }

  private isNonCardProduct(card: CardProduct): boolean {
    const cardType = card.extendedData.find((data) => data.name === "CardType")?.value;
    return !cardType || String(cardType).toLowerCase() === "sealed product";
  }

  private calculateHash(data: CardHashData): string {
    return crypto
      .createHash("md5")
      .update(JSON.stringify(data))
      .digest("hex");
  }

  private async getStoredHashes(productIds: number[]): Promise<Map<number, string>> {
    const hashMap = new Map<number, string>();
    const uncachedIds: number[] = [];

    productIds.forEach((id) => {
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

    const chunks = [];
    for (let i = 0; i < uncachedIds.length; i += 10) {
      chunks.push(uncachedIds.slice(i, i + 10));
    }

    await Promise.all(chunks.map(async (chunk) => {
      const refs = chunk.map((id) =>
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

  private async processCards(
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
      const productIds = cards.map((card) => card.productId);
      const hashMap = await this.getStoredHashes(productIds);

      await Promise.all(cards.map(async (card) => {
        try {
          result.processed++;

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

          const relevantData: CardHashData = {
            name: card.name,
            cleanName: card.cleanName,
            modifiedOn: card.modifiedOn,
            extendedData: card.extendedData,
          };

          const currentHash = this.calculateHash(relevantData);
          const storedHash = hashMap.get(card.productId);

          if (currentHash === storedHash && !options.forceUpdate) {
            return;
          }

          const cardDoc = {
            productId: card.productId,
            name: this.normalizeName(card.name),
            cleanName: this.normalizeName(card.cleanName),
            fullResUrl: imageResult.fullResUrl,
            highResUrl: imageResult.highResUrl,
            lowResUrl: imageResult.lowResUrl,
            lastUpdated: FieldValue.serverTimestamp(),
            groupId: parseInt(groupId),
            isNonCard: this.isNonCardProduct(card),
            cardNumbers,
            primaryCardNumber,
            
            // Flattened extended data
            cardType: this.getExtendedValue(card, "CardType"),
            category: this.getExtendedValue(card, "Category"),
            cost: this.normalizeNumericValue(this.getExtendedValue(card, "Cost")),
            description: this.getExtendedValue(card, "Description"),
            elements: this.getElements(card),
            job: this.getExtendedValue(card, "Job"),
            number: this.getExtendedValue(card, "Number"),
            power: this.normalizeNumericValue(this.getExtendedValue(card, "Power")),
            rarity: this.getExtendedValue(card, "Rarity"),
          };

          // Add main card document
          await this.batchProcessor.addOperation(batch => {
            const cardRef = db.collection(COLLECTION.CARDS).doc(card.productId.toString());
            batch.set(cardRef, cardDoc, { merge: true });
          });

          // Add image metadata
          await this.batchProcessor.addOperation(batch => {
            const cardRef = db.collection(COLLECTION.CARDS).doc(card.productId.toString());
            batch.set(
              cardRef.collection("metadata").doc("image"),
              imageResult.metadata,
              { merge: true }
            );
          });

          // Update hash
          await this.batchProcessor.addOperation(batch => {
            const hashRef = db.collection(COLLECTION.CARD_HASHES).doc(card.productId.toString());
            batch.set(hashRef, {
              hash: currentHash,
              lastUpdated: FieldValue.serverTimestamp(),
            }, { merge: true });
          });

          // Save delta
          await this.batchProcessor.addOperation(batch => {
            const deltaRef = db.collection(COLLECTION.CARD_DELTAS).doc();
            batch.set(deltaRef, {
              productId: card.productId,
              changes: cardDoc,
              timestamp: FieldValue.serverTimestamp(),
            });
          });

          this.cache.set(`hash_${card.productId}`, currentHash);
          result.updated++;

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          result.errors.push(`Error processing card ${card.productId}: ${errorMessage}`);
          logger.error(`Error processing card ${card.productId}`, { error: errorMessage });
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
      await this.retry.execute(() => tcgcsvApi.getGroups());

    logger.info(`Found ${groups.length} groups to process`);

    for (const group of groups) {
      if (this.isApproachingTimeout(result.timing.startTime)) {
        logger.warn("Approaching function timeout, stopping processing");
        break;
      }

      result.timing.groupStartTime = new Date();

      try {
        logger.info(`Processing group ${group.groupId}`);

        const cards = await this.retry.execute(() =>
          tcgcsvApi.getGroupProducts(group.groupId)
        );

        logger.info(`Retrieved ${cards.length} cards for group ${group.groupId}`);

        for (let i = 0; i < cards.length; i += this.CHUNK_SIZE) {
          if (this.isApproachingTimeout(result.timing.startTime)) {
            logger.warn("Approaching function timeout, stopping chunk processing");
            break;
          }

          const cardChunk = cards.slice(i, i + this.CHUNK_SIZE);
          const batchResults = await this.processCards(cardChunk, group.groupId, options);

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
        result.errors.push(`Error processing group ${group.groupId}: ${errorMessage}`);
        logger.error(`Error processing group ${group.groupId}`, { error: errorMessage });
      }
    }

    result.timing.endTime = new Date();
    result.timing.duration =
      (result.timing.endTime.getTime() - result.timing.startTime.getTime()) / 1000;

    logger.info(`Card sync completed in ${result.timing.duration}s`, {
      processed: result.itemsProcessed,
      updated: result.itemsUpdated,
      errors: result.errors.length,
    });

  } catch (error) {
    result.success = false;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Card sync failed: ${errorMessage}`);
    logger.error("Card sync failed", { error: errorMessage });
  }

  return result;
}
}

export const cardSync = new CardSyncService();