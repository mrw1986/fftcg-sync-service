import { priceSync } from "../services/priceSync";

async function main() {
  console.log("Starting manual price sync...");
  try {
    const result = await priceSync.syncPrices();
    console.log("Price sync completed:", {
      success: result.success,
      processed: result.itemsProcessed,
      updated: result.itemsUpdated,
      errors: result.errors.length,
      duration: `${result.timing.duration}s`,
    });

    if (result.errors.length > 0) {
      console.log("\nErrors encountered:");
      result.errors.forEach((error) => console.log(`- ${error}`));
    }
  } catch (error) {
    console.error("Price sync failed:", error);
    process.exit(1);
  }
}

main();
