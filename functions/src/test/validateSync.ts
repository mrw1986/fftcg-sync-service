// src/test/validateSync.ts

import {db, COLLECTION} from "../config/firebase";
import {r2Storage} from "../services/r2Storage";
import {syncCards} from "../services/cardSync";
import {syncPrices} from "../services/priceSync";

async function validateSync(options = {limit: 5, groupId: ""}) {
  try {
    console.log("\nStarting validation sync...");

    // Test card sync
    console.log("\nTesting card sync...");
    const cardResult = await syncCards({
      dryRun: false,
      limit: options.limit,
      groupId: options.groupId,
      skipImages: false,
    });

    // Validate card data and images
    const cardDocs = await db
      .collection(COLLECTION.CARDS)
      .limit(options.limit)
      .get();

    for (const doc of cardDocs.docs) {
      const data = doc.data();
      console.log(`\nValidating card: ${data.name}`);
      console.log(`Document ID: ${doc.id}`);

      // Validate image URLs
      if (data.highResUrl && data.lowResUrl) {
        console.log("Checking image URLs...");

        // Check R2 storage
        const highResExists = await r2Storage.fileExists(
          data.highResUrl.replace(process.env.R2_CUSTOM_DOMAIN as string, "")
        );
        const lowResExists = await r2Storage.fileExists(
          data.lowResUrl.replace(process.env.R2_CUSTOM_DOMAIN as string, "")
        );

        console.log(`High-res image exists: ${highResExists}`);
        console.log(`Low-res image exists: ${lowResExists}`);
      } else {
        console.log("Warning: Missing image URLs");
      }
    }

    // Test price sync
    console.log("\nTesting price sync...");
    const priceResult = await syncPrices({
      dryRun: false,
      limit: options.limit,
      groupId: options.groupId,
    });

    console.log("\nSync Results:");
    console.log("Cards processed:", cardResult.cardCount);
    console.log("Images processed:", cardResult.imagesProcessed);
    console.log("Images updated:", cardResult.imagesUpdated);
    console.log("Prices processed:", priceResult.cardCount);

    if (cardResult.errors.length > 0) {
      console.log("\nCard Sync Errors:", cardResult.errors);
    }
    if (priceResult.errors.length > 0) {
      console.log("\nPrice Sync Errors:", priceResult.errors);
    }
  } catch (error) {
    console.error("Validation failed:", error);
    throw error;
  }
}

// Run validation if executed directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    limit: args.includes("--limit") ?
      parseInt(args[args.indexOf("--limit") + 1]) :
      5,
    groupId: args.includes("--group-id") ?
      args[args.indexOf("--group-id") + 1] :
      "",
  };

  validateSync(options)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}
