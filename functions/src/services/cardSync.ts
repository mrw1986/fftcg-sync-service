// src/services/cardSync.ts

import {
  db,
  COLLECTION,
  FFTCG_CATEGORY_ID,
  BASE_URL,
} from "../config/firebase";
import {
  CardProduct,
  SyncOptions,
  SyncMetadata,
  GenericError,
  BatchProcessingStats,
} from "../types";
import {cardCache, getCacheKey} from "../utils/cache";
import {logError, logInfo} from "../utils/logger";
import * as crypto from "crypto";
import {SyncLogger} from "../utils/syncLogger";
import {ImageHandler} from "../utils/imageHandler";
import {makeRequest, processBatch, sanitizeDocumentId} from "../utils/syncUtils";
import {Query} from "@google-cloud/firestore";

// Add this type
type FirestoreQuery = Query<FirebaseFirestore.DocumentData>;

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

function getCardNumber(product: CardProduct): string {
  const numberField = product.extendedData.find(
    (data) => data.name === "Number"
  );
  return numberField ? numberField.value : "";
}

function getDocumentId(product: CardProduct): string {
  const cardNumber = getCardNumber(product);
  return sanitizeDocumentId(product.productId, cardNumber);
}

function getDataHash(data: any): string {
  return crypto
    .createHash("md5")
    .update(JSON.stringify(data, Object.keys(data).sort()))
    .digest("hex");
}

async function processGroupProducts(
  group: any,
  options: SyncOptions,
  metadata: SyncMetadata,
  existingHashes: Map<string, string>,
  imageHandler: ImageHandler,
  logger?: SyncLogger
): Promise<number> {
  const groupId = group.groupId.toString();
  let processedCards = 0;

  try {
    const productsResponse = await makeRequest<{ results: CardProduct[] }>(
      `${FFTCG_CATEGORY_ID}/${groupId}/products`,
      BASE_URL,
      {metadata: {groupId, groupName: group.name}}
    );

    const products = productsResponse.results;

    if (logger) {
      await logger.logGroupDetails(groupId, products.length, products.length);
    }

    const groupHash = getDataHash(products);
    const existingHash = existingHashes.get(groupId);

    if (logger && options.dryRun) {
      for (const product of products) {
        if (options.limit && processedCards >= options.limit) break;

        const cardNumber = getCardNumber(product);
        await logger.logCardDetails({
          id: product.productId,
          name: product.name,
          groupId: groupId,
          cardNumber,
          highResUrl: product.highResUrl || "",
          lowResUrl: product.lowResUrl || "",
          rawPrices: [],
        });
        processedCards++;
      }
    }

    const shouldUpdate =
      options.force || !existingHash || existingHash !== groupHash;

    if (!options.dryRun && shouldUpdate) {
      metadata.groupsUpdated++;

      await processBatch(
        products,
        async (batch) => {
          const writeBatch = db.batch();
          const imagePromises: Promise<any>[] = [];

          for (const product of batch) {
            if (options.limit && processedCards >= options.limit) break;

            const cardNumber = getCardNumber(product);

            if (!options.skipImages) {
              imagePromises.push(
                imageHandler.processImage(
                  product.imageUrl || "",
                  groupId,
                  product.productId,
                  cardNumber
                )
              );
            }

            const cardRef = db
              .collection(COLLECTION.CARDS)
              .doc(getDocumentId(product));

            const productData = {
              ...product,
              highResUrl: product.highResUrl || "",
              lowResUrl: product.lowResUrl || "",
              lastUpdated: new Date(),
              groupHash,
            };

            // Remove imageUrl field
            delete productData.imageUrl;

            if (productData.imageMetadata) {
              const {
                contentType,
                size,
                updated,
                hash,
                groupId,
                productId,
                cardNumber,
                lastUpdated,
                originalSize,
                highResSize,
                lowResSize,
              } = productData.imageMetadata;

              productData.imageMetadata = {
                contentType,
                size,
                updated,
                hash,
                groupId,
                productId,
                cardNumber,
                lastUpdated,
                originalSize,
                highResSize,
                lowResSize,
              };
            }

            writeBatch.set(cardRef, productData, {merge: true});

            cardCache.set(
              getCacheKey("card", product.productId, cardNumber),
              productData
            );
            processedCards++;
          }

          if (imagePromises.length > 0) {
            const imageResults = await Promise.allSettled(imagePromises);

            imageResults.forEach((result, index) => {
              if (result.status === "fulfilled") {
                const product = batch[index];
                const cardRef = db
                  .collection(COLLECTION.CARDS)
                  .doc(getDocumentId(product));

                writeBatch.update(cardRef, {
                  originalUrl: result.value.originalUrl,
                  highResUrl: result.value.highResUrl,
                  lowResUrl: result.value.lowResUrl,
                  imageMetadata: {
                    contentType: result.value.metadata.contentType,
                    size: result.value.metadata.size,
                    updated: result.value.metadata.updated,
                    hash: result.value.metadata.hash,
                    originalSize: result.value.metadata.originalSize,
                    highResSize: result.value.metadata.highResSize,
                    lowResSize: result.value.metadata.lowResSize,
                  },
                });

                if (result.value.updated) {
                  metadata.imagesUpdated = (metadata.imagesUpdated || 0) + 1;
                }
              }
            });

            metadata.imagesProcessed =
              (metadata.imagesProcessed || 0) + imagePromises.length;
          }

          const hashRef = db.collection(COLLECTION.CARD_HASHES).doc(groupId);
          writeBatch.set(hashRef, {
            hash: groupHash,
            lastUpdated: new Date(),
          });

          await writeBatch.commit();
        },
        {
          batchSize: 100,
          onBatchComplete: async (stats: BatchProcessingStats) => {
            await logInfo("Batch processing progress", stats);
          },
        }
      );

      await logInfo(`Updated ${processedCards} cards from group ${groupId}`, {
        groupId,
        processedCards,
        imagesProcessed: metadata.imagesProcessed,
        imagesUpdated: metadata.imagesUpdated,
        timestamp: new Date().toISOString(),
      });
    } else {
      await logInfo(`No updates needed for group ${groupId}`, {
        status: "unchanged",
        groupId,
        cardCount: products.length,
        timestamp: new Date().toISOString(),
      });
    }

    metadata.cardCount += products.length;
    return processedCards;
  } catch (error) {
    const syncError =
      error instanceof Error ?
        new SyncError(error.message, "GROUP_PROCESSING_ERROR", {groupId}) :
        new SyncError("Unknown group processing error", "UNKNOWN_ERROR", {
          groupId,
        });

    const errorMessage = `Error processing group ${groupId}: ${syncError.message}`;
    metadata.errors.push(errorMessage);
    await logError(syncError.toGenericError(), "processGroupProducts");
    return processedCards;
  }
}

