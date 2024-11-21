import axios, {isAxiosError} from "axios";
import {SyncOptions, SyncMetadata} from "../types";

const PROJECT_ID = "fftcg-sync-service";
const REGION = "us-central1";
const BASE_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

async function runSyncTest(
  endpoint: string,
  options: SyncOptions,
  description: string
): Promise<SyncMetadata> {
  console.log(`\nTesting ${description}...`);

  try {
    const response = await axios.get<SyncMetadata>(`${BASE_URL}/${endpoint}`, {
      params: options,
    });
    return response.data;
  } catch (error) {
    if (isAxiosError(error)) {
      console.error(`${description} failed:`, error.response?.data || error.message);
      throw error;
    }
    throw error;
  }
}

async function testSync() {
  try {
    // Test manual card sync
    const cardSyncResult = await runSyncTest("testCardSync", {
      limit: 5,
      dryRun: true,
      groupId: "23783",
    }, "Card Sync");

    console.log("Card Sync Results:", JSON.stringify(cardSyncResult, null, 2));

    // Test manual price sync
    const priceSyncResult = await runSyncTest("testPriceSync", {
      groupId: "23783",
      dryRun: true,
      limit: 5,
    }, "Price Sync");

    console.log("Price Sync Results:", JSON.stringify(priceSyncResult, null, 2));

    // Test full sync (if needed)
    if (process.env.TEST_FULL_SYNC === "true") {
      console.log("\nTesting full sync...");

      const fullSyncResult = await runSyncTest("manualCardSync", {
        dryRun: true,
      }, "Full Sync");

      console.log("Full Sync Results:", JSON.stringify(fullSyncResult, null, 2));
    }
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }
}

// Execute the test
console.log("Starting sync tests...");
testSync().then(() => {
  console.log("\nAll sync tests completed successfully!");
}).catch(console.error);
