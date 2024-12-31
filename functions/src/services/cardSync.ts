import {
  constructTCGCSVPath,
  makeRequest,
  validateAndFixDocumentId,
} from "../utils/syncUtils";
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

/**
 * Extract card number from a product.
 */
function getCardNumber(product: CardProduct): string {
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
    const result = await imageHandler.processImage(
      card.imageUrl,
      card.groupId.toString(),
      card.productId,
      getCardNumber(card)
    );

    // Update Firestore document with R2 image URLs
    await db.collection(COLLECTION.CARDS).doc(getDocumentId(card)).update({
      highResUrl: result.highResUrl,
      lowResUrl: result.lowResUrl,
      imageMetadata: result.metadata,
      lastUpdated: new Date(),
      imageUrl: FieldValue.delete(), // Remove old TCGPlayer URL
    });

    await logInfo(`Processed images for card ${card.productId}`, {
      cardName: card.name,
      groupId: card.groupId,
      highResUrl: result.highResUrl,
      lowResUrl: result.lowResUrl,
      updated: result.updated,
    });
  } catch (error) {
    await logError(
      error as GenericError,
      `Failed to process images for card ${card.productId}`
    );
    throw error;
  }
}

/**
 * Fetch products for a specific group.
 */
async function fetchProductsForGroup(groupId: string): Promise<CardProduct[]> {
  const endpoint = `/${COLLECTION.CARDS}/${groupId}/products`;
  const productsResponse = await makeRequest<{ results: CardProduct[] }>(
    constructTCGCSVPath(endpoint)
  );
  await logInfo("Fetched products for group", {
    groupId,
    count: productsResponse.results.length,
  });
  return productsResponse.results;
}

/**
 * Main function to sync cards.
 */
export async function syncCards(
  options: SyncOptions = {}
): Promise<SyncMetadata> {
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
    const groups = await fetchProductsForGroup(options.groupId || "");
    const writeBatch = db.batch();
    let batchCount = 0;

    for (const card of groups) {
      try {
        const documentId = card.extendedData.some(
          (data) => data.name === "extNumber"
        ) ?
          getPromoDocumentId(card) :
          getDocumentId(card);

        await logInfo("Processing card", {
          productId: card.productId,
          documentId,
          groupId: card.groupId,
        });

        // Process card data
        writeBatch.set(db.collection(COLLECTION.CARDS).doc(documentId), {
          ...card,
          lastUpdated: new Date(),
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
