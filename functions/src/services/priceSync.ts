import {makeRequest, validateAndFixDocumentId} from "../utils/syncUtils";
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
import {isAxiosError} from "axios";
import {historicalPriceSync} from "./historicalPriceSync";

/**
 * Fetch prices for a specific group.
 */
export async function fetchPricesForGroup(
  groupId: string
): Promise<CardPrice[]> {
  const categoryId = "24"; // FFTCG category ID
  let allPrices: CardPrice[] = [];

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
        const pricesResponse = await makeRequest<{ results: CardPrice[] }>(
          `${categoryId}/${group.groupId}/prices`
        );
        allPrices = allPrices.concat(pricesResponse.results);
      }
    } else {
      // Fetch prices for specific group
      const pricesResponse = await makeRequest<{ results: CardPrice[] }>(
        `${categoryId}/${groupId}/prices`
      );
      allPrices = pricesResponse.results;
    }

    await logInfo("Fetched prices", {
      groupId: groupId || "all",
      count: allPrices.length,
    });

    return allPrices;
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 403) {
      await logError(
        error,
        `Access denied when fetching prices for group ${groupId}`
      );
      throw new Error(
        "Access denied to TCGCSV API. Please check API access and paths."
      );
    }
    throw error;
  }
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
 * Main function to sync prices.
 */
export async function syncPrices(
  options: SyncOptions = {}
): Promise<SyncMetadata> {
  await logInfo("Starting price sync", {
    options,
    endpoint: options.groupId ? `24/${options.groupId}/prices` : "24/groups",
  });
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
        const documentId = validateAndFixDocumentId(
          productId,
          productId.toString()
        );

        await logInfo("Processing price", {
          productId,
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

        // Save historical data after processing current prices
        await historicalPriceSync.saveDailyPrices(prices);
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
