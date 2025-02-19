// src/config/firebase.ts
import * as admin from "firebase-admin";

const app = !admin.apps.length ? admin.initializeApp() : admin.app();
const db = admin.firestore(app);

// Enable settings for better performance and reliability
db.settings({
  ignoreUndefinedProperties: true,
  timestampsInSnapshots: true,
  minimumBackoffSeconds: 10,
  maximumBackoffSeconds: 60,
  longPollingOptions: {
    maxRetries: 5,
    backoffMultiplier: 1.5,
    initialDelayMs: 1000,
    maxDelayMs: 60000,
  },
});

export { db };

export const COLLECTION = {
  CARDS: "cards",
  PRICES: "prices",
  SYNC_METADATA: "syncMetadata",
  LOGS: "logs",
  CARD_HASHES: "cardHashes",
  PRICE_HASHES: "priceHashes",
  IMAGE_METADATA: "imageMetadata",
  HISTORICAL_PRICES: "historicalPrices",
  CARD_DELTAS: "cardDeltas",
  PRICE_DELTAS: "priceDeltas",
  GROUPS: "groups",
  GROUP_HASHES: "groupHashes",
  SYNC_STATE: "syncState",
  SQUARE_ENIX_CARDS: "squareEnixCards",
  SQUARE_ENIX_HASHES: "squareEnixHashes",
  SQUARE_ENIX_DELTAS: "squareEnixDeltas",
  SEARCH_HASHES: "searchHashes",
  FILTERS: "filters",
  FILTER_HASHES: "filterHashes",
} as const;

export const BASE_URL = "https://tcgcsv.com/tcgplayer";
export const FFTCG_CATEGORY_ID = "24";

export const runtimeOpts = {
  timeoutSeconds: 540,
  memory: "1GiB",
} as const;
