// src/scripts/initializeMetadata.ts
import { metadataService } from "../services/metadataService";
import { logger } from "../utils/logger";
import { db } from "../config/firebase";

/**
 * Initialize the metadata document
 */
async function main() {
  try {
    logger.info("Starting metadata initialization");

    // Initialize metadata document
    const metadata = await metadataService.initializeMetadata();

    if (metadata) {
      logger.info("Metadata document initialized successfully", {
        version: metadata.version,
        lastUpdated: metadata.lastUpdated,
        cardCount: metadata.cardCount,
        groupCount: metadata.groupCount,
      });
    } else {
      logger.error("Failed to initialize metadata document");
      process.exit(1);
    }

    // Clean shutdown
    await db.terminate();
    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Error initializing metadata:", { error: errorMessage });

    // Clean shutdown
    await db.terminate();
    process.exit(1);
  }
}

// Run the initialization
main().catch(console.error);
