import axios, {AxiosError} from "axios";
import {db, COLLECTION, FFTCG_CATEGORY_ID, BASE_URL} from "../config/firebase";
import {
  CardProduct,
  SyncOptions,
  SyncMetadata,
  GenericError,
  CardPrice,
} from "../types";
import {cardCache, getCacheKey} from "../utils/cache";
import {logError, logInfo, logWarning} from "../utils/logger";
import * as crypto from "crypto";
import {SyncLogger} from "../utils/syncLogger";

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

async function processGroupProducts(
  group: any,
  options: SyncOptions,
  metadata: SyncMetadata,
  existingHashes: Map<string, string>,
  logger?: SyncLogger
): Promise<number> {
  const groupId = group.groupId.toString();
  let processedCards = 0;

  try {
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
    const prices = pricesResponse.results;

    // Log group details if logger is available
    if (logger) {
      await logger.logGroupDetails(groupId, products.length, prices.length);
    }

    const groupHash = getDataHash(products);
    const existingHash = existingHashes.get(groupId);

    // Log detailed card information if logger is available
    if (logger && options.dryRun) {
      for (const product of products) {
        if (options.limit && processedCards >= options.limit) break;

        const cardPrices = prices.filter((p) => p.productId === product.productId);
        await logger.logCardDetails({
          id: product.productId,
          name: product.name,
          groupId: product.groupId.toString(),
          normalPrice: cardPrices.find((p) => p.subTypeName === "Normal")?.midPrice,
          foilPrice: cardPrices.find((p) => p.subTypeName === "Foil")?.midPrice,
          rawPrices: cardPrices.map((p) => ({
            type: p.subTypeName,
            price: p.midPrice,
            groupId: groupId,
          })),
        });
        processedCards++;
      }
    }

    if (!options.dryRun && (!existingHash || existingHash !== groupHash)) {
      metadata.groupsUpdated++;

      await processBatch(products, async (batch) => {
        const writeBatch = db.batch();

        for (const product of batch) {
          if (options.limit && processedCards >= options.limit) break;

          const cardRef = db.collection(COLLECTION.CARDS)
            .doc(product.productId.toString());

          writeBatch.set(cardRef, {
            ...product,
            lastUpdated: new Date(),
            groupHash,
          }, {merge: true});

          cardCache.set(getCacheKey("card", product.productId), product);
          processedCards++;
        }

        const hashRef = db.collection(COLLECTION.CARD_HASHES)
          .doc(groupId);
        writeBatch.set(hashRef, {
          hash: groupHash,
          lastUpdated: new Date(),
        });

        await writeBatch.commit();
      });

      await logInfo(`Updated ${processedCards} cards from group ${groupId}`);
    } else {
      await logInfo(`No updates needed for group ${groupId} (unchanged)`);
    }

    metadata.cardCount += products.length;
    return processedCards;
  } catch (error) {
    const syncError = error instanceof Error ?
      new SyncError(error.message, "GROUP_PROCESSING_ERROR", {groupId}) :
      new SyncError("Unknown group processing error", "UNKNOWN_ERROR", {groupId});

    const errorMessage = `Error processing group ${groupId}: ${syncError.message}`;
    metadata.errors.push(errorMessage);
    await logError(syncError.toGenericError(), "processGroupProducts");
    return processedCards;
  }
}

export async function syncCards(options: SyncOptions = {}): Promise<SyncMetadata> {
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

    let processedCards = 0;
    const existingHashes = new Map<string, string>();

    const hashesSnapshot = await db.collection(COLLECTION.CARD_HASHES).get();
    hashesSnapshot.forEach((doc) => {
      existingHashes.set(doc.id, doc.data().hash);
    });

    if (options.dryRun) {
      await logger.logManualSyncStart();
    }

    for (const group of groups) {
      if (options.groupId && group.groupId.toString() !== options.groupId) continue;

      metadata.groupsProcessed++;
      const groupProcessedCards = await processGroupProducts(
        group,
        options,
        metadata,
        existingHashes,
        logger
      );

      processedCards += groupProcessedCards;
      if (options.limit && processedCards >= options.limit) break;
    }

    metadata.status = metadata.errors.length > 0 ? "completed_with_errors" : "success";

    await logger.logSyncResults({
      success: processedCards,
      failures: metadata.errors.length,
      groupId: options.groupId,
      type: options.dryRun ? "Manual" : "Scheduled",
    });
  } catch (error) {
    const syncError = error instanceof Error ?
      new SyncError(error.message, "SYNC_MAIN_ERROR") :
      new SyncError("Unknown sync error", "UNKNOWN_ERROR");

    metadata.status = "failed";
    metadata.errors.push(syncError.message);
    await logError(syncError.toGenericError(), "syncCards:main");
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
