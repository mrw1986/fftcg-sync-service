// src/services/cardSync.ts
import { db } from "../config/firebase";
import { tcgcsvApi } from "../utils/api";
import { storageService } from "./storageService";
import { CardProduct, SyncResult, CardHashData, SyncTiming, SyncOptions } from "../types";
import { logger } from "../utils/logger";
import * as crypto from "crypto";

export class CardSyncService {
  private readonly CARDS_COLLECTION = "cards";
  private readonly HASH_COLLECTION = "cardHashes";
  private readonly BATCH_SIZE = 5;

  private calculateHash(data: CardHashData): string {
    return crypto.createHash("md5").update(JSON.stringify(data)).digest("hex");
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

  private getCardNumbers(card: CardProduct): string[] {
    const numbers: string[] = [];

    // Get all number fields from extended data
    card.extendedData
      .filter((data) => data.name === "Number")
      .forEach((numberField) => {
        // Split on common separators and trim
        const vals = numberField.value.split(/[,;/]/).map((n) => n.trim());
        numbers.push(...vals);
      });

    // If no numbers found, use product ID
    if (numbers.length === 0) {
      numbers.push(`P${card.productId}`);
    }

    return [...new Set(numbers)]; // Remove duplicates
  }

  private getDocumentIds(card: CardProduct): string[] {
    return this.getCardNumbers(card).map((num) => `${card.productId}_${num}`);
  }

  private isNonCardProduct(card: CardProduct): boolean {
    const cardType = card.extendedData.find((data) => data.name === "CardType")?.value;
    return !cardType || cardType.toLowerCase() === "sealed product";
  }

  private updateTiming(timing: SyncTiming): void {
    timing.lastUpdateTime = new Date();
    if (timing.startTime) {
      timing.duration = (timing.lastUpdateTime.getTime() - timing.startTime.getTime()) / 1000;
    }
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

    const batches = [];
    for (let i = 0; i < cards.length; i += this.BATCH_SIZE) {
      batches.push(cards.slice(i, i + this.BATCH_SIZE));
    }

    for (const batch of batches) {
      try {
        await Promise.all(
          batch.map(async (card) => {
            try {
              result.processed++;

              const relevantData: CardHashData = {
                name: card.name,
                cleanName: card.cleanName,
                modifiedOn: card.modifiedOn,
                extendedData: card.extendedData,
              };
              const currentHash = this.calculateHash(relevantData);
              const storedHash = await this.getStoredHash(card.productId);

              if (currentHash === storedHash && !options.forceUpdate) {
                logger.info(`Skipping card ${card.productId} - no changes`);
                return;
              }

              const cardNumbers = this.getCardNumbers(card);
              const documentIds = this.getDocumentIds(card);
              const primaryCardNumber = cardNumbers[0];

              const imageResult = await storageService.processAndStoreImage(
                card.imageUrl,
                card.productId,
                groupId,
                primaryCardNumber
              );

              const cardDoc = {
                ...card,
                imageUrl: undefined,
                highResUrl: imageResult.highResUrl,
                lowResUrl: imageResult.lowResUrl,
                imageMetadata: imageResult.metadata,
                lastUpdated: new Date(),
                groupId: parseInt(groupId),
                isNonCard: this.isNonCardProduct(card),
                cardNumbers: cardNumbers,
                primaryCardNumber: primaryCardNumber,
              };

              // Create a batch for multiple document writes
              const batch = db.batch();
              documentIds.forEach((docId) => {
                batch.set(db.collection(this.CARDS_COLLECTION).doc(docId), cardDoc, { merge: true });
              });
              await batch.commit();

              await this.updateStoredHash(card.productId, currentHash);

              result.updated++;
              logger.info(`Updated card ${card.productId}: ${card.name} with numbers: ${cardNumbers.join(", ")}`);
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : "Unknown error";
              result.errors.push(`Error processing card ${card.productId}: ${errorMessage}`);
              logger.error(`Error processing card ${card.productId}`, { error: errorMessage });
            }
          })
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        result.errors.push(`Error processing batch: ${errorMessage}`);
        logger.error("Error processing batch", { error: errorMessage });
      }
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

      const groups = options.groupId ? [{ groupId: options.groupId }] : await tcgcsvApi.getGroups();
      logger.info(`Found ${groups.length} groups to process`);

      for (const group of groups) {
        result.timing.groupStartTime = new Date();
        try {
          const cards = await tcgcsvApi.getGroupProducts(group.groupId);
          logger.info(`Retrieved ${cards.length} cards for group ${group.groupId}`);

          const batchResult = await this.processCardBatch(cards, group.groupId, options);

          result.itemsProcessed += batchResult.processed;
          result.itemsUpdated += batchResult.updated;
          result.errors.push(...batchResult.errors);

          this.updateTiming(result.timing);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          result.errors.push(`Error processing group ${group.groupId}: ${errorMessage}`);
          logger.error(`Error processing group ${group.groupId}`, { error: errorMessage });
        }
      }
    } catch (error) {
      result.success = false;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Card sync failed: ${errorMessage}`);
      logger.error("Card sync failed", { error: errorMessage });
    }

    result.timing.endTime = new Date();
    result.timing.duration = (result.timing.endTime.getTime() - result.timing.startTime.getTime()) / 1000;

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
