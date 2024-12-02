// src/utils/databaseReset.ts
import {db, COLLECTION} from "../config/firebase";
import {backupDatabase} from "./databaseBackup";
import {logInfo, logError} from "./logger";
import {GenericError} from "../types";

async function deleteCollection(collectionName: string): Promise<void> {
  const batchSize = 500;
  const query = db.collection(collectionName).limit(batchSize);
  let deletedCount = 0;
  let hasMore = true;

  try {
    while (hasMore) {
      const snapshot = await query.get();

      if (snapshot.empty) {
        hasMore = false;
        continue;
      }

      const batch = db.batch();
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
        deletedCount++;
      });

      await batch.commit();
      await logInfo(`Deleted ${deletedCount} documents from ${collectionName}`);
    }

    await logInfo(`Finished deleting collection ${collectionName}`);
  } catch (error) {
    const genericError: GenericError = {
      message: error instanceof Error ? error.message : "Unknown error",
      name: error instanceof Error ? error.name : "UnknownError",
      code: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      stack: error instanceof Error ? error.stack : undefined,
    };
    await logError(
      genericError,
      `Failed to delete collection ${collectionName}`
    );
    throw error;
  }
}

export async function resetDatabase(): Promise<void> {
  try {
    // First, create a backup
    await backupDatabase();

    // Then delete all collections
    await Promise.all([
      deleteCollection(COLLECTION.CARDS),
      deleteCollection(COLLECTION.PRICES),
      deleteCollection(COLLECTION.SYNC_METADATA),
      deleteCollection(COLLECTION.CARD_HASHES),
      deleteCollection(COLLECTION.PRICE_HASHES),
      deleteCollection(COLLECTION.IMAGE_METADATA),
    ]);

    await logInfo("Database reset completed successfully");
  } catch (error) {
    const genericError: GenericError = {
      message: error instanceof Error ? error.message : "Unknown error",
      name: error instanceof Error ? error.name : "UnknownError",
      code: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      stack: error instanceof Error ? error.stack : undefined,
    };
    await logError(genericError, "Database reset failed");
    throw error;
  }
}
