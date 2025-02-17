import fetch from "node-fetch";
import { logger } from "../utils/logger";
import { RetryWithBackoff } from "../utils/retry";

interface SquareEnixApiResponse {
  count: number;
  cards: Array<{
    id: string;
    code: string;
    name_en: string;
    type_en: string;
    job_en: string;
    text_en: string;
    element: string[];
    rarity: string;
    cost: string;
    power: string;
    category_1: string;
    category_2?: string;
    multicard: string;
    ex_burst: string;
    set: string[];
    images: {
      thumbs: string[];
      full: string[];
    };
  }>;
}

export class SquareEnixSyncService {
  private readonly retry = new RetryWithBackoff();
  private readonly baseUrl = "https://fftcg.square-enix-games.com/en";
  private sessionCookies: string | null = null;
  private readonly elementMap: Record<string, string> = {
    火: "Fire",
    氷: "Ice",
    風: "Wind",
    土: "Earth",
    雷: "Lightning",
    水: "Water",
    光: "Light",
    闇: "Dark",
  };

  private async establishSession(): Promise<void> {
    try {
      logger.info("Establishing session with Square Enix card browser");

      const response = await this.retry.execute(() =>
        fetch(`${this.baseUrl}/card-browser`, {
          method: "GET",
          headers: {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9," + "image/webp,image/apng,*/*;q=0.8",
            "accept-encoding": "gzip, deflate, br, zstd",
            "accept-language": "en-US,en;q=0.9",
            dnt: "1",
            "sec-ch-ua": '"Not A(Brand";v="8", "Chromium";v="132", "Microsoft Edge";v="132"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
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

  private translateElements(elements: string[]): string[] {
    return elements.map((element) => this.elementMap[element] || element);
  }

  async fetchAllCards(): Promise<SquareEnixApiResponse["cards"]> {
    try {
      // Establish session first
      await this.establishSession();

      logger.info("Fetching cards from Square Enix API");

      const response = await this.retry.execute(() =>
        fetch(`${this.baseUrl}/get-cards`, {
          method: "POST",
          headers: {
            accept: "*/*",
            "accept-encoding": "gzip, deflate, br, zstd",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            ...(this.sessionCookies ? { cookie: this.sessionCookies } : {}),
            dnt: "1",
            origin: this.baseUrl,
            referer: `${this.baseUrl}/card-browser`,
            "sec-ch-ua": '"Not A(Brand";v="8", "Chromium";v="132", "Microsoft Edge";v="132"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
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

      interface SquareEnixApiResponse {
        count: number;
        cards: Array<{
          id: string;
          code: string;
          name_en: string;
          type_en: string;
          job_en: string;
          text_en: string;
          element: string[];
          rarity: string;
          cost: string;
          power: string;
          category_1: string;
          category_2?: string;
          multicard: string;
          ex_burst: string;
          set: string[];
          images: {
            thumbs: string[];
            full: string[];
          };
        }>;
      }

      const data = (await response.json()) as unknown;

      // Add more detailed validation
      if (!data || typeof data !== "object") {
        throw new Error("Invalid response format: expected object but got " + typeof data);
      }

      if (!("cards" in data)) {
        throw new Error("Invalid response format: 'cards' property not found in response");
      }

      if (!Array.isArray(data.cards)) {
        throw new Error("Invalid response format: 'cards' property is not an array");
      }

      const apiResponse = data as SquareEnixApiResponse;

      // Validate each card has required properties
      const processedCards = apiResponse.cards.map((card, index) => {
        if (!card || typeof card !== "object") {
          throw new Error(`Invalid card at index ${index}: not an object`);
        }

        // Handle Crystal cards first
        if (card.type_en === "Crystal" || card.code.startsWith("C-")) {
          return {
            ...card,
            element: ["Crystal"],
          };
        }

        // For non-Crystal cards, handle null/invalid elements
        const elements = Array.isArray(card.element) ? card.element : [];
        return {
          ...card,
          element: this.translateElements(elements),
        };
      });

      logger.info(`Fetched ${apiResponse.count} cards from Square Enix API`);
      return processedCards;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Failed to fetch cards from Square Enix API", { error: errorMessage });
      throw error;
    }
  }
}

export const squareEnixSync = new SquareEnixSyncService();
