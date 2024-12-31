import {db, COLLECTION} from "../config/firebase";
import {processBatch} from "./syncUtils";
import {FieldValue} from "firebase-admin/firestore";
import type {QueryDocumentSnapshot} from "@google-cloud/firestore";

interface BatchStats {
  processed: number;
  total: number;
}

/**
 * Migrates image URLs by processing documents in batches.
 * Removes the `imageUrl` field from documents and updates high-res and low-res URLs.
 */
export async function migrateImageUrls(
  _options: { dryRun?: boolean; limit?: number; groupId?: string } = {}
): Promise<void> {
  // Query the cards collection
  const query = db.collection(COLLECTION.CARDS);
  const snapshot = await query.get();

  console.log(`Found ${snapshot.size} documents to process.`);

  // Process documents in batches
  await processBatch<QueryDocumentSnapshot>(
    snapshot.docs,
    async (batch: QueryDocumentSnapshot[]) => {
      const writeBatch = db.batch();

      for (const doc of batch) {
        const data = doc.data();
        const updates: any = {lastUpdated: new Date()};

        // Remove the `imageUrl` field if it exists
        if (data.imageUrl) {
          updates.imageUrl = FieldValue.delete();
        }

        // Update the document in Firestore
        writeBatch.update(doc.ref, updates);
        console.log(`Prepared updates for document: ${doc.id}`);
      }

      // Commit the batch
      if (batch.length > 0) {
        await writeBatch.commit();
        console.log(`Committed batch of ${batch.length} documents.`);
      }
    },
    {
      batchSize: 500, // Firestore supports up to 500 operations per batch
      onBatchComplete: async (batchStats: BatchStats) => {
        console.log(
          `Processed ${batchStats.processed} out of ${batchStats.total} documents.`
        );
      },
    }
  );

  console.log("Migration completed successfully.");
}

// If run directly, execute the migration
if (require.main === module) {
  const args = process.argv.slice(2);

  const options: {
    dryRun?: boolean;
    limit?: number;
    groupId?: string;
  } = {
    dryRun: args.includes("--dry-run"),
    limit: args.includes("--limit") ?
      parseInt(args[args.indexOf("--limit") + 1]) :
      undefined,
    groupId: args.includes("--group-id") ?
      args[args.indexOf("--group-id") + 1] :
      undefined,
  };

  migrateImageUrls(options)
    .then(() => {
      console.log("Image URL migration completed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Migration failed:", error);
      process.exit(1);
    });
}
