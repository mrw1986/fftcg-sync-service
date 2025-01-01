// src/services/cardSync.ts

import {makeRequest, validateAndFixDocumentId} from "../utils/syncUtils";
import {db, COLLECTION} from "../config/firebase";
import {
  CardProduct,
  SyncOptions,
  SyncMetadata,
  GenericError,
  GenericObject,
} from "../types";
import {logInfo, logError, logWarning} from "../utils/logger";
import {imageHandler} from "../utils/imageHandler";
import {FieldValue} from "firebase-admin/firestore";
import {isAxiosError} from "axios";
import {
  validateFFTCGProduct,
  isNonCardProduct,
} from "../utils/productValidation";

/**
 * Extract card number from a product.
 */
function getCardNumber(product: CardProduct): string {
  // For non-card products, use productId and add a prefix
  if (isNonCardProduct(product.name)) {
    return `P${product.productId}`; // Add 'P' prefix to distinguish from card numbers
  }

  const numberField = product.extendedData.find(
    (data) => data.name === "Number"
  );
  if (!numberField) {
    throw new Error(`Missing card number for productId: ${product.productId}`);
  }
  return numberField.value;
}

/**
 * Generate a document ID for a product.
 */
function getDocumentId(product: CardProduct): string {
  if (isNonCardProduct(product.name)) {
    // For non-card products, use productId as the base
    return product.productId.toString();
  }

  const cardNumber = getCardNumber(product);
  return validateAndFixDocumentId(product.productId, cardNumber);
}

/**
 * Handle promo cards to ensure proper document ID generation.
 */
function getPromoDocumentId(product: CardProduct): string {
  const extNumber = product.extendedData.find(
    (data) => data.name === "extNumber"
  );
  if (!extNumber) {
    throw new Error(
      `Missing extNumber for promo productId: ${product.productId}`
    );
  }

  const [promoCardNumber] = extNumber.value.split("/");
  return validateAndFixDocumentId(product.productId, promoCardNumber);
}

/**
 * Process images for a card product
 */
async function processImages(card: CardProduct): Promise<void> {
  if (!card.imageUrl) {
    await logWarning(`No image URL for card ${card.productId}`, {
      cardName: card.name,
      groupId: card.groupId,
    });
    return;
  }

  try {
    const isNonCard = isNonCardProduct(card.name);
    const cardNumber = isNonCard ?
      card.productId.toString() :
      getCardNumber(card);

    const result = await imageHandler.processAndStoreImage(
      card.imageUrl,
      card.productId,
      card.groupId.toString(),
      cardNumber,
      isNonCard
    );

    const documentId = getDocumentId(card);
    const docRef = db.collection(COLLECTION.CARDS).doc(documentId);

    // Check if document exists
    const doc = await docRef.get();

    const updateData = {
      highResUrl: result.highResUrl,
      lowResUrl: result.lowResUrl,
      imageMetadata: result.metadata,
      lastUpdated: new Date(),
      isNonCard: isNonCard,
    };

    if (card.imageUrl) {
      Object.assign(updateData, {
        imageUrl: FieldValue.delete(),
      });
    }

    if (!doc.exists) {
      // Create new document if it doesn't exist
      await docRef.set({
        ...card,
        ...updateData,
      });
    } else {
      // Update existing document
      await docRef.update(updateData);
    }

    await logInfo(
      `Processed images for ${isNonCard ? "product" : "card"} ${
        card.productId
      }`,
      {
        cardName: card.name,
        groupId: card.groupId,
        highResUrl: result.highResUrl,
        lowResUrl: result.lowResUrl,
        updated: result.updated,
        isNonCard,
      }
    );
  } catch (error) {
    await logError(
      {
        message: error instanceof Error ? error.message : "Unknown error",
        name: error instanceof Error ? error.name : "UnknownError",
        code: "IMAGE_PROCESSING_ERROR",
      },
      `Failed to process images for ${card.productId}`
    );
    throw error;
  }
}

/**
 * Fetch products for a specific group.
 */
