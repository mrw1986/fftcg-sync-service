import axios, {AxiosError} from "axios";
import {logWarning} from "./logger";
import {BatchProcessingStats} from "../types";

export const MAX_RETRIES = 3;
export const BASE_DELAY = 1000;

export interface RequestOptions {
  retryCount?: number;
  customDelay?: number;
  metadata?: Record<string, unknown>;
}

export function sanitizeDocumentId(productId: number | string, cardNumber: string): string {
  const sanitizedCardNumber = cardNumber.replace(/\//g, "_");
  return `${productId}_${sanitizedCardNumber}`;
}

export async function makeRequest<T>(
  endpoint: string,
  baseUrl: string,
  options: RequestOptions = {}
): Promise<T> {
  const {retryCount = 0, customDelay = BASE_DELAY} = options;

  try {
    await new Promise((resolve) => setTimeout(resolve, customDelay));
    const url = `${baseUrl}/${endpoint}`;
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
        url: `${baseUrl}/${endpoint}`,
        attempt: retryCount + 1,
        maxRetries: MAX_RETRIES,
        error: error.message,
        ...options.metadata,
      });

      return makeRequest<T>(endpoint, baseUrl, {
        ...options,
        retryCount: retryCount + 1,
        customDelay: delay,
      });
    }
    throw error;
  }
}

export interface BatchOptions {
  batchSize?: number;
  onBatchComplete?: (stats: BatchProcessingStats) => Promise<void>;
}

export async function processBatch<T>(
  items: T[],
  processor: (batch: T[]) => Promise<void>,
  options: BatchOptions = {}
): Promise<void> {
  const {batchSize = 500, onBatchComplete} = options;

  let processedCount = 0;
  const totalBatches = Math.ceil(items.length / batchSize);

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const currentBatch = Math.floor(i / batchSize) + 1;

    await processor(batch);
    processedCount += batch.length;

    if (onBatchComplete) {
      await onBatchComplete({
        total: items.length,
        processed: processedCount,
        successful: processedCount,
        failed: 0,
        skipped: 0,
      });
    }

    console.log(
      `Processing batch ${currentBatch}/${totalBatches} (${processedCount}/${items.length} items)`
    );

    if (i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
