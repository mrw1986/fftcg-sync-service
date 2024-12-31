// src/test/testScheduledFunctions.ts
import {syncCards} from "../services/cardSync";
import {syncPrices} from "../services/priceSync";

interface TestOptions {
  type?: "card" | "price" | "both";
  dryRun?: boolean;
  groupId?: string;
  limit?: number;
}

async function testScheduledFunctions(options: TestOptions = {}) {
  const {type = "both", dryRun = false, groupId, limit} = options;

  try {
    console.log("\nTest Configuration:");
    console.log("------------------");
    console.log(`Type: ${type}`);
    console.log(`Dry Run: ${dryRun}`);
    if (groupId) console.log(`Group ID: ${groupId}`);
    if (limit) console.log(`Limit: ${limit}`);
    console.log("");

    if (type === "both" || type === "card") {
      console.log("Testing card sync functionality...");
      const cardResult = await syncCards({
        dryRun,
        limit,
        groupId,
        skipImages: false,
        imagesOnly: false,
        silent: false,
        force: false,
      });
      console.log("Card sync completed");
      console.log("Results:", {
        cardsProcessed: cardResult.cardCount,
        imagesProcessed: cardResult.imagesProcessed,
        imagesUpdated: cardResult.imagesUpdated,
        errors: cardResult.errors,
      });
    }

    if (type === "both" || type === "price") {
      console.log("\nTesting price sync functionality...");
      const priceResult = await syncPrices({
        dryRun,
        limit,
        groupId,
        silent: false,
        force: false,
      });
      console.log("Price sync completed");
      console.log("Results:", {
        pricesProcessed: priceResult.cardCount,
        errors: priceResult.errors,
      });
    }
  } catch (error) {
    console.error("Test failed:", error);
    throw error;
  }
}

// Parse command line arguments if running directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: TestOptions = {
    type: (args.includes("--type") ?
      args[args.indexOf("--type") + 1] :
      "both") as "card" | "price" | "both",
    dryRun: args.includes("--dry-run"),
    groupId: args.includes("--group-id") ?
      args[args.indexOf("--group-id") + 1] :
      undefined,
    limit: args.includes("--limit") ?
      parseInt(args[args.indexOf("--limit") + 1]) :
      undefined,
  };

  testScheduledFunctions(options)
    .then(() => {
      console.log("\nAll sync function tests completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\nTest execution failed:", error);
      process.exit(1);
    });
}

export {testScheduledFunctions};
