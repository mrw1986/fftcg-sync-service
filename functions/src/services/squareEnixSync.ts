import fetch from 'node-fetch';
import { logger } from '../utils/logger';
import { RetryWithBackoff } from '../utils/retry';

export interface SquareEnixCardImage {
  thumbs: string[];
  full: string[];
}

export interface SquareEnixCard {
  id: number;
  code: string;
  image: string;
  element: string[];
  rarity: string;
  cost: string;
  power: string;
  category_1: string;
  category_2: string | null;
  multicard: string;
  ex_burst: string;
  set: string[];
  name_en: string;
  type_en: string;
  job_en: string;
  text_en: string;
  images: SquareEnixCardImage;
}

export class SquareEnixSyncService {
  private readonly retry = new RetryWithBackoff();
  private readonly baseUrl = 'https://fftcg.square-enix-games.com/en';
  private sessionCookies: string | null = null;

  private async establishSession(): Promise<void> {
    try {
      logger.info('Establishing session with Square Enix card browser');
      
      const response = await this.retry.execute(() =>
        fetch(`${this.baseUrl}/card-browser`, {
          method: 'GET',
          headers: {
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'accept-language': 'en-US,en;q=0.9',
            'dnt': '1',
            'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="132", "Microsoft Edge";v="132"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'none',
            'sec-fetch-user': '?1',
            'sec-gpc': '1',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0'
          }
        })
      );

      if (!response.ok) {
        throw new Error(`Failed to establish session: ${response.status}`);
      }

      const cookies = response.headers.get('set-cookie');
      if (!cookies) {
        throw new Error('No cookies received from session establishment');
      }

      this.sessionCookies = cookies;
      logger.info('Successfully established session');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to establish session', { error: errorMessage });
      throw error;
    }
  }

  async fetchAllCards(): Promise<SquareEnixCard[]> {
    try {
      // Establish session first
      await this.establishSession();

      logger.info('Fetching cards from Square Enix API');

      const response = await this.retry.execute(() =>
        fetch(`${this.baseUrl}/get-cards`, {
          method: 'POST',
          headers: {
            'accept': '*/*',
            'accept-encoding': 'gzip, deflate, br, zstd',
            'accept-language': 'en-US,en;q=0.9',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            ...(this.sessionCookies ? { 'cookie': this.sessionCookies } : {}),
            'dnt': '1',
            'origin': this.baseUrl,
            'referer': `${this.baseUrl}/card-browser`,
            'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="132", "Microsoft Edge";v="132"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'sec-gpc': '1',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0',
            'x-requested-with': 'XMLHttpRequest'
          },
          body: JSON.stringify({
            language: 'en',
            text: '',
            type: [],
            element: [],
            cost: [],
            rarity: [],
            power: [],
            category_1: [],
            set: [],
            multicard: '',
            ex_burst: '',
            code: '',
            special: '',
            exactmatch: 0
          })
        })
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json() as { cards: SquareEnixCard[] };
      console.log('Raw API response:', data); // Log the raw response data
      
      if (!Array.isArray(data.cards)) {
        throw new Error('Invalid response format: cards array not found');
      }

      // Add incrementing ids to cards
      const cardsWithIds = data.cards.map((card, index) => ({
        ...card,
        id: index + 1
      }));

      logger.info(`Fetched ${data.cards.length} cards from Square Enix API`);
      return cardsWithIds;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to fetch cards from Square Enix API', { error: errorMessage });
      throw error;
    }
  }

  enrichCardData(tcgcsvCard: any, squareEnixCards: SquareEnixCard[]): any {
    // Find matching Square Enix card by code
    const cardNumbers = tcgcsvCard.cardNumbers || [];
    const matchingCard = squareEnixCards.find(seCard =>
      cardNumbers.some((num: string) => num === seCard.code)
    );

    if (!matchingCard) {
      return tcgcsvCard;
    }

    // Enrich with additional data
    return {
      ...tcgcsvCard,
      squareEnixData: {
        element: matchingCard.element,
        category: matchingCard.category_1,
        category2: matchingCard.category_2,
        multicard: matchingCard.multicard === '1',
        exBurst: matchingCard.ex_burst === '1',
        set: matchingCard.set,
        name: matchingCard.name_en,
        type: matchingCard.type_en,
        job: matchingCard.job_en,
        text: matchingCard.text_en,
        images: {
          thumbs: matchingCard.images.thumbs,
          full: matchingCard.images.full
        }
      }
    };
  }
}

export const squareEnixSync = new SquareEnixSyncService();
