// src/scripts/testScheduledSync.ts
import { groupSync } from "../services/groupSync";
import { cardSync } from "../services/cardSync";
import { logger } from "../utils/logger";

async function main() {
  try {
    console.log("=== Testing Scheduled Sync (Groups + Cards) ===\n");
    logger.info("Starting scheduled sync test");

    // First sync groups to ensure new groups are available
    logger.info("Starting group sync");
    const groupResult = await groupSync.syncGroups();
    logger.info("Group sync completed", groupResult);
    console.log("Group Sync Results:");
    console.log(`- Success: ${groupResult.success}`);
    console.log(`- Processed: ${groupResult.itemsProcessed}`);
    console.log(`- Updated: ${groupResult.itemsUpdated}`);
    console.log(`- Duration: ${groupResult.timing.duration}s`);
    console.log(`- Errors: ${groupResult.errors.length}\n`);

    // Then sync cards
    logger.info("Starting card sync");
    const cardResult = await cardSync.syncCards({
      dryRun: true, // Use dry run for testing
      limit: 10, // Limit to 10 cards for testing
    });
    logger.info("Card sync completed", cardResult);
    console.log("Card Sync Results:");
    console.log(`- Success: ${cardResult.success}`);
    console.log(`- Processed: ${cardResult.itemsProcessed}`);
    console.log(`- Updated: ${cardResult.itemsUpdated}`);
    console.log(`- Duration: ${cardResult.timing.duration}s`);
    console.log(`- Errors: ${cardResult.errors.length}\n`);

    const combinedResult = {
      groups: groupResult,
      cards: cardResult,
    };

    logger.info("Scheduled sync test completed", combinedResult);
    console.log("✅ Scheduled sync test completed successfully!");

    process.exit(0);
  } catch (error) {
    console.error("❌ Scheduled sync test failed:", error);
    logger.error("Scheduled sync test failed", { error });
    process.exit(1);
  }
}

main().catch(console.error);
