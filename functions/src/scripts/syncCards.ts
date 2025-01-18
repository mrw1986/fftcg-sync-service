// src/scripts/syncCards.ts
import { cardSync } from "../services/cardSync";

function parseArgs(args: string[]): { forceUpdate?: boolean; groupId?: string } {
  const options: { forceUpdate?: boolean; groupId?: string } = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--force":
        options.forceUpdate = true;
        break;
      case "--group":
        options.groupId = args[++i];
        break;
    }
  }

  return options;
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const options = parseArgs(args);

    console.log("Starting manual card sync with options:", options);
    const result = await cardSync.syncCards(options);
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
  } finally {
    // Force exit after a short delay to allow final logs to be written
    setTimeout(() => process.exit(0), 1000);
  }
}

main();
