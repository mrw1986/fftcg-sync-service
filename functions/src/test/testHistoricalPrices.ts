import {historicalPriceSync} from "../services/historicalPriceSync";
import {db, COLLECTION} from "../config/firebase";
import {fetchPricesForGroup} from "../services/priceSync";

async function testHistoricalPriceSync() {
  try {
    console.log("\n=== Testing Historical Price Sync ===");

    // First, get some price data
    console.log("\nFetching current prices...");
    const prices = await fetchPricesForGroup("23783"); // Test with Hidden Legends

    // Save the prices to historical collection
    console.log("\nSaving prices to historical collection...");
    await historicalPriceSync.saveDailyPrices(prices);

    // Verify data
    console.log("\nVerifying saved historical prices...");
    const snapshot = await db
      .collection(COLLECTION.HISTORICAL_PRICES)
      .limit(5)
      .get();

    console.log("\nSample of historical prices:");
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      console.log(`\nProduct ID: ${data.productId}`);
      if (data.prices.normal) {
        console.log("Normal prices:", data.prices.normal);
      }
      if (data.prices.foil) {
        console.log("Foil prices:", data.prices.foil);
      }
    });
  } catch (error) {
    console.error("Test failed:", error);
    throw error;
  }
}

// Execute if run directly
if (require.main === module) {
  testHistoricalPriceSync()
    .then(() => {
      console.log("\nHistorical price sync test completed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\nTest failed:", error);
      process.exit(1);
    });
}
