// src/scripts/syncGroups.ts
import { groupSync } from "../services/groupSync";

async function main() {
  try {
    const args = process.argv.slice(2);
    const forceUpdate = args.includes("--force");

    console.log("Starting group sync", { forceUpdate });
    const result = await groupSync.syncGroups({ forceUpdate });
    console.log("Group sync completed:", {
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
    console.error("Group sync failed:", error);
    process.exit(1);
  }
}

main();
