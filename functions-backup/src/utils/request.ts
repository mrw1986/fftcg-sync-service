import axios, {AxiosError} from "axios";
import {logWarning} from "./logger";

export const MAX_RETRIES = 3;
export const BASE_DELAY = 1000; // 1 second

export interface RequestOptions {
  retryCount?: number;
  customDelay?: number;
  metadata?: Record<string, unknown>;
}

export class RequestError extends Error {
  constructor(
    message: string,
    public originalError: Error,
    public context: string,
    public metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = "RequestError";
  }
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
      timeout: 30000, // 30 seconds timeout
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

    throw new RequestError(
      `Request failed after ${retryCount + 1} attempts`,
      error as Error,
      endpoint,
      options.metadata
    );
  }
}
