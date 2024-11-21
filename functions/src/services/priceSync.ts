import axios, {AxiosError} from "axios";
import {db, COLLECTION, FFTCG_CATEGORY_ID, BASE_URL} from "../config/firebase";
import {
  CardPrice,
  SyncOptions,
  SyncMetadata,
  PriceData,
  GenericError,
  CardProduct,
} from "../types";
import {logError, logInfo, logWarning} from "../utils/logger";
import {SyncLogger} from "../utils/syncLogger";
import * as crypto from "crypto";

const MAX_RETRIES = 3;
const BASE_DELAY = 1000;

interface RequestOptions {
  retryCount?: number;
  customDelay?: number;
  metadata?: Record<string, unknown>;
}

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

async function makeRequest<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const {retryCount = 0, customDelay = BASE_DELAY} = options;

  try {
    await new Promise((resolve) => setTimeout(resolve, customDelay));
    const url = `${BASE_URL}/${endpoint}`;

    await logInfo(`Making request to: ${url}`, {
      attempt: retryCount + 1,
      maxRetries: MAX_RETRIES,
      endpoint,
      ...options.metadata,
    });

    const response = await axios.get<T>(url, {
      timeout: 30000,
      headers: {
        "Accept": "application/json",
        "User-Agent": "FFTCG-Sync-Service/1.0",
      },
    });

    return response.data;
  } catch (error) {
    if (retryCount < MAX_RETRIES - 1 && error instanceof AxiosError) {
      const delay = Math.pow(2, retryCount) * BASE_DELAY;
      await logWarning(`Request failed, retrying in ${delay}ms...`, {
        error: error.message,
        url: `${BASE_URL}/${endpoint}`,
        attempt: retryCount + 1,
        maxRetries: MAX_RETRIES,
      });

      return makeRequest<T>(endpoint, {
        ...options,
        retryCount: retryCount + 1,
        customDelay: delay,
      });
    }

    throw new SyncError(
      error instanceof Error ? error.message : "Unknown request error",
      error instanceof AxiosError ? error.code : "UNKNOWN_ERROR",
      {endpoint, ...options.metadata}
    );
  }
}

function getDataHash(data: any): string {
  return crypto.createHash("md5")
    .update(JSON.stringify(data, Object.keys(data).sort()))
    .digest("hex");
}

function processPrices(prices: CardPrice[]): Record<number, PriceData> {
  const priceMap: Record<number, PriceData> = {};

  prices.forEach((price) => {
    if (!priceMap[price.productId]) {
      priceMap[price.productId] = {
        lastUpdated: new Date(),
      };
    }

    if (price.subTypeName === "Normal") {
      priceMap[price.productId].normal = price;
    } else {
      priceMap[price.productId].foil = price;
    }
  });

  return priceMap;
}

