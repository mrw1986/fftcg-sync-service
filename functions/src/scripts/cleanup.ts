import { retention } from "../utils/retention";

async function main() {
  console.log("Starting manual cleanup...");
  try {
    await retention.cleanOldData();
    console.log("Cleanup completed successfully");
  } catch (error) {
    console.error("Cleanup failed:", error);
    process.exit(1);
  }
}

main();
