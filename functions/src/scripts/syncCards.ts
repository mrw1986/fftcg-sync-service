import { cardSync } from "../services/cardSync";

async function main() {
  try {
    console.log("Starting manual card sync...");
    const result = await cardSync.syncCards();
    console.log("Card sync completed:", {
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
    console.error("Card sync failed:", error);
    process.exit(1);
  }
}

main();
