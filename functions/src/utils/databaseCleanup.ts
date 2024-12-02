import { db, COLLECTION } from "../config/firebase";
import { logInfo } from "./logger";
import { FieldValue } from "firebase-admin/firestore";

export async function cleanupImageUrls(): Promise<void> {
  let count = 0;
  let batchCount = 0;
  let batch = db.batch(); // Initialize first batch

  const snapshot = await db.collection(COLLECTION.CARDS).get();

  for (const doc of snapshot.docs) {
    const data = doc.data();

    if (data.imageUrl) {
      const updates: any = {
        originalUrl: data.imageUrl,
        lastUpdated: new Date(),
      };

      // Remove imageUrl field
      updates.imageUrl = FieldValue.delete();

      batch.update(doc.ref, updates);
      count++;
      batchCount++;

      if (batchCount >= 500) {
        // Firestore batch limit
        await batch.commit();
        await logInfo(`Processed ${count} documents`);
        // Create a new batch after commit
        batch = db.batch();
        batchCount = 0;
      }
    }
  }

  // Commit any remaining updates
  if (batchCount > 0) {
    await batch.commit();
    await logInfo(`Processed final batch of ${batchCount} documents`);
  }

  await logInfo(`Cleanup completed. Updated ${count} documents`);
}

// Execute if run directly
if (require.main === module) {
  cleanupImageUrls()
    .then(() => {
      console.log("Cleanup completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Cleanup failed:", error);
      process.exit(1);
    });
}
