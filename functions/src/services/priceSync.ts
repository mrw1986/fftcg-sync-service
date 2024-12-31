import {
  constructTCGCSVPath,
  makeRequest,
  validateAndFixDocumentId,
} from "../utils/syncUtils";
import {db, COLLECTION} from "../config/firebase";
import {
  CardPrice,
  SyncOptions,
  SyncMetadata,
  GenericError,
  GenericObject,
} from "../types";
import {logInfo, logError} from "../utils/logger";

/**
 * Fetch prices for a specific group.
 */
async function fetchPricesForGroup(groupId: string): Promise<CardPrice[]> {
  const endpoint = `/${COLLECTION.CARDS}/${groupId}/prices`;
  const pricesResponse = await makeRequest<{ results: CardPrice[] }>(
    constructTCGCSVPath(endpoint)
  );
  logInfo("Fetched prices for group", {
    groupId,
    count: pricesResponse.results.length,
  });
  return pricesResponse.results;
}

/**
 * Generate a document ID for price data.
 */
function getDocumentIdForPrice(productId: number, cardNumber: string): string {
  return validateAndFixDocumentId(productId, cardNumber);
}

/**
 * Main function to sync prices.
 */
export async function syncPrices(
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

  logInfo("Starting price sync", {options});

  try {
    const prices = await fetchPricesForGroup(options.groupId || "");
    const writeBatch = db.batch();

    for (const price of prices) {
      const cardNumber = (price as any).cardNumber || "unknown"; // Using fallback if cardNumber is missing
      const documentId = getDocumentIdForPrice(price.productId, cardNumber);

      logInfo("Processing price", {
        productId: price.productId,
        cardNumber,
        documentId,
      });

      writeBatch.set(db.collection(COLLECTION.PRICES).doc(documentId), price);
      metadata.cardCount++;
    }

    await writeBatch.commit();

    metadata.status = "success";
    logInfo("Price sync completed successfully", {metadata});
  } catch (error) {
    metadata.status = "failed";
    metadata.errors.push(
      error instanceof Error ? error.message : "Unknown error"
    );
    logError(error as GenericError | GenericObject, "syncPrices");
  }

  return metadata;
}
