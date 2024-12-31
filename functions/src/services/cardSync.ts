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
import {logInfo, logError} from "../utils/logger";

/**
 * Fetch products for a specific group.
 */
async function fetchProductsForGroup(groupId: string): Promise<CardProduct[]> {
  const endpoint = `/${COLLECTION.CARDS}/${groupId}/products`;
  const productsResponse = await makeRequest<{ results: CardProduct[] }>(
    constructTCGCSVPath(endpoint)
  );
  logInfo("Fetched products for group", {
    groupId,
    count: productsResponse.results.length,
  });
  return productsResponse.results;
}

/**
 * Generate a document ID for a product.
 */
function getDocumentId(product: CardProduct): string {
  const cardNumber = getCardNumber(product);
  return validateAndFixDocumentId(product.productId, cardNumber);
}

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
  };

  logInfo("Starting card sync", {options});

  try {
    const groups = await fetchProductsForGroup(options.groupId || "");
    const writeBatch = db.batch();

    for (const group of groups) {
      const documentId = group.extendedData.some(
        (data) => data.name === "extNumber"
      ) ?
        getPromoDocumentId(group) :
        getDocumentId(group);

      logInfo("Processing card", {
        productId: group.productId,
        documentId,
        groupId: group.groupId,
      });

      writeBatch.set(db.collection(COLLECTION.CARDS).doc(documentId), group);
      metadata.cardCount++;
    }

    await writeBatch.commit();

    metadata.status = "success";
    logInfo("Card sync completed successfully", {metadata});
  } catch (error) {
    metadata.status = "failed";
    metadata.errors.push(
      error instanceof Error ? error.message : "Unknown error"
    );
    logError(error as GenericError | GenericObject, "syncCards");
  }

  return metadata;
}
