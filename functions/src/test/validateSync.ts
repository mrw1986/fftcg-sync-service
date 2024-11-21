import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";
import {ServiceAccount} from "firebase-admin";
import * as path from "path";
import * as fs from "fs/promises";
import {COLLECTION} from "../config/firebase";

interface ValidationResult {
  collection: string;
  documentsChecked: number;
  documentsValid: number;
  errors: string[];
  details?: Record<string, any>;
}

interface ValidationOptions {
  limit?: number;
  verbose?: boolean;
  groupId?: string;
}

async function initializeFirebase(): Promise<FirebaseFirestore.Firestore> {
  try {
    const serviceAccountPath = path.resolve(__dirname, "../../../service_account_key.json");
    const serviceAccountData = await fs.readFile(serviceAccountPath, "utf8");
    const serviceAccount = JSON.parse(serviceAccountData) as ServiceAccount;

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }

    return admin.firestore();
  } catch (error) {
    console.error("Failed to initialize Firebase:", error);
    throw error;
  }
}

async function validateCollection(
  db: FirebaseFirestore.Firestore,
  collectionName: string,
  validator: (doc: FirebaseFirestore.DocumentData) => boolean,
  options: ValidationOptions = {}
): Promise<ValidationResult> {
  const result: ValidationResult = {
    collection: collectionName,
    documentsChecked: 0,
    documentsValid: 0,
    errors: [],
    details: {},
  };

  try {
    let query = db.collection(collectionName)
      .orderBy("lastUpdated", "desc");

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.groupId && (collectionName === COLLECTION.CARDS || collectionName === COLLECTION.PRICES)) {
      query = query.where("groupId", "==", options.groupId);
    }

    const snapshot = await query.get();
    result.documentsChecked = snapshot.size;

    snapshot.forEach((doc) => {
      const data = doc.data();
      try {
        if (validator(data)) {
          result.documentsValid++;
          if (options.verbose) {
            result.details![doc.id] = data;
          }
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

async function validateSync(options: ValidationOptions = {}) {
  console.log("Starting sync validation...");
  console.log("Options:", JSON.stringify(options, null, 2));

  try {
    const db = await initializeFirebase();

    // Validate cards
    const cardResult = await validateCollection(db, COLLECTION.CARDS, (data) => {
      return (
        typeof data.productId === "number" &&
        typeof data.name === "string" &&
        typeof data.lastUpdated === "object" &&
        data.lastUpdated instanceof Timestamp
      );
    }, options);

    // Validate prices
    const priceResult = await validateCollection(db, COLLECTION.PRICES, (data) => {
      return (
        data.lastUpdated instanceof Timestamp &&
        (!data.normal || typeof data.normal.midPrice === "number") &&
        (!data.foil || typeof data.foil.midPrice === "number")
      );
    }, options);

    // Validate sync metadata
    const metadataResult = await validateCollection(db, COLLECTION.SYNC_METADATA, (data) => {
      return (
        data.lastSync instanceof Timestamp &&
        typeof data.status === "string" &&
        typeof data.cardCount === "number" &&
        Array.isArray(data.errors)
      );
    }, options);

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
      if (options.verbose && result.details) {
        console.log("\nDetails:");
        console.log(JSON.stringify(result.details, null, 2));
      }
    });
  } catch (error) {
    console.error("Validation failed:", error);
    process.exit(1);
  }
}

// Execute validation with command line arguments
const args = process.argv.slice(2);
const options: ValidationOptions = {
  limit: args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : undefined,
  verbose: args.includes("--verbose"),
  groupId: args.includes("--groupId") ? args[args.indexOf("--groupId") + 1] : undefined,
};

validateSync(options).then(() => {
  console.log("\nValidation completed!");
}).catch(console.error);
