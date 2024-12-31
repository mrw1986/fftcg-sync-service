import {db, COLLECTION} from "../config/firebase";
import {logError, logInfo, logWarning} from "../utils/logger";
import type {Query, DocumentData} from "firebase-admin/firestore";
import {imageHandler} from "./imageHandler";

interface MigrationStats {
  processed: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export async function migrateImages(
  options: { dryRun?: boolean; limit?: number; groupId?: string } = {}
): Promise<MigrationStats> {
  const stats: MigrationStats = {
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  try {
    await logInfo("Starting image migration", {options});

    // Build the query
    let query: Query<DocumentData> = db.collection(COLLECTION.CARDS);

    if (options.groupId) {
      query = query.where("groupId", "==", options.groupId);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const snapshot = await query.get();
    const totalDocuments = snapshot.size;

    await logInfo(`Found ${totalDocuments} documents to process`);

    for (const doc of snapshot.docs) {
      try {
        const data = doc.data();
        stats.processed++;

        if (!data.imageUrl) {
          await logInfo(`Skipping document ${doc.id} - no image URL`);
          stats.skipped++;
          continue;
        }

        // Process the image
        if (!options.dryRun) {
          const result = await imageHandler.processImage(
            data.imageUrl,
            data.groupId.toString(),
            data.productId,
            data.cardNumber
          );

          if (result.updated) {
            stats.updated++;
            await logInfo(`Updated images for document ${doc.id}`, {
              highResUrl: result.highResUrl,
              lowResUrl: result.lowResUrl,
            });
          } else {
            stats.skipped++;
            await logInfo(`No updates needed for document ${doc.id}`);
          }
        }

        // Log progress
        if (stats.processed % 10 === 0) {
          await logInfo(`Progress: ${stats.processed}/${totalDocuments}`, {
            updated: stats.updated,
            skipped: stats.skipped,
            failed: stats.failed,
          });
        }
      } catch (error) {
        stats.failed++;
        stats.errors.push(
          `Error processing document ${doc.id}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
        await logWarning(`Failed to process document ${doc.id}`, {
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    await logInfo("Migration completed", stats);
    return stats;
  } catch (error) {
    await logError(error as Error, "Migration failed");
    throw error;
  }
}

// Execute if run directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes("--dry-run"),
    limit: args.includes("--limit") ?
      parseInt(args[args.indexOf("--limit") + 1]) :
      undefined,
    groupId: args.includes("--group-id") ?
      args[args.indexOf("--group-id") + 1] :
      undefined,
  };

  migrateImages(options)
    .then((stats) => {
      console.log("\nMigration Summary:");
      console.log("-----------------");
      console.log(`Total Processed: ${stats.processed}`);
      console.log(`Updated: ${stats.updated}`);
      console.log(`Skipped: ${stats.skipped}`);
      console.log(`Failed: ${stats.failed}`);
      if (stats.errors.length > 0) {
        console.log("\nErrors:");
        stats.errors.forEach((error) => console.log(`- ${error}`));
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}
