import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";
import {ServiceAccount} from "firebase-admin";
import * as path from "path";
import * as fs from "fs/promises";

// Import service account using async/await
async function initializeFirebase() {
  const serviceAccountPath = path.resolve(__dirname, "../../../service_account_key.json");
  const serviceAccountData = await fs.readFile(serviceAccountPath, "utf8");
  const serviceAccount = JSON.parse(serviceAccountData) as ServiceAccount;

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  return admin.firestore();
}

interface ValidationResult {
  collection: string;
  documentsChecked: number;
  documentsValid: number;
  errors: string[];
}

async function validateCollection(
  db: FirebaseFirestore.Firestore,
  collectionName: string,
  validator: (doc: FirebaseFirestore.DocumentData) => boolean
): Promise<ValidationResult> {
  const result: ValidationResult = {
    collection: collectionName,
    documentsChecked: 0,
    documentsValid: 0,
    errors: [],
  };

  try {
    const snapshot = await db.collection(collectionName)
      .orderBy("lastUpdated", "desc")
      .limit(100)
      .get();

    result.documentsChecked = snapshot.size;

    snapshot.forEach((doc) => {
      const data = doc.data();
      try {
        if (validator(data)) {
          result.documentsValid++;
        } else {
          result.errors.push(`Document ${doc.id} failed validation`);
        }
      } catch (error) {
        result.errors.push(`Error validating ${doc.id}: ${error}`);
      }
    });
  } catch (error) {
    result.errors.push(`Error accessing collection: ${error}`);
  }

  return result;
}

async function validateSync() {
  console.log("Starting sync validation...");

  try {
    const db = await initializeFirebase();

    // Validate cards
    const cardResult = await validateCollection(db, "cards", (data) => {
      return (
        typeof data.productId === "number" &&
        typeof data.name === "string" &&
        typeof data.lastUpdated === "object" &&
        data.lastUpdated instanceof Timestamp
      );
    });

    // Validate prices
    const priceResult = await validateCollection(db, "prices", (data) => {
      return (
        data.lastUpdated instanceof Timestamp &&
        (!data.normal || typeof data.normal.midPrice === "number") &&
        (!data.foil || typeof data.foil.midPrice === "number")
      );
    });

    // Validate sync metadata
    const metadataResult = await validateCollection(db, "syncMetadata", (data) => {
      return (
        data.lastSync instanceof Timestamp &&
        typeof data.status === "string" &&
        typeof data.cardCount === "number" &&
        Array.isArray(data.errors)
      );
    });

    // Print results
    console.log("\nValidation Results:");
    [cardResult, priceResult, metadataResult].forEach((result) => {
      console.log(`\n${result.collection}:`);
      console.log(`Documents Checked: ${result.documentsChecked}`);
      console.log(`Valid Documents: ${result.documentsValid}`);
      if (result.errors.length > 0) {
        console.log("Errors:");
        result.errors.forEach((error) => console.log(`- ${error}`));
      }
    });
  } catch (error) {
    console.error("Validation failed:", error);
  }
}

// Execute the validation
validateSync().catch(console.error);