async function processBatch<T>(
  items: T[],
  processor: (batch: T[]) => Promise<void>,
  batchSize: number = 500
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await processor(batch);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function processGroupPrices(
  group: any,
  options: SyncOptions,
  metadata: SyncMetadata,
  logger?: SyncLogger
): Promise<void> {
  const groupId = group.groupId.toString();

  try {
    // If specific productId is provided, first verify the card exists
    if (options.productId) {
      const card = await db.collection(COLLECTION.CARDS)
        .doc(options.productId.toString())
        .get();

      if (!card.exists) {
        throw new SyncError(
          `Card with ID ${options.productId} not found`,
          "CARD_NOT_FOUND",
          {productId: options.productId}
        );
      }

      const cardData = card.data();
      if (cardData?.groupId?.toString() !== groupId) {
        return; // Skip this group if it doesn't contain the requested product
      }
    }

    // Fetch both products and prices for detailed logging
    const [productsResponse, pricesResponse] = await Promise.all([
      makeRequest<{ results: CardProduct[] }>(
        `${FFTCG_CATEGORY_ID}/${groupId}/products`,
        {metadata: {groupId, groupName: group.name}}
      ),
      makeRequest<{ results: CardPrice[] }>(
        `${FFTCG_CATEGORY_ID}/${groupId}/prices`,
        {metadata: {groupId, groupName: group.name}}
      ),
    ]);

    const products = productsResponse.results;
    let prices = pricesResponse.results;

    if (logger) {
      await logger.logGroupDetails(groupId, products.length, prices.length);
    }

    // Filter for specific product if requested
    if (options.productId) {
      prices = prices.filter((p) => p.productId === options.productId);
      if (prices.length === 0) {
        throw new SyncError(
          `No prices found for product ${options.productId}`,
          "NO_PRICES_FOUND",
          {productId: options.productId}
        );
      }
    }

    const priceHash = getDataHash(prices);
    const hashDoc = await db.collection(COLLECTION.PRICE_HASHES)
      .doc(groupId)
      .get();

    const existingHash = hashDoc.exists ? hashDoc.data()?.hash : null;

    // Log detailed price information if logger is available
    if (logger && options.dryRun) {
      for (const product of products) {
        const cardPrices = prices.filter((p) => p.productId === product.productId);
        if (cardPrices.length > 0) {
          await logger.logCardDetails({
            id: product.productId,
            name: product.name,
            groupId: groupId,
            normalPrice: cardPrices.find((p) => p.subTypeName === "Normal")?.midPrice,
            foilPrice: cardPrices.find((p) => p.subTypeName === "Foil")?.midPrice,
            rawPrices: cardPrices.map((p) => ({
              type: p.subTypeName,
              price: p.midPrice,
              groupId: groupId,
            })),
          });
        }
      }
    }

    if (!options.dryRun && (!existingHash || existingHash !== priceHash)) {
      metadata.groupsUpdated++;
      const processedPrices = processPrices(prices);

      await processBatch(
        Object.entries(processedPrices),
        async (batch) => {
          const writeBatch = db.batch();

          for (const [productId, priceData] of batch) {
            if (options.limit && metadata.cardCount >= options.limit) break;

            const priceRef = db.collection(COLLECTION.PRICES)
              .doc(productId);
            writeBatch.set(priceRef, priceData, {merge: true});

            metadata.cardCount++;
          }

          // Update hash
          const hashRef = db.collection(COLLECTION.PRICE_HASHES)
            .doc(groupId);
          writeBatch.set(hashRef, {
            hash: priceHash,
            lastUpdated: new Date(),
          });

          await writeBatch.commit();
        }
      );

      await logInfo(`Updated ${metadata.cardCount} prices from group ${groupId}`);
    } else {
      await logInfo(`No updates needed for group ${groupId} (unchanged)`);
    }
  } catch (error) {
    const syncError = error instanceof SyncError ? error :
      error instanceof Error ?
        new SyncError(error.message, "GROUP_PROCESSING_ERROR", {groupId}) :
        new SyncError("Unknown group processing error", "UNKNOWN_ERROR", {groupId});

    const errorMessage = `Error processing group ${groupId}: ${syncError.message}`;
    metadata.errors.push(errorMessage);
    await logError(syncError.toGenericError(), "processGroupPrices");
  }
}

export async function syncPrices(options: SyncOptions = {}): Promise<SyncMetadata> {
  const logger = new SyncLogger({
    type: options.dryRun ? "both" : "scheduled",
    limit: options.limit,
    dryRun: options.dryRun,
    groupId: options.groupId,
    batchSize: 25,
  });

  await logger.start();

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
    const groupsResponse = await makeRequest<{ results: any[] }>(
      `${FFTCG_CATEGORY_ID}/groups`,
      {metadata: {operation: "fetchGroups"}}
    );

    const groups = groupsResponse.results;
    await logger.logGroupFound(groups.length);

    if (options.dryRun) {
      await logger.logManualSyncStart();
    }

    if (options.groupId) {
      const group = groups.find((g) => g.groupId.toString() === options.groupId);
      if (!group) {
        throw new SyncError(
          `Group ${options.groupId} not found`,
          "GROUP_NOT_FOUND",
          {groupId: options.groupId}
        );
      }
      groups.length = 0;
      groups.push(group);
    }

    for (const group of groups) {
      metadata.groupsProcessed++;
      await processGroupPrices(group, options, metadata, logger);

      if (options.limit && metadata.cardCount >= options.limit) break;
    }

    metadata.status = metadata.errors.length > 0 ? "completed_with_errors" : "success";

    await logger.logSyncResults({
      success: metadata.cardCount,
      failures: metadata.errors.length,
      groupId: options.groupId,
      type: options.dryRun ? "Manual" : "Scheduled",
    });
  } catch (error) {
    const syncError = error instanceof SyncError ? error :
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
    await db.collection(COLLECTION.SYNC_METADATA)
      .add(metadata);
  }

  await logger.finish();
  return metadata;
}
