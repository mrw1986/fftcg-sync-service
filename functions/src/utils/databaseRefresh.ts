// src/utils/databaseRefresh.ts

import {syncCards} from "../services/cardSync";
import {syncPrices} from "../services/priceSync";
import {backup} from "../utils/backup";
import {logError} from "./logger";
import {GenericError, SyncMode} from "../types";
import {db, COLLECTION} from "../config/firebase";

interface RefreshSetSummary {
  name: string;
  cards: {
    total: number;
    toUpdate: number;
    unchanged: number;
  };
  prices: {
    total: number;
    toUpdate: number;
    unchanged: number;
  };
  images: {
    total: number;
    toUpdate: number;
    unchanged: number;
  };
}

interface RefreshSummary {
  sets: RefreshSetSummary[];
  mode: SyncMode;
  duration?: number;
}

interface RefreshOptions {
  isDryRun: boolean;
  isVerbose: boolean;
  isForce: boolean;
  groupId?: string;
  skipImages: boolean;
  imagesOnly: boolean;
  limit?: number; // Add this line
}

async function parseCommandLineArgs(): Promise<RefreshOptions> {
  const args = process.argv.slice(2);
  console.log("Raw command line arguments:", args);

  const options: RefreshOptions = {
    isDryRun: false,
    isVerbose: false,
    isForce: false,
    skipImages: false,
    imagesOnly: false,
    limit: undefined,
    groupId: undefined,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
    case "--dry-run":
      options.isDryRun = true;
      break;
    case "--verbose":
      options.isVerbose = true;
      break;
    case "--force":
      options.isForce = true;
      break;
    case "--skip-images":
      options.skipImages = true;
      break;
    case "--images-only":
      options.imagesOnly = true;
      break;
    case "--group-id":
      if (nextArg && !nextArg.startsWith("--")) {
        options.groupId = nextArg;
        i++; // Skip next argument since we used it
      }
      break;
    case "--limit":
      if (nextArg && !nextArg.startsWith("--")) {
        options.limit = parseInt(nextArg, 10);
        i++; // Skip next argument since we used it
      }
      break;
    }
  }

  return options;
}

async function resetDatabase(): Promise<void> {
  await backup();
}

async function clearHashes(): Promise<void> {
  console.log("Clearing existing hashes...");
  const batch = db.batch();

  const cardHashes = await db.collection(COLLECTION.CARD_HASHES).get();
  cardHashes.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  const priceHashes = await db.collection(COLLECTION.PRICE_HASHES).get();
  priceHashes.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  await batch.commit();
  console.log("Hashes cleared");
}

function validateOptions(options: RefreshOptions): void {
  if (options.skipImages && options.imagesOnly) {
    throw new Error("Cannot use both --skip-images and --images-only flags");
  }
}

function getSyncMode(options: RefreshOptions): SyncMode {
  return {
    type: options.imagesOnly ? "images" : options.skipImages ? "data" : "full",
    isForced: options.isForce,
    isDryRun: options.isDryRun,
  };
}

async function displayInitialSummary(
  options: RefreshOptions,
  mode: SyncMode
): Promise<void> {
  console.log(`\nFFTCG Database ${options.isDryRun ? "Analysis" : "Refresh"}`);
  console.log("==========================");
  console.log(`Mode: ${mode.type.toUpperCase()}`);
  if (options.groupId) console.log(`Processing group: ${options.groupId}`);
  if (options.limit) console.log(`Limit: ${options.limit} items`); // Add this line
  console.log("Force mode:", options.isForce ? "enabled" : "disabled");
  console.log("Verbose mode:", options.isVerbose ? "enabled" : "disabled");
  console.log("Dry run:", options.isDryRun ? "yes" : "no");
  console.log("\nStarting process...");
}

