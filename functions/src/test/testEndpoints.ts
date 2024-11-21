import axios, {isAxiosError} from "axios";

const FIREBASE_REGION = "us-central1";
const PROJECT_ID = "fftcg-sync-service";
const BASE_URL = `https://${FIREBASE_REGION}-${PROJECT_ID}.cloudfunctions.net`;

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

async function testEndpoints() {
  try {
    // Test card sync
    console.log("\nTesting card sync...");
    const cardResponse = await axios.get<SyncResponse>(`${BASE_URL}/testCardSync`, {
      params: {
        limit: 5,
        dryRun: true,
        groupId: "23783", // Example group ID
      },
    });
    console.log("Card sync results:", JSON.stringify(cardResponse.data, null, 2));

    // Test price sync
    console.log("\nTesting price sync...");
    const priceResponse = await axios.get<SyncResponse>(`${BASE_URL}/testPriceSync`, {
      params: {
        groupId: "23783", // Example group ID
        dryRun: true,
        limit: 5,
      },
    });
    console.log("Price sync results:", JSON.stringify(priceResponse.data, null, 2));

    // Test health check
    console.log("\nTesting health check...");
    const healthResponse = await axios.get(`${BASE_URL}/healthCheck`);
    console.log("Health check response:", JSON.stringify(healthResponse.data, null, 2));
  } catch (error) {
    if (isAxiosError(error)) {
      console.error("Test failed:", error.response?.data || error.message);
      console.error("Status:", error.response?.status);
      console.error("Headers:", error.response?.headers);
    } else {
      console.error("Test failed:", error);
    }
    process.exit(1);
  }
}

// Execute tests
console.log("Starting endpoint tests...");
testEndpoints().then(() => {
  console.log("All tests completed!");
}).catch(console.error);
