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
  PriceData,
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
  await logInfo("Fetched prices for group", {
    groupId,
    count: pricesResponse.results.length,
  });
  return pricesResponse.results;
}

/**
 * Process and organize price data
 */
function organizePriceData(prices: CardPrice[]): Map<number, PriceData> {
  const priceMap = new Map<number, PriceData>();

  for (const price of prices) {
    const existingData = priceMap.get(price.productId) || {
      lastUpdated: new Date(),
      productId: price.productId,
      cardNumber: price.cardNumber || "",
    };

    if (price.subTypeName === "Normal") {
      existingData.normal = price;
    } else if (price.subTypeName === "Foil") {
      existingData.foil = price;
    }

    priceMap.set(price.productId, existingData);
  }

  return priceMap;
}

/**
 * Generate a document ID for price data.
 */
function getPriceDocumentId(productId: number, cardNumber: string): string {
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

  await logInfo("Starting price sync", {options});

  try {
    const prices = await fetchPricesForGroup(options.groupId || "");
    const priceMap = organizePriceData(prices);
    const writeBatch = db.batch();
    let batchCount = 0;

    for (const [productId, priceData] of priceMap) {
      try {
        if (!priceData.cardNumber) {
          throw new Error(`Missing card number for product ${productId}`);
        }

        const documentId = getPriceDocumentId(productId, priceData.cardNumber);

        await logInfo("Processing price", {
          productId,
          cardNumber: priceData.cardNumber,
          documentId,
        });

        writeBatch.set(db.collection(COLLECTION.PRICES).doc(documentId), {
          ...priceData,
          lastUpdated: new Date(),
        });

        batchCount++;
        metadata.cardCount++;

        // Commit batch if it reaches the limit
        if (batchCount >= 500) {
          await writeBatch.commit();
          batchCount = 0;
        }

        // Break if limit reached
        if (options.limit && metadata.cardCount >= options.limit) {
          break;
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        metadata.errors.push(
          `Error processing price for product ${productId}: ${errorMessage}`
        );
        await logError(error as GenericError, "syncPrices");
      }
    }

    // Commit any remaining batch operations
    if (batchCount > 0) {
      await writeBatch.commit();
    }

    metadata.status =
      metadata.errors.length > 0 ? "completed_with_errors" : "success";
    await logInfo("Price sync completed", {metadata});
  } catch (error) {
    metadata.status = "failed";
    metadata.errors.push(
      error instanceof Error ? error.message : "Unknown error"
    );
    await logError(error as GenericError | GenericObject, "syncPrices");
    throw error;
  }

  return metadata;
}
