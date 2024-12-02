import {db, COLLECTION} from "../config/firebase";
import * as fs from "fs/promises";
import * as path from "path";

async function backupCollection(collectionName: string): Promise<void> {
  console.log(`Backing up ${collectionName}...`);
  const snapshot = await db.collection(collectionName).get();
  const data = snapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data(),
  }));

  const backupDir = path.join(__dirname, "../../backups");
  await fs.mkdir(backupDir, {recursive: true});

  const timestamp = new Date().toISOString().replace(/[:]/g, "-");
  const filename = `${collectionName}_${timestamp}.json`;
  await fs.writeFile(
    path.join(backupDir, filename),
    JSON.stringify(data, null, 2)
  );

  console.log(`Backed up ${data.length} documents from ${collectionName}`);
}

export async function backupDatabase(): Promise<void> {
  try {
    console.log("Starting database backup...");

    await Promise.all([
      backupCollection(COLLECTION.CARDS),
      backupCollection(COLLECTION.PRICES),
      backupCollection(COLLECTION.SYNC_METADATA),
      backupCollection(COLLECTION.CARD_HASHES),
      backupCollection(COLLECTION.PRICE_HASHES),
      backupCollection(COLLECTION.IMAGE_METADATA),
    ]);

    console.log("Backup completed successfully!");
  } catch (error) {
    console.error("Backup failed:", error);
    throw error;
  }
}
