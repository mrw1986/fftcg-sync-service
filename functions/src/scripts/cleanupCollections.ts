// src/scripts/cleanupCollections.ts
import { db } from "../config/firebase";

const COLLECTIONS_TO_DELETE = ["logs", "cardDeltas"] as const;

async function deleteCollection(collectionPath: string) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.orderBy("__name__").limit(500);

  return new Promise<void>((resolve, reject) => {
    deleteQueryBatch(query, collectionPath, resolve).catch(reject);
  });
}

async function deleteQueryBatch(
  query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData>,
  collectionPath: string,
  resolve: () => void
) {
  const snapshot = await query.get();

  const batchSize = snapshot.size;
  if (batchSize === 0) {
    // When there are no documents left, we are done
    resolve();
    return;
  }

  // Delete documents in a batch
  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();

  // Log progress
  console.log(`Deleted ${batchSize} documents from ${collectionPath}`);

  // Recurse on the next process tick, to avoid exploding the stack
  process.nextTick(() => {
    deleteQueryBatch(query, collectionPath, resolve);
  });
}

async function main() {
  try {
    console.log("Starting cleanup of collections:", COLLECTIONS_TO_DELETE);

    // Process each collection
    for (const collection of COLLECTIONS_TO_DELETE) {
      console.log(`\nProcessing collection: ${collection}`);
      await deleteCollection(collection);
      console.log(`Finished processing collection: ${collection}`);
    }

    console.log("\nCleanup completed successfully");
    process.exit(0);
  } catch (error) {
    console.error("Cleanup failed:", error);
    process.exit(1);
  }
}

// Only run if called directly
if (require.main === module) {
  main().catch(console.error);
}
