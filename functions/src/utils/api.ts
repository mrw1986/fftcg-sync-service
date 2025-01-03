import axios, { AxiosError } from "axios";
import { CardProduct, CardPrice } from "../types";
import { logger } from "./logger";

export class TcgcsvApi {
  private readonly baseUrl = "https://tcgcsv.com/tcgplayer";
  private readonly categoryId = "24"; // Final Fantasy TCG

  private async makeRequest<T>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}/${endpoint}`;
    logger.info(`Making request to: ${url}`);

    try {
      const response = await axios.get<T>(url, {
        timeout: 30000,
        headers: {
          "Accept": "application/json",
          "User-Agent": "FFTCG-Sync-Service/1.0",
        },
      });
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 403) {
        throw new Error(`Access denied to TCGCSV API at path: ${endpoint}`);
      }
      throw error;
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
    interface PriceResponse {
      results: {
        productId: number;
        timestamp: string;
        normal?: {
          directLowPrice: number | null;
          highPrice: number;
          lowPrice: number;
          marketPrice: number;
          midPrice: number;
        };
        foil?: {
          directLowPrice: number | null;
          highPrice: number;
          lowPrice: number;
          marketPrice: number;
          midPrice: number;
        };
      }[];
    }

    const response = await this.makeRequest<PriceResponse>(`${this.categoryId}/${groupId}/prices`);
    logger.info(`Retrieved ${response.results.length} prices for group ${groupId}`);

    return response.results.map((price) => ({
      productId: price.productId,
      lastUpdated: new Date(price.timestamp),
      ...(price.normal && {
        normal: {
          directLowPrice: price.normal.directLowPrice,
          highPrice: price.normal.highPrice,
          lowPrice: price.normal.lowPrice,
          marketPrice: price.normal.marketPrice,
          midPrice: price.normal.midPrice,
          subTypeName: "Normal",
        },
      }),
      ...(price.foil && {
        foil: {
          directLowPrice: price.foil.directLowPrice,
          highPrice: price.foil.highPrice,
          lowPrice: price.foil.lowPrice,
          marketPrice: price.foil.marketPrice,
          midPrice: price.foil.midPrice,
          subTypeName: "Foil",
        },
      }),
    }));
  }
}

export const tcgcsvApi = new TcgcsvApi();
