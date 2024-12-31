import axios, {AxiosError} from "axios";
import {logWarning} from "./logger";

// Centralized constants
export const BASE_URL = "https://tcgcsv.com/tcgplayer";
export const MAX_RETRIES = 3;
export const BASE_DELAY = 1000;

/**
 * Validates and constructs full paths for TCGCSV requests.
 */
export function constructTCGCSVPath(endpoint: string): string {
  if (!endpoint.startsWith("/tcgplayer")) {
    throw new Error(
      `Invalid path: ${endpoint}. All paths must start with /tcgplayer.`
    );
  }
  return `${BASE_URL}${endpoint}`;
}

/**
 * Validates and fixes document IDs, including promo cards.
 */
export function validateAndFixDocumentId(
  productId: number,
  cardNumber: string
): string {
  if (!productId || !cardNumber) {
    throw new Error(
      "Missing productId or cardNumber for document ID generation."
    );
  }

  const sanitizedCardNumber = cardNumber.replace(/\//g, "_");
  return `${productId}_${sanitizedCardNumber}`;
}

/**
 * Handles network requests with retries.
 */
export async function makeRequest<T>(
  endpoint: string,
  options: { retryCount?: number; customDelay?: number } = {}
): Promise<T> {
  const {retryCount = 0, customDelay = BASE_DELAY} = options;

  try {
    const url = constructTCGCSVPath(endpoint);
    await new Promise((resolve) => setTimeout(resolve, customDelay));
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
        endpoint,
        attempt: retryCount + 1,
        maxRetries: MAX_RETRIES,
        error: error.message,
      });
      return makeRequest<T>(endpoint, {
        retryCount: retryCount + 1,
        customDelay: delay,
      });
    }
    throw error;
  }
}

export async function processBatch<T>(
  items: T[],
  processFn: (batch: T[]) => Promise<void>,
  options: {
    batchSize?: number;
    onBatchComplete?: (stats: {
      processed: number;
      total: number;
    }) => Promise<void>;
  } = {}
): Promise<void> {
  const batchSize = options.batchSize || 500; // Default batch size
  const totalItems = items.length;

  for (let i = 0; i < totalItems; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await processFn(batch);

    if (options.onBatchComplete) {
      await options.onBatchComplete({
        processed: i + batch.length,
        total: totalItems,
      });
    }
  }
}
