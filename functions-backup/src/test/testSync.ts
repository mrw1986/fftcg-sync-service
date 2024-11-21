// src/test/testSync.ts

import axios, {isAxiosError} from "axios";

const PROJECT_ID = "fftcg-sync-service";
const REGION = "us-central1";
const BASE_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

interface SyncResponse {
  lastSync: Date;
  status: string;
  cardCount: number;
  type: string;
  groupsProcessed: number;
  groupsUpdated: number;
  errors: string[];
  duration?: number;
}

async function testSync() {
  try {
    console.log("Testing Card Sync...");
    const cardResponse = await axios.get<SyncResponse>(`${BASE_URL}/testCardSync`, {
      params: {
        limit: 5, // Only sync 5 cards for testing
        dryRun: false,
      },
    });
    console.log("Card Sync Response:", JSON.stringify(cardResponse.data, null, 2));

    console.log("\nTesting Price Sync...");
    const priceResponse = await axios.get<SyncResponse>(`${BASE_URL}/testPriceSync`, {
      params: {
        groupId: "22894", // Boss Deck: Final Fantasy VII
        dryRun: false,
      },
    });
    console.log("Price Sync Response:", JSON.stringify(priceResponse.data, null, 2));
  } catch (error) {
    if (isAxiosError(error)) {
      console.error("Error:", error.response?.data || error.message);
    } else {
      console.error("Error:", error);
    }
  }
}

// Run the test
testSync().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
