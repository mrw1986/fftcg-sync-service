import axios, {AxiosError} from "axios";
import {db, COLLECTION, FFTCG_CATEGORY_ID} from "../config/firebase";
import {CardProduct, SyncOptions, SyncMetadata} from "../types";
import {cardCache, getCacheKey} from "../utils/cache";
import {logError, logInfo, logWarning} from "../utils/logger";
import * as crypto from "crypto";

const BASE_URL = "https://tcgcsv.com";
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
 * Synchronizes card data from TCGCSV API to Firestore
 * @param options Sync configuration options
 * @return Sync operation metadata
 */
export async function syncCards(options: SyncOptions = {}): Promise<SyncMetadata> {
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
    // Fetch groups
    const groupsResponse = await makeRequest<{ results: any[] }>(
      `${FFTCG_CATEGORY_ID}/groups`
    );
    const groups = groupsResponse.results;

    logInfo(`Found ${groups.length} groups`);

    let processedCards = 0;
    const existingHashes = new Map<string, string>();

    // Load existing hashes from Firestore
    const hashesSnapshot = await db.collection("cardHashes").get();
    hashesSnapshot.forEach((doc) => {
      existingHashes.set(doc.id, doc.data().hash);
    });

    for (const group of groups) {
      if (options.groupId && group.groupId !== options.groupId) continue;

      try {
        metadata.groupsProcessed++;
        const productsResponse = await makeRequest<{ results: CardProduct[] }>(
          `${FFTCG_CATEGORY_ID}/${group.groupId}/products`
        );
        const products = productsResponse.results;

        const groupHash = getDataHash(products);
        const existingHash = existingHashes.get(group.groupId.toString());

        if (!options.dryRun && (!existingHash || existingHash !== groupHash)) {
          metadata.groupsUpdated++;
          const batch = db.batch();

          for (const product of products) {
            if (options.limit && processedCards >= options.limit) break;

            const cardRef = db.collection(COLLECTION.CARDS)
              .doc(product.productId.toString());
            batch.set(cardRef, {
              ...product,
              lastUpdated: new Date(),
              groupHash,
            }, {merge: true});

            cardCache.set(getCacheKey("card", product.productId), product);
            processedCards++;
          }

          // Update hash
          const hashRef = db.collection("cardHashes")
            .doc(group.groupId.toString());
          batch.set(hashRef, {
            hash: groupHash,
            lastUpdated: new Date(),
          });

          await batch.commit();
          logInfo(`Updated ${products.length} cards from group ${group.groupId}`);
        } else {
          logInfo(`No updates needed for group ${group.groupId} (unchanged)`);
        }

        metadata.cardCount += products.length;
      } catch (error: any) { // Type assertion
        const errorMessage = `Error processing group ${group.groupId}: ${error?.message || "Unknown error"}`;
        metadata.errors.push(errorMessage);
        logError(error, "syncCards:processGroup");
      }

      if (options.limit && processedCards >= options.limit) break;
    }

    metadata.status = metadata.errors.length > 0 ? "completed_with_errors" : "success";
  } catch (error: any) { // Type assertion
    metadata.status = "failed";
    metadata.errors.push(error?.message || "Unknown error");
    logError(error, "syncCards:main");
  }

  metadata.lastSync = new Date();
  metadata.duration = Date.now() - startTime;

  if (!options.dryRun) {
    await db.collection(COLLECTION.SYNC_METADATA)
      .add(metadata);
  }

  return metadata;
}
