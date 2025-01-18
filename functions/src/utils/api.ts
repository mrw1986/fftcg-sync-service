// src/utils/api.ts
import axios, { AxiosError } from "axios";
import { CardProduct, CardPrice } from "../types";
import { logger } from "./logger";
import { Cache } from "./cache";
import { RateLimiter } from "./rateLimiter";
import { RetryWithBackoff } from "./retry";

export class TcgcsvApi {
  private readonly baseUrl = "https://tcgcsv.com/tcgplayer";
  private readonly categoryId = "24"; // Final Fantasy TCG
  private readonly requestQueue = new Map<string, Promise<unknown>>();
  private readonly resultCache = new Cache<unknown>(5); // 5-minute cache
  private readonly rateLimiter = new RateLimiter();
  private readonly retry = new RetryWithBackoff();

  private async _makeRequest<T>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}/${endpoint}`;
    logger.info(`Making request to: ${url}`);

    return this.rateLimiter.add(async () => {
      try {
        const response = await this.retry.execute(() =>
          axios.get<T>(url, {
            timeout: 30000,
            headers: {
              "Accept": "application/json",
              "User-Agent": "FFTCG-Sync-Service/1.0",
            },
          })
        );
        return response.data;
      } catch (error) {
        if (error instanceof AxiosError && error.response?.status === 403) {
          throw new Error(`Access denied to TCGCSV API at path: ${endpoint}`);
        }
        throw error;
      }
    });
  }

  private async makeRequest<T>(endpoint: string): Promise<T> {
    const cacheKey = `api_${endpoint}`;
    const cached = this.resultCache.get(cacheKey);
    if (cached) {
      logger.info(`Cache hit for ${endpoint}`);
      return cached as T;
    }

    const existing = this.requestQueue.get(endpoint);
    if (existing) {
      logger.info(`Using existing request for ${endpoint}`);
      return existing as Promise<T>;
    }

    const promise = this._makeRequest<T>(endpoint);
    this.requestQueue.set(endpoint, promise);

    try {
      const result = await promise;
      this.resultCache.set(cacheKey, result);
      return result;
    } finally {
      this.requestQueue.delete(endpoint);
    }
  }

  async getGroups(): Promise<Array<{ groupId: string }>> {
    const response = await this.makeRequest<{ results: Array<{ groupId: string }> }>(`${this.categoryId}/groups`);
    logger.info(`Retrieved ${response.results.length} groups`);
    return response.results;
  }

  async getGroupProducts(groupId: string): Promise<CardProduct[]> {
    const response = await this.makeRequest<{ results: CardProduct[] }>(`${this.categoryId}/${groupId}/products`);
    logger.info(`Retrieved ${response.results.length} products for group ${groupId}`);
    return response.results;
  }

  async getGroupPrices(groupId: string): Promise<CardPrice[]> {
    interface RawPriceData {
      productId: number;
      lowPrice: number | null;
      midPrice: number | null;
      highPrice: number | null;
      marketPrice: number | null;
      directLowPrice: number | null;
      subTypeName: string;
    }

    interface PriceResponse {
      success: boolean;
      errors: string[];
      results: RawPriceData[];
    }

    const response = await this.makeRequest<PriceResponse>(`${this.categoryId}/${groupId}/prices`);
    logger.info(`Retrieved ${response.results.length} prices for group ${groupId}`);

    const priceMap = new Map<number, CardPrice>();

    response.results.forEach((price) => {
      const existing = priceMap.get(price.productId) || {
        productId: price.productId,
        lastUpdated: new Date(),
      };

      if (price.subTypeName === "Normal") {
        existing.normal = {
          directLowPrice: price.directLowPrice,
          highPrice: price.highPrice || 0,
          lowPrice: price.lowPrice || 0,
          marketPrice: price.marketPrice || 0,
          midPrice: price.midPrice || 0,
          subTypeName: "Normal",
        };
      } else if (price.subTypeName === "Foil") {
        existing.foil = {
          directLowPrice: price.directLowPrice,
          highPrice: price.highPrice || 0,
          lowPrice: price.lowPrice || 0,
          marketPrice: price.marketPrice || 0,
          midPrice: price.midPrice || 0,
          subTypeName: "Foil",
        };
      }

      priceMap.set(price.productId, existing);
    });

    return Array.from(priceMap.values());
  }
}

export const tcgcsvApi = new TcgcsvApi();
