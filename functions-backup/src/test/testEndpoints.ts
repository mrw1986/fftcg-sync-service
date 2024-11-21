import axios, {isAxiosError} from "axios";

const FIREBASE_REGION = "us-central1";
const PROJECT_ID = "fftcg-sync-service";

const BASE_URL = `https://${FIREBASE_REGION}-${PROJECT_ID}.cloudfunctions.net`;

async function testEndpoints() {
  try {
    // Test card sync with a small batch
    console.log("\nTesting card sync...");
    const cardResponse = await axios.get(`${BASE_URL}/testCardSync`, {
      params: {
        limit: 5,
        dryRun: false,
      },
    });
    console.log("Card sync response:", JSON.stringify(cardResponse.data, null, 2));

    // Test price sync with a specific group
    console.log("\nTesting price sync...");
    const priceResponse = await axios.get(`${BASE_URL}/testPriceSync`, {
      params: {
        groupId: "22894", // Boss Deck: Final Fantasy VII
        dryRun: false,
      },
    });
    console.log("Price sync response:", JSON.stringify(priceResponse.data, null, 2));
  } catch (error) {
    if (isAxiosError(error)) {
      console.error("Test failed:", error.response?.data || error.message);
    } else {
      console.error("Test failed:", error);
    }
  }
}

testEndpoints();
