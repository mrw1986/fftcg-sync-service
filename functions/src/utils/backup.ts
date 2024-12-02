// src/utils/backup.ts

import {db, COLLECTION} from "../config/firebase";
import * as fs from "fs";
import * as path from "path";

interface BackupMetadata {
  timestamp: string;
  collections: string[];
  documentCounts: { [key: string]: number };
}

export async function backup(): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(__dirname, "..", "..", "backups");
  const backupPath = path.join(backupDir, `backup_${timestamp}`);

  // Create backup directory if it doesn't exist
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, {recursive: true});
  }

  const collections = [
    COLLECTION.CARDS,
    COLLECTION.PRICES,
    COLLECTION.SYNC_METADATA,
    COLLECTION.CARD_HASHES,
    COLLECTION.PRICE_HASHES,
    COLLECTION.IMAGE_METADATA,
  ];

  const metadata: BackupMetadata = {
    timestamp,
    collections,
    documentCounts: {},
  };

  try {
    console.log("Starting database backup...");

    for (const collectionName of collections) {
      console.log(`Backing up collection: ${collectionName}`);

      const snapshot = await db.collection(collectionName).get();
      const documents = snapshot.docs.map((doc) => ({
        id: doc.id,
        data: doc.data(),
      }));

      metadata.documentCounts[collectionName] = documents.length;

      // Save collection to its own file
      const collectionPath = `${backupPath}_${collectionName}.json`;
      fs.writeFileSync(collectionPath, JSON.stringify(documents, null, 2));

      console.log(`- Backed up ${documents.length} documents`);
    }

    // Save metadata
    const metadataPath = `${backupPath}_metadata.json`;
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    console.log("\nBackup completed successfully");
    console.log(`Location: ${backupDir}`);
    console.log("Files:");
    collections.forEach((collection) => {
      console.log(`- backup_${timestamp}_${collection}.json`);
    });
    console.log(`- backup_${timestamp}_metadata.json`);
  } catch (error) {
    console.error("Backup failed:", error);
    throw error;
  }
}

export async function restore(timestamp: string): Promise<void> {
  const backupDir = path.join(__dirname, "..", "..", "backups");
  const metadataPath = path.join(
    backupDir,
    `backup_${timestamp}_metadata.json`
  );

  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Backup metadata not found: ${metadataPath}`);
  }

  const metadata: BackupMetadata = JSON.parse(
    fs.readFileSync(metadataPath, "utf8")
  );

  try {
    console.log("Starting database restore...");

    for (const collectionName of metadata.collections) {
      console.log(`Restoring collection: ${collectionName}`);

      const collectionPath = path.join(
        backupDir,
        `backup_${timestamp}_${collectionName}.json`
      );
      const documents = JSON.parse(fs.readFileSync(collectionPath, "utf8"));

      const batch = db.batch();
      let batchCount = 0;
      let totalRestored = 0;

      for (const doc of documents) {
        const ref = db.collection(collectionName).doc(doc.id);
        batch.set(ref, doc.data);
        batchCount++;

        if (batchCount >= 500) {
          // Firestore batch limit
          await batch.commit();
          totalRestored += batchCount;
          batchCount = 0;
        }
      }

      if (batchCount > 0) {
        await batch.commit();
        totalRestored += batchCount;
      }

      console.log(`- Restored ${totalRestored} documents`);
    }

    console.log("\nRestore completed successfully");
  } catch (error) {
    console.error("Restore failed:", error);
    throw error;
  }
}

// If run directly, perform backup
if (require.main === module) {
  backup()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}
