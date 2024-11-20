import axios, {AxiosError} from "axios";
import {db, COLLECTION, FFTCG_CATEGORY_ID, BASE_URL} from "../config/firebase";
import {CardPrice, SyncOptions, SyncMetadata, PriceData} from "../types";
import {logError, logInfo, logWarning} from "../utils/logger";
import {ProgressTracker} from "../utils/progress";
import * as crypto from "crypto";

const MAX_RETRIES = 3;

/**
 * Makes an HTTP request with retry logic
 * @param endpoint API endpoint to request
 * @param retryCount Current retry attempt number
 * @return Promise with the response data
 */
async function makeRequest<T>(endpoint: string, retryCount = 0): Promise<T> {
  try {
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Rate limiting
    const url = `${BASE_URL}/${endpoint}`;
    await logInfo(`Making request to: ${url}`, {
      attempt: retryCount + 1,
      maxRetries: MAX_RETRIES,
      endpoint,
    });

    const response = await axios.get<T>(url);
    return response.data;
  } catch (error) {
    if (retryCount < MAX_RETRIES - 1 && error instanceof AxiosError) {
      const delay = Math.pow(2, retryCount) * 1000;
      await logWarning(`Request failed, retrying in ${delay}ms...`, {
        error: error.message,
        url: `${BASE_URL}/${endpoint}`,
        attempt: retryCount + 1,
        maxRetries: MAX_RETRIES,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
      return makeRequest<T>(endpoint, retryCount + 1);
    }
    throw error;
  }
}

/**
 * Generates a hash of data for comparison
 * @param data Data to hash
 * @return MD5 hash string
 */
function getDataHash(data: any): string {
  return crypto.createHash("md5")
    .update(JSON.stringify(data, Object.keys(data).sort()))
    .digest("hex");
}

/**
 * Processes raw price data into a structured format
 * @param prices Array of raw price data
 * @return Processed price data map
 */
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

/**
* Synchronizes price data from TCGCSV API to Firestore
* @param options Sync configuration options
* @return Sync operation metadata
*/
export async function syncPrices(options: SyncOptions = {}): Promise<SyncMetadata> {
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
    // If specific productId is provided, fetch just that group
    if (options.productId) {
      const card = await db.collection(COLLECTION.CARDS)
        .doc(options.productId.toString())
        .get();

      if (!card.exists) {
        throw new Error(`Card with ID ${options.productId} not found`);
      }

      const cardData = card.data();
      options.groupId = cardData?.groupId?.toString();
    }

    // Fetch groups or use specific group
    const groupsResponse = await makeRequest<{ results: any[] }>(
      `${FFTCG_CATEGORY_ID}/groups`
    );
    const groups = groupsResponse.results;

    if (options.groupId) {
      const group = groups.find((g) => g.groupId.toString() === options.groupId);
      if (!group) {
        throw new Error(`Group ${options.groupId} not found`);
      }
      groups.length = 0;
      groups.push(group);
    }

    const progress = new ProgressTracker(groups.length, "Processing groups");

    for (const group of groups) {
      try {
        metadata.groupsProcessed++;
        const pricesResponse = await makeRequest<{ results: CardPrice[] }>(
          `${FFTCG_CATEGORY_ID}/${group.groupId}/prices`
        );
        const prices = pricesResponse.results;

        if (options.productId) {
          const filteredPrices = prices.filter((p) => p.productId === options.productId);
          if (filteredPrices.length === 0) {
            throw new Error(`No prices found for product ${options.productId}`);
          }
          prices.length = 0;
          prices.push(...filteredPrices);
        }

        const priceHash = getDataHash(prices);
        const hashDoc = await db.collection(COLLECTION.PRICE_HASHES)
          .doc(group.groupId.toString())
          .get();

        const existingHash = hashDoc.exists ? hashDoc.data()?.hash : null;

        if (!options.dryRun && (!existingHash || existingHash !== priceHash)) {
          metadata.groupsUpdated++;
          const batch = db.batch();
          const processedPrices = processPrices(prices);

          for (const [productId, priceData] of Object.entries(processedPrices)) {
            if (options.limit && metadata.cardCount >= options.limit) break;

            const priceRef = db.collection(COLLECTION.PRICES)
              .doc(productId);
            batch.set(priceRef, priceData, {merge: true});

            metadata.cardCount++;
          }

          // Update hash
          const hashRef = db.collection(COLLECTION.PRICE_HASHES)
            .doc(group.groupId.toString());
          batch.set(hashRef, {
            hash: priceHash,
            lastUpdated: new Date(),
          });

          await batch.commit();
          await logInfo(`Updated ${metadata.cardCount} prices from group ${group.groupId}`);
        } else {
          await logInfo(`No updates needed for group ${group.groupId} (unchanged)`);
        }
      } catch (error: any) {
        const errorMessage = `Error processing group ${group.groupId}: ${error?.message || "Unknown error"}`;
        metadata.errors.push(errorMessage);
        await logError(error, "syncPrices:processGroup");
      }

      progress.update();

      if (options.limit && metadata.cardCount >= options.limit) break;
    }

    metadata.status = metadata.errors.length > 0 ? "completed_with_errors" : "success";
  } catch (error: any) {
    metadata.status = "failed";
    metadata.errors.push(error?.message || "Unknown error");
    await logError(error, "syncPrices:main");
  }

  metadata.lastSync = new Date();
  metadata.duration = Date.now() - startTime;

  if (!options.dryRun) {
    await db.collection(COLLECTION.SYNC_METADATA)
      .add(metadata);
  }

  return metadata;
}
