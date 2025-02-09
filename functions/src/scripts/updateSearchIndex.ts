// src/scripts/updateSearchIndex.ts
import { searchIndex } from "../services/searchIndexService";
import { logger } from "../utils/logger";
import { db } from "../config/firebase";

async function main() {
  try {
    // Set environment variables if needed
    process.env.ENABLE_FIRESTORE_LOGS = "true";

    await searchIndex.updateSearchIndex();

    // Clean shutdown
    await logger.disableFirestore();
    await db.terminate();
    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logger.error("Search index update failed:", { error: errorMessage });

    // Clean shutdown
    await logger.disableFirestore();
    await db.terminate();
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