export async function syncCards(
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

  const metadata: SyncMetadata = {
    lastSync: new Date(),
    status: "in_progress",
    cardCount: 0,
    type: options.dryRun ? "manual" : "scheduled",
    groupsProcessed: 0,
    groupsUpdated: 0,
    errors: [],
    imagesProcessed: 0,
    imagesUpdated: 0,
  };

  try {
    let groups: any[] = [];

    // Skip card data sync if only processing images
    if (!options.imagesOnly) {
      if (options.groupId) {
        const groupResponse = await makeRequest<{ results: any[] }>(
          `${FFTCG_CATEGORY_ID}/groups`,
          BASE_URL,
          {metadata: {operation: "fetchGroups"}}
        );

        const group = groupResponse.results.find(
          (g) => g.groupId.toString() === options.groupId
        );
        if (!group) {
          throw new SyncError(
            `Group ${options.groupId} not found`,
            "GROUP_NOT_FOUND",
            {groupId: options.groupId}
          );
        }

        groups = [group];
        await logInfo(`Processing single group: ${options.groupId}`);
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
    }

    let processedCards = 0;
    const existingHashes = new Map<string, string>();

    // Only fetch hashes if we're not just processing images
    if (!options.imagesOnly) {
      const hashQueries = groups.map((group) =>
        db
          .collection(COLLECTION.CARD_HASHES)
          .doc(group.groupId.toString())
          .get()
      );

      const hashDocs = await Promise.all(hashQueries);
      hashDocs.forEach((doc) => {
        if (doc.exists) {
          existingHashes.set(doc.id, doc.data()?.hash);
        }
      });
    }

    const imageHandler = new ImageHandler();

    // If only processing images, fetch existing cards from Firestore
    if (options.imagesOnly) {
      try {
        let baseQuery: FirestoreQuery = db.collection(COLLECTION.CARDS);

        if (options.groupId) {
          baseQuery = baseQuery.where("groupId", "==", options.groupId);
        }

        if (options.limit) {
          baseQuery = baseQuery.limit(options.limit);
        }

        const snapshot = await baseQuery.get();

        await logInfo(`Processing images for ${snapshot.size} cards`);

        for (const doc of snapshot.docs) {
          const card = doc.data();
          await processCardImages(card, imageHandler, options, metadata);
          processedCards++;

          if (options.limit && processedCards >= options.limit) break;
        }
      } catch (error) {
        const syncError =
          error instanceof Error ?
            new SyncError(error.message, "IMAGE_PROCESSING_ERROR") :
            new SyncError(
              "Unknown error during image processing",
              "UNKNOWN_ERROR"
            );

        metadata.status = "failed";
        metadata.errors.push(syncError.message);
        await logError(syncError.toGenericError(), "syncCards:imageProcessing");
      }
    } else {
      for (const group of groups) {
        metadata.groupsProcessed++;
        const groupProcessedCards = await processGroupProducts(
          group,
          options,
          metadata,
          existingHashes,
          imageHandler,
          logger
        );

        processedCards += groupProcessedCards;
        if (options.limit && processedCards >= options.limit) break;
      }
    }

    metadata.status =
      metadata.errors.length > 0 ? "completed_with_errors" : "success";
  } catch (error) {
    const syncError =
      error instanceof Error ?
        new SyncError(error.message, "SYNC_MAIN_ERROR") :
        new SyncError("Unknown sync error", "UNKNOWN_ERROR");

    metadata.status = "failed";
    metadata.errors.push(syncError.message);
    await logError(syncError.toGenericError(), "syncCards:main");
  }

  metadata.lastSync = new Date();
  return metadata;
}

async function processCardImages(
  card: any,
  imageHandler: ImageHandler,
  options: SyncOptions,
  metadata: SyncMetadata
): Promise<void> {
  try {
    if (card.imageUrl) {
      const result = await imageHandler.processImage(
        card.originalUrl || card.imageUrl, // Fallback to imageUrl during migration
        card.groupId.toString(),
        card.productId,
        card.cardNumber
      );

      if (result.updated) {
        metadata.imagesUpdated = (metadata.imagesUpdated || 0) + 1;
      }
      metadata.imagesProcessed = (metadata.imagesProcessed || 0) + 1;
    }
  } catch (error) {
    metadata.errors.push(
      `Failed to process image for card ${card.productId}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