async function fetchProductsForGroup(groupId: string): Promise<CardProduct[]> {
  const categoryId = "24"; // FFTCG category ID
  let allProducts: CardProduct[] = [];

  try {
    if (!groupId) {
      // First fetch all groups
      const groupsResponse = await makeRequest<{
        results: Array<{ groupId: string }>;
      }>(`${categoryId}/groups`);

      await logInfo("Fetched groups", {
        count: groupsResponse.results.length,
      });

      // Process all groups
      for (const group of groupsResponse.results) {
        const productsResponse = await makeRequest<{ results: CardProduct[] }>(
          `${categoryId}/${group.groupId}/products`
        );
        allProducts = allProducts.concat(productsResponse.results);
      }
    } else {
      // Fetch products for specific group
      const productsResponse = await makeRequest<{ results: CardProduct[] }>(
        `${categoryId}/${groupId}/products`
      );
      allProducts = productsResponse.results;
    }

    await logInfo("Fetched products", {
      groupId: groupId || "all",
      count: allProducts.length,
    });

    return allProducts;
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 403) {
      await logError(
        error,
        `Access denied when fetching products for group ${groupId}`
      );
      throw new Error(
        "Access denied to TCGCSV API. Please check API access and paths."
      );
    }
    throw error;
  }
}

/**
 * Main function to sync cards.
 */
export async function syncCards(
  options: SyncOptions = {}
): Promise<SyncMetadata> {
  await logInfo("Starting card sync", {
    options,
    endpoint: options.groupId ? `24/${options.groupId}/products` : "24/groups",
  });
  console.log("syncCards received options:", {
    dryRun: options.dryRun,
    limit: options.limit,
    groupId: options.groupId,
    skipImages: options.skipImages,
    imagesOnly: options.imagesOnly,
    silent: options.silent,
    force: options.force,
  });
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

  await logInfo("Starting card sync", {options});

  try {
    const products = await fetchProductsForGroup(options.groupId || "");
    const writeBatch = db.batch();
    let batchCount = 0;

    for (const card of products) {
      try {
        // Add validation check
        const validation = validateFFTCGProduct(card);
        const isNonCard = isNonCardProduct(card.name);

        // Allow both valid cards and non-card products to be processed
        if (!validation.isValid && !isNonCard) {
          await logInfo(`Skipping invalid product: ${card.name}`, {
            productId: card.productId,
            reason: validation.reason,
          });
          continue;
        }

        const documentId = card.extendedData.some(
          (data) => data.name === "extNumber"
        ) ?
          getPromoDocumentId(card) :
          getDocumentId(card);

        await logInfo("Processing card", {
          productId: card.productId,
          documentId,
          groupId: card.groupId,
          isNonCard,
        });

        // Process card data
        writeBatch.set(db.collection(COLLECTION.CARDS).doc(documentId), {
          ...card,
          lastUpdated: new Date(),
          isNonCard,
        });

        batchCount++;
        metadata.cardCount++;

        // Commit batch if it reaches the limit
        if (batchCount >= 500) {
          await writeBatch.commit();
          batchCount = 0;
        }

        // Process images if not skipped
        if (!options.skipImages && card.imageUrl) {
          metadata.imagesProcessed = (metadata.imagesProcessed || 0) + 1;
          await processImages(card);
          metadata.imagesUpdated = (metadata.imagesUpdated || 0) + 1;
        }

        // Break if limit reached
        if (options.limit && metadata.cardCount >= options.limit) {
          break;
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        metadata.errors.push(
          `Error processing card ${card.productId}: ${errorMessage}`
        );
        await logError(error as GenericError, "syncCards");
      }
    }

    // Commit any remaining batch operations
    if (batchCount > 0) {
      await writeBatch.commit();
    }

    metadata.status =
      metadata.errors.length > 0 ? "completed_with_errors" : "success";
    await logInfo("Card sync completed", {metadata});
  } catch (error) {
    metadata.status = "failed";
    metadata.errors.push(
      error instanceof Error ? error.message : "Unknown error"
    );
    await logError(error as GenericError | GenericObject, "syncCards");
    throw error;
  }

  return metadata;
}
