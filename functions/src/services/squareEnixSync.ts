import fetch from "node-fetch";
import { logger } from "../utils/logger";
import { RetryWithBackoff } from "../utils/retry";

export class SquareEnixSyncService {
  private readonly retry = new RetryWithBackoff();
  private readonly baseUrl = "https://fftcg.square-enix-games.com/en";
  private sessionCookies: string | null = null;

  private async establishSession(): Promise<void> {
    try {
      logger.info("Establishing session with Square Enix card browser");

      const response = await this.retry.execute(() =>
        fetch(`${this.baseUrl}/card-browser`, {
          method: "GET",
          headers: {
            "accept": 
              "text/html,application/xhtml+xml,application/xml;q=0.9," + 
              "image/webp,image/apng,*/*;q=0.8",
            "accept-encoding": "gzip, deflate, br, zstd",
            "accept-language": "en-US,en;q=0.9",
            "dnt": "1",
            "sec-ch-ua": "\"Not A(Brand\";v=\"8\", \"Chromium\";v=\"132\", \"Microsoft Edge\";v=\"132\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"Windows\"",
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "none",
            "sec-fetch-user": "?1",
            "sec-gpc": "1",
            "user-agent": 
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " + 
              "(KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0",
          },
        })
      );

      if (!response.ok) {
        throw new Error(`Failed to establish session: ${response.status}`);
      }

      const cookies = response.headers.get("set-cookie");
      if (!cookies) {
        throw new Error("No cookies received from session establishment");
      }

      this.sessionCookies = cookies;
      logger.info("Successfully established session");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Failed to establish session", { error: errorMessage });
      throw error;
    }
  }

  async fetchAllCards(): Promise<any[]> {
    try {
      // Establish session first
      await this.establishSession();

      logger.info("Fetching cards from Square Enix API");

      const response = await this.retry.execute(() =>
        fetch(`${this.baseUrl}/get-cards`, {
          method: "POST",
          headers: {
            "accept": "*/*",
            "accept-encoding": "gzip, deflate, br, zstd",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            ...(this.sessionCookies ? { "cookie": this.sessionCookies } : {}),
            "dnt": "1",
            "origin": this.baseUrl,
            "referer": `${this.baseUrl}/card-browser`,
            "sec-ch-ua": "\"Not A(Brand\";v=\"8\", \"Chromium\";v=\"132\", \"Microsoft Edge\";v=\"132\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"Windows\"",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "sec-gpc": "1",
            "user-agent": 
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " + 
              "(KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0",
            "x-requested-with": "XMLHttpRequest",
          },
          body: JSON.stringify({
            language: "en",
            text: "",
            type: [],
            element: [],
            cost: [],
            rarity: [],
            power: [],
            category_1: [],
            set: [],
            multicard: "",
            ex_burst: "",
            code: "",
            special: "",
            exactmatch: 0,
          }),
        })
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json() as { count: number; cards: any[] };
      
      if (!Array.isArray(data.cards)) {
        throw new Error("Invalid response format: cards array not found");
      }

      logger.info(`Fetched ${data.count} cards from Square Enix API`);
      return data.cards;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Failed to fetch cards from Square Enix API", { error: errorMessage });
      throw error;
    }
  }
}

export const squareEnixSync = new SquareEnixSyncService();
