// src/services/priceSync.ts

import {
  db,
  COLLECTION,
  FFTCG_CATEGORY_ID,
  BASE_URL,
} from "../config/firebase";
import {
  CardPrice,
  SyncOptions,
  SyncMetadata,
  PriceData,
  GenericError,
} from "../types";
import {logError, logInfo} from "../utils/logger";
import {SyncLogger} from "../utils/syncLogger";
import {makeRequest, processBatch} from
  "../utils/syncUtils";
import * as crypto from "crypto";


class SyncError extends Error implements GenericError {
  code?: string;

  constructor(
    message: string,
    code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "SyncError";
    this.code = code;
  }

  toGenericError(): GenericError {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      stack: this.stack,
    };
  }
}

async function getCardNumberFromFirestore(productId: number): Promise<string> {
  const snapshot = await db
    .collection(COLLECTION.CARDS)
    .where("productId", "==", productId)
    .get();

  if (!snapshot.empty) {
    const doc = snapshot.docs[0];
    const cardData = doc.data();
    const numberField = cardData.extendedData?.find(
      (data: any) => data.name === "Number"
    );
    return numberField?.value || "";
  }
  return "";
}

function getDataHash(data: any): string {
  return crypto
    .createHash("md5")
    .update(JSON.stringify(data, Object.keys(data).sort()))
    .digest("hex");
}

