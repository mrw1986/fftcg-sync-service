// src/test/testScheduledFunctions.ts
import {syncCards} from "../services/cardSync";
import {syncPrices} from "../services/priceSync";

interface TestOptions {
  type?: "card" | "price" | "both";
  dryRun?: boolean;
  groupId?: string | number; // Update to allow both string and number
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
        groupId: groupId?.toString(), // Ensure groupId is passed as string
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
        groupId: groupId?.toString(), // Ensure groupId is passed as string
        silent: false,
        force: false,
      });
      console.log("Price sync completed");
      console.log("Results:", {
        pricesProcessed: priceResult.cardCount,
        groupsUpdated: priceResult.groupsUpdated,
        errors: priceResult.errors,
      });
    }
  } catch (error) {
    console.error("Test failed:", error);
    throw error;
  }
}

// Parse command line arguments if running directly
// src/test/testScheduledFunctions.ts
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: TestOptions = {
    type: "both",
    dryRun: false,
    groupId: undefined,
    limit: undefined,
  };

  // First, check for positional arguments (for backward compatibility)
  if (args.length > 0 && !args[0].startsWith("--")) {
    options.groupId = args[0];
  }

  // Then check for named arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
    case "--type":
      if (nextArg && ["card", "price", "both"].includes(nextArg)) {
        options.type = nextArg as "card" | "price" | "both";
        i++;
      }
      break;
    case "--group-id":
      if (nextArg && !nextArg.startsWith("--")) {
        options.groupId = nextArg;
        i++;
      }
      break;
    case "--dry-run":
      options.dryRun = true;
      break;
    case "--limit":
      if (nextArg && !isNaN(Number(nextArg))) {
        options.limit = parseInt(nextArg, 10);
        i++;
      }
      break;
    }
  }

  // Debug logging
  console.log("\nCommand line parsing:");
  console.log("Raw arguments:", args);
  console.log("Parsed options:", JSON.stringify(options, null, 2));

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
