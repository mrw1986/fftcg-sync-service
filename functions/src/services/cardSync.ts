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
import { FieldValue, WriteResult } from "firebase-admin/firestore";

interface SyncState {
  lastProcessedGroup?: string;
  lastProcessedIndex?: number;
  timestamp: Date;
}

export class CardSyncService {
  private readonly BATCH_SIZE = 50;
  private readonly MAX_PARALLEL_BATCHES = 2;
  private readonly MAX_BATCH_OPERATIONS = 450;
  private readonly MAX_CARDS_PER_GROUP = 25;
  private readonly GROUP_PROCESSING_DELAY = 2000;
  private readonly BATCH_DELAY = 500;

  private readonly rateLimiter = new RateLimiter();
  private readonly cache = new Cache<string>(15);
  private readonly retry = new RetryWithBackoff();

  private isApproachingTimeout(startTime: Date, safetyMarginSeconds = 30): boolean {
    const executionTime = (new Date().getTime() - startTime.getTime()) / 1000;
    return executionTime > (540 - safetyMarginSeconds);
  }

  private async saveSyncState(state: SyncState): Promise<void> {
    await db.collection(COLLECTION.SYNC_STATE).doc("cardSync").set({
      ...state,
      timestamp: FieldValue.serverTimestamp(),
    });
  }

  private async loadSyncState(): Promise<SyncState | null> {
    const doc = await db.collection(COLLECTION.SYNC_STATE).doc("cardSync").get();
    return doc.exists ? doc.data() as SyncState : null;
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

  private normalizeNumericValue(value: string | number | undefined): number | null {
    if (value === undefined || value === "") return null;
    const num = typeof value === "number" ? value : parseInt(String(value), 10);
    return isNaN(num) ? null : num;
  }

  private processExtendedData(card: CardProduct): Array<{
    name: string;
    displayName: string;
    value: string | number | null | string[];
  }> {
    return card.extendedData.map((data) => {
      if (data.name === "Cost") {
        const costValue = this.normalizeNumericValue(data.value);
        return {
          ...data,
          value: costValue,
        };
      }
      if (data.name === "Power") {
        const powerValue = this.normalizeNumericValue(data.value);
        return {
          ...data,
          value: powerValue,
        };
      }
      if (data.name === "Element") {
        return {
          name: "Elements",
          displayName: "Elements",
          value: this.getElements(card),
        };
      }
      return {
        ...data,
        value: String(data.value),
      };
    });
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
      const productIds = cards.map((card) => card.productId);
      const hashMap = await this.getStoredHashes(productIds);

      let mainBatch = db.batch();
      let batchOps = 0;
      const batchPromises: Promise<WriteResult[]>[] = [];

      for (const card of cards) {
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
            logger.info(`Skipping card ${card.productId} - no changes`);
            continue;
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
          };

          const cardRef = db.collection(COLLECTION.CARDS).doc(card.productId.toString());
          mainBatch.set(cardRef, cardDoc, { merge: true });
          batchOps++;

          const extendedDataRef = cardRef.collection("extendedData");
          const processedExtendedData = this.processExtendedData(card);
          processedExtendedData.forEach((data) => {
            mainBatch.set(extendedDataRef.doc(data.name), data, { merge: true });
            batchOps++;
          });

          mainBatch.set(
            cardRef.collection("metadata").doc("image"),
            imageResult.metadata,
            { merge: true }
          );
          batchOps++;

          const hashRef = db.collection(COLLECTION.CARD_HASHES).doc(card.productId.toString());
          mainBatch.set(hashRef, {
            hash: currentHash,
            lastUpdated: FieldValue.serverTimestamp(),
          }, { merge: true });
          batchOps++;

          await this.saveDeltaUpdate(mainBatch, card, cardDoc);
          batchOps++;

          this.cache.set(`hash_${card.productId}`, currentHash);

          if (batchOps >= this.MAX_BATCH_OPERATIONS) {
            batchPromises.push(
              this.rateLimiter.add(() => this.retry.execute(() => mainBatch.commit()))
            );
            mainBatch = db.batch();
            batchOps = 0;
            await new Promise((resolve) => setTimeout(resolve, this.BATCH_DELAY));
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

      if (batchOps > 0) {
        batchPromises.push(
          this.rateLimiter.add(() => this.retry.execute(() => mainBatch.commit()))
        );
      }

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
    const batches: CardProduct[][] = [];
    for (let i = 0; i < cards.length; i += this.BATCH_SIZE) {
      batches.push(cards.slice(i, i + this.BATCH_SIZE));
    }

    const results = [];
    for (let i = 0; i < batches.length; i += this.MAX_PARALLEL_BATCHES) {
      const currentBatches = batches.slice(i, i + this.MAX_PARALLEL_BATCHES);
      const batchPromises = currentBatches.map((batch) =>
        this.processCardBatch(batch, groupId, options)
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      if (i + this.MAX_PARALLEL_BATCHES < batches.length) {
        await new Promise((resolve) => setTimeout(resolve, this.BATCH_DELAY));
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

      const previousState = await this.loadSyncState();
      const groups = options.groupId ?
        [{ groupId: options.groupId }] :
        await this.retry.execute(() => tcgcsvApi.getGroups());

      logger.info(`Found ${groups.length} groups to process`);

      let startIndex = 0;
      if (previousState?.lastProcessedGroup && !options.groupId) {
        const lastGroupIndex = groups.findIndex((g) => g.groupId === previousState.lastProcessedGroup);
        if (lastGroupIndex !== -1) {
          startIndex = lastGroupIndex + 1; // Start with next group
        }
      }

      for (let groupIndex = startIndex; groupIndex < groups.length; groupIndex++) {
        if (this.isApproachingTimeout(result.timing.startTime)) {
          logger.warn("Approaching function timeout, stopping processing");
          break;
        }

        const group = groups[groupIndex];
        result.timing.groupStartTime = new Date();

        try {
          const cards = await this.retry.execute(() =>
            tcgcsvApi.getGroupProducts(group.groupId)
          );

          logger.info(`Processing ${cards.length} cards for group ${group.groupId}`);

          for (let i = 0; i < cards.length; i += this.MAX_CARDS_PER_GROUP) {
            if (this.isApproachingTimeout(result.timing.startTime)) {
              logger.warn("Approaching function timeout, stopping chunk processing");
              await this.saveSyncState({
                lastProcessedGroup: group.groupId,
                lastProcessedIndex: i,
                timestamp: new Date(),
              });
              break;
            }

            const cardChunk = cards.slice(i, i + this.MAX_CARDS_PER_GROUP);
            const currentChunk = Math.floor(i / this.MAX_CARDS_PER_GROUP) + 1;
            const totalChunks = Math.ceil(cards.length / this.MAX_CARDS_PER_GROUP);

            logger.info(`Processing chunk ${currentChunk}/${totalChunks} for group ${group.groupId}`);

            const batchResults = await this.processCardBatches(
              cardChunk,
              group.groupId,
              options
            );

            result.itemsProcessed += batchResults.processed;
            result.itemsUpdated += batchResults.updated;
            result.errors.push(...batchResults.errors);

            if (i + this.MAX_CARDS_PER_GROUP < cards.length) {
              await new Promise((resolve) =>
                setTimeout(resolve, this.BATCH_DELAY)
              );
            }
          }

          // Save state after completing each group
          await this.saveSyncState({
            lastProcessedGroup: group.groupId,
            timestamp: new Date(),
          });

          if (groups.length > 1) {
            await new Promise((resolve) =>
              setTimeout(resolve, this.GROUP_PROCESSING_DELAY)
            );
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