async function processPrices(
  prices: CardPrice[]
): Promise<Record<string, PriceData>> {
  const priceMap: Record<string, PriceData> = {};

  for (const price of prices) {
    const cardNumber = await getCardNumberFromFirestore(price.productId);
    // Sanitize the document ID by replacing forward slashes with hyphens
    const sanitizedCardNumber = cardNumber.replace(/\//g, "-");
    const docId = `${price.productId}_${sanitizedCardNumber}`;

    if (!priceMap[docId]) {
      priceMap[docId] = {
        lastUpdated: new Date(),
        productId: price.productId,
        cardNumber, // Keep the original card number in the data
      };
    }

    if (price.subTypeName === "Normal") {
      priceMap[docId].normal = price;
    } else {
      priceMap[docId].foil = price;
    }
  }

  return priceMap;
}

async function processGroupPrices(
  group: any,
  options: SyncOptions,
  metadata: SyncMetadata,
  logger?: SyncLogger
): Promise<void> {
  const groupId = group.groupId.toString();

  try {
    // Direct API call to the specific group's prices endpoint
    const pricesResponse = await makeRequest<{ results: CardPrice[] }>(
      `${FFTCG_CATEGORY_ID}/${groupId}/prices`,
      BASE_URL,
      {metadata: {groupId, groupName: group.name}}
    );

    const prices = pricesResponse.results;

    if (logger) {
      await logger.logGroupDetails(groupId, prices.length, prices.length);
    }

    if (options.productId) {
      const filteredPrices = prices.filter(
        (p) => p.productId === options.productId
      );
      if (filteredPrices.length === 0) {
        throw new SyncError(
          `No prices found for product ${options.productId}`,
          "NO_PRICES_FOUND",
          {productId: options.productId}
        );
      }
    }

    const priceHash = getDataHash(prices);
    const hashDoc = await db
      .collection(COLLECTION.PRICE_HASHES)
      .doc(groupId)
      .get();

    const existingHash = hashDoc.exists ? hashDoc.data()?.hash : null;

    if (logger && options.dryRun) {
      for (const price of prices) {
        const cardNumber = await getCardNumberFromFirestore(price.productId);
        await logger.logCardDetails({
          id: price.productId,
          name: `Product ${price.productId}`,
          groupId: groupId,
          cardNumber,
          normalPrice:
            price.subTypeName === "Normal" ? price.midPrice : undefined,
          foilPrice: price.subTypeName === "Foil" ? price.midPrice : undefined,
          rawPrices: [
            {
              type: price.subTypeName,
              price: price.midPrice,
              groupId: groupId,
            },
          ],
        });
      }
    }

    if (
      !options.dryRun &&
      (!existingHash || existingHash !== priceHash || options.force)
    ) {
      metadata.groupsUpdated++;
      const processedPrices = await processPrices(prices);

      await processBatch(
        Object.entries(processedPrices),
        async (batch) => {
          const writeBatch = db.batch();

          for (const [docId, priceData] of batch) {
            if (options.limit && metadata.cardCount >= options.limit) break;

            const priceRef = db.collection(COLLECTION.PRICES).doc(docId);
            writeBatch.set(priceRef, priceData, {merge: true});

            metadata.cardCount++;
          }

          const hashRef = db.collection(COLLECTION.PRICE_HASHES).doc(groupId);
          writeBatch.set(hashRef, {
            hash: priceHash,
            lastUpdated: new Date(),
          });

          await writeBatch.commit();
        },
        {
          batchSize: 100,
          onBatchComplete: async (stats) => {
            await logInfo("Batch processing progress", stats);
          },
        }
      );

      await logInfo(
        `Updated ${metadata.cardCount} prices from group ${groupId}`
      );
    } else {
      await logInfo(`No updates needed for group ${groupId} (unchanged)`);
    }
  } catch (error) {
    const syncError =
      error instanceof SyncError ?
        error :
        error instanceof Error ?
          new SyncError(error.message, "GROUP_PROCESSING_ERROR", {groupId}) :
          new SyncError("Unknown group processing error", "UNKNOWN_ERROR", {
            groupId,
          });

    const errorMessage = `Error processing group ${groupId}: ${syncError.message}`;
    metadata.errors.push(errorMessage);
    await logError(syncError.toGenericError(), "processGroupPrices");
  }
}

export async function syncPrices(
  options: SyncOptions = {}
): Promise<SyncMetadata> {
  const logger = options.silent ?
    undefined :
    new SyncLogger({
      type: options.dryRun ? "manual" : "scheduled",
      limit: options.limit,
      dryRun: options.dryRun,
      groupId: options.groupId,
      batchSize: 25,
    });

  if (logger) await logger.start();

  const startTime = Date.now();
  const metadata: SyncMetadata = {
    lastSync: new Date(),
    status: "in_progress",
    cardCount: 0,
    type: options.dryRun ? "manual" : "scheduled",
    groupsProcessed: 0,
    groupsUpdated: 0,
    errors: [],
  };

  try {
    let groups: any[] = [];

    if (options.groupId) {
      // Get group info for the specific group
      const groupResponse = await makeRequest<{ results: any[] }>(
        `${FFTCG_CATEGORY_ID}/groups`,
        BASE_URL,
        {metadata: {operation: "fetchGroups"}}
      );

      const group = groupResponse.results.find(
        (g) => g.groupId.toString() === options.groupId
      );
      if (!group) {
        throw new Error(`Group ${options.groupId} not found`);
      }

      groups = [group];
      console.log(`Processing single group: ${options.groupId}`);
    } else {
      const groupsResponse = await makeRequest<{ results: any[] }>(
        `${FFTCG_CATEGORY_ID}/groups`,
        BASE_URL,
        {metadata: {operation: "fetchGroups"}}
      );
      groups = groupsResponse.results;
    }

    if (logger) {
      await logger.logGroupFound(groups.length);
    }

    for (const group of groups) {
      metadata.groupsProcessed++;
      await processGroupPrices(group, options, metadata, logger);

      if (options.limit && metadata.cardCount >= options.limit) break;
    }

    metadata.status =
      metadata.errors.length > 0 ? "completed_with_errors" : "success";

    if (logger) {
      await logger.logSyncResults({
        success: metadata.cardCount,
        failures: metadata.errors.length,
        groupId: options.groupId,
        type: options.dryRun ? "Manual" : "Scheduled",
      });
    }
  } catch (error) {
    const syncError =
      error instanceof SyncError ?
        error :
        error instanceof Error ?
          new SyncError(error.message, "SYNC_MAIN_ERROR") :
          new SyncError("Unknown sync error", "UNKNOWN_ERROR");

    metadata.status = "failed";
    metadata.errors.push(syncError.message);
    await logError(syncError.toGenericError(), "syncPrices:main");
  }

  metadata.lastSync = new Date();
  metadata.duration = Date.now() - startTime;

  if (!options.dryRun) {
    await db.collection(COLLECTION.SYNC_METADATA).add(metadata);
  }

  if (logger) await logger.finish();
  return metadata;
}
