import * as admin from "firebase-admin";

const app = !admin.apps.length ? admin.initializeApp() : admin.app();
const db = admin.firestore(app);

// Enable ignoreUndefinedProperties and other settings
db.settings({
  ignoreUndefinedProperties: true,
  timestampsInSnapshots: true,
});

const storage = admin.storage(app);

export {db, storage}; // Export storage as well

export const COLLECTION = {
  CARDS: "cards",
  PRICES: "prices",
  SYNC_METADATA: "syncMetadata",
  LOGS: "logs",
  CARD_HASHES: "cardHashes",
  PRICE_HASHES: "priceHashes",
};

export const STORAGE = {
  BUCKETS: {
    CARD_IMAGES: "card-images",
  },
  PATHS: {
    IMAGES: "images",
  },
};

export const BASE_URL = "https://tcgcsv.com";
export const FFTCG_CATEGORY_ID = "24";

export const runtimeOpts = {
  timeoutSeconds: 540,
  memory: "1GiB", // Changed from "1GB" to "1GiB"
} as const;