export async function refreshDatabase(): Promise<void> {
  const startTime = Date.now();
  const options = await parseCommandLineArgs();

  try {
    validateOptions(options);
    const mode = getSyncMode(options);

    // Add detailed options logging
    console.log("\nParsed Options:");
    console.log("==============");
    console.log({
      isDryRun: options.isDryRun,
      isVerbose: options.isVerbose,
      isForce: options.isForce,
      groupId: options.groupId,
      skipImages: options.skipImages,
      imagesOnly: options.imagesOnly,
      limit: options.limit,
    });
    console.log(); // Add blank line for readability

    await displayInitialSummary(options, mode);

    const summary: RefreshSummary = {
      sets: [],
      mode,
    };

    // Analysis Phase
    console.log("\nAnalyzing current state...");
    console.log("Applied query parameters:");
    console.log("- Group ID:", options.groupId || "all groups");
    console.log("- Limit:", options.limit || "no limit");
    console.log("- Images Only:", options.imagesOnly);
    console.log(); // Add blank line for readability

    if (options.isForce && !options.isDryRun) {
      await clearHashes();
    }

    // Card/Image Sync Analysis
    const cardResult = await syncCards({
      dryRun: true,
      skipImages: options.skipImages,
      imagesOnly: options.imagesOnly,
      silent: !options.isVerbose,
      force: options.isForce,
      groupId: options.groupId,
      limit: options.limit,
    });

    // Log the results of the card sync
    console.log("\nCard Sync Configuration:");
    console.log("======================");
    console.log({
      dryRun: true,
      skipImages: options.skipImages,
      imagesOnly: options.imagesOnly,
      silent: !options.isVerbose,
      force: options.isForce,
      groupId: options.groupId,
      limit: options.limit,
      cardsFound: cardResult.cardCount,
    });
    console.log(); // Add blank line for readability

    // Price Sync Analysis (skip if images-only)
    const priceResult = !options.imagesOnly ?
      await syncPrices({
        dryRun: true,
        silent: !options.isVerbose,
        force: options.isForce,
        groupId: options.groupId,
      }) :
      {
        cardCount: 0,
        groupsUpdated: 0,
        errors: [],
      };

    // Display Analysis Results
    console.log("\nAnalysis Results:");
    console.log("----------------");

    if (options.imagesOnly) {
      console.log("\nImage Processing:");
      console.log(`Images to Process: ${cardResult.imagesProcessed || 0}`);
      console.log(`Images to Update: ${cardResult.imagesUpdated || 0}`);
    } else if (options.skipImages) {
      console.log("\nData Processing:");
      console.log(`Cards to Update: ${cardResult.cardCount}`);
      console.log(`Prices to Update: ${priceResult.cardCount}`);
    } else {
      console.log("\nFull Sync Processing:");
      console.log(`Cards to Update: ${cardResult.cardCount}`);
      console.log(`Prices to Update: ${priceResult.cardCount}`);
      console.log(`Images to Process: ${cardResult.imagesProcessed || 0}`);
      console.log(`Images to Update: ${cardResult.imagesUpdated || 0}`);
    }

    // Perform Updates if not dry run
    if (!options.isDryRun) {
      console.log("\nPerforming Updates:");
      console.log("------------------");

      console.log("Creating backup...");
      await resetDatabase();

      // Perform Card/Image Updates
      const cardUpdateResult = await syncCards({
        dryRun: false,
        skipImages: options.skipImages,
        imagesOnly: options.imagesOnly,
        silent: !options.isVerbose,
        force: options.isForce,
        groupId: options.groupId,
      });

      // Perform Price Updates (skip if images-only)
      const priceUpdateResult = !options.imagesOnly ?
        await syncPrices({
          dryRun: false,
          silent: !options.isVerbose,
          force: options.isForce,
          groupId: options.groupId,
        }) :
        {
          cardCount: 0,
          groupsUpdated: 0,
          errors: [],
        };

      // Display Update Results
      console.log("\nUpdate Results:");
      console.log("--------------");

      if (options.imagesOnly) {
        console.log(
          `Images Processed: ${cardUpdateResult.imagesProcessed || 0}`
        );
        console.log(`Images Updated: ${cardUpdateResult.imagesUpdated || 0}`);
      } else if (options.skipImages) {
        console.log(`Cards Updated: ${cardUpdateResult.cardCount}`);
        console.log(`Groups Updated: ${cardUpdateResult.groupsUpdated}`);
        console.log(`Price Records Updated: ${priceUpdateResult.cardCount}`);
      } else {
        console.log(`Cards Updated: ${cardUpdateResult.cardCount}`);
        console.log(`Groups Updated: ${cardUpdateResult.groupsUpdated}`);
        console.log(`Price Records Updated: ${priceUpdateResult.cardCount}`);
        console.log(
          `Images Processed: ${cardUpdateResult.imagesProcessed || 0}`
        );
        console.log(`Images Updated: ${cardUpdateResult.imagesUpdated || 0}`);
      }

      // Display any errors encountered
      if (
        cardUpdateResult.errors.length > 0 ||
        priceUpdateResult.errors.length > 0
      ) {
        console.log("\nErrors encountered:");
        [...cardUpdateResult.errors, ...priceUpdateResult.errors].forEach(
          (error) => {
            console.log(`- ${error}`);
          }
        );
      }
    } else {
      console.log("\nThis was a dry run - no changes were made");
      console.log("Run without --dry-run flag to perform updates");
    }

    // Calculate and display duration
    const duration = (Date.now() - startTime) / 1000;
    console.log("\nOperation Summary:");
    console.log("-----------------");
    console.log(`Total Duration: ${duration.toFixed(2)} seconds`);
    console.log(`Mode: ${summary.mode.type.toUpperCase()}`);
    console.log(`Operation Type: ${options.isDryRun ? "Analysis" : "Update"}`);
    if (options.groupId) {
      console.log(`Processed Group: ${options.groupId}`);
    }
    if (options.limit) {
      console.log(`Limit Applied: ${options.limit}`);
    }
    console.log(`Total Cards Processed: ${cardResult.cardCount}`);
    if (cardResult.imagesProcessed) {
      console.log(`Images Processed: ${cardResult.imagesProcessed}`);
      console.log(`Images Updated: ${cardResult.imagesUpdated || 0}`);
    }
  } catch (error) {
    const genericError: GenericError = {
      message: error instanceof Error ? error.message : "Unknown error",
      name: error instanceof Error ? error.name : "UnknownError",
      code: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      stack: error instanceof Error ? error.stack : undefined,
    };
    console.error("\nError:", genericError.message);
    await logError(genericError, "Database refresh failed");
    throw error;
  }
}

// Function to handle environment checks
function checkEnvironment(): void {
  if (!process.env.FUNCTIONS_EMULATOR && !process.env.NODE_ENV) {
    console.warn("\nWarning: Running in production environment");
    console.warn("Set NODE_ENV=development for local testing");
  }

  if (process.env.RESTRICT_BANDWIDTH === "true") {
    console.warn("\nWarning: Bandwidth restrictions are enabled");
    console.warn("Image processing may be limited");
  }
}

// Main execution
if (require.main === module) {
  checkEnvironment();
  refreshDatabase()
    .then(() => {
      console.log("\nOperation completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\nFatal error:", error);
      process.exit(1);
    });
}

// Export additional utilities for testing and external use
export const utils = {
  parseCommandLineArgs,
  validateOptions,
  getSyncMode,
  checkEnvironment,
};
