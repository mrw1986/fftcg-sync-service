import { cardSync } from "../services/cardSync";
import { priceSync } from "../services/priceSync";

async function main() {
  console.log("Starting full sync...");

  try {
    console.log("\n1. Running card sync...");
    const cardResult = await cardSync.syncCards();
    console.log("Card sync completed:", {
      success: cardResult.success,
      processed: cardResult.itemsProcessed,
      updated: cardResult.itemsUpdated,
      errors: cardResult.errors.length,
    });

    console.log("\n2. Running price sync...");
    const priceResult = await priceSync.syncPrices();
    console.log("Price sync completed:", {
      success: priceResult.success,
      processed: priceResult.itemsProcessed,
      updated: priceResult.itemsUpdated,
      errors: priceResult.errors.length,
    });

    const allErrors = [...cardResult.errors, ...priceResult.errors];
    if (allErrors.length > 0) {
      console.log("\nErrors encountered:");
      allErrors.forEach((error) => console.log(`- ${error}`));
    }

    console.log("\nFull sync completed!");
  } catch (error) {
    console.error("Full sync failed:", error);
    process.exit(1);
  }
}

main();
