// src/scripts/viewMetadata.ts
import { metadataService } from "../services/metadataService";
import { logger } from "../utils/logger";
import { db } from "../config/firebase";

/**
 * View the current metadata document
 */
async function main() {
  try {
    logger.info("Retrieving metadata document");

    // Get metadata document
    const metadata = await metadataService.getMetadata();

    if (metadata) {
      // Format timestamps for better readability
      const formattedMetadata = {
        ...metadata,
        lastUpdated: metadata.lastUpdated instanceof Date ? metadata.lastUpdated.toISOString() : metadata.lastUpdated,
        syncStartTime:
          metadata.syncStartTime instanceof Date ? metadata.syncStartTime.toISOString() : metadata.syncStartTime,
        syncEndTime: metadata.syncEndTime instanceof Date ? metadata.syncEndTime.toISOString() : metadata.syncEndTime,
      };

      // Log the metadata in a readable format
      console.log("\n=== FFTCG Sync Metadata ===\n");
      console.log(JSON.stringify(formattedMetadata, null, 2));
      console.log("\n===========================\n");

      // Also log some key metrics
      console.log(`Version: ${metadata.version}`);
      console.log(`Last Updated: ${formattedMetadata.lastUpdated}`);
      console.log(`Card Count: ${metadata.cardCount}`);
      console.log(`Group Count: ${metadata.groupCount}`);
      console.log(`Sync Status: ${metadata.syncStatus}`);

      if (metadata.syncDuration) {
        console.log(`Last Sync Duration: ${metadata.syncDuration} seconds`);
      }

      if (metadata.syncErrors && metadata.syncErrors.length > 0) {
        console.log("\nSync Errors:");
        metadata.syncErrors.forEach((error, index) => {
          console.log(`  ${index + 1}. ${error}`);
        });
      }
    } else {
      console.log("No metadata document found. Run initializeMetadata.ts to create it.");
    }

    // Clean shutdown
    await db.terminate();
    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Error retrieving metadata:", { error: errorMessage });

    // Clean shutdown
    await db.terminate();
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);
