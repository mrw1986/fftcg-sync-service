// src/test/verifyMigration.ts

import {db, COLLECTION} from "../config/firebase";
import {r2Storage} from "../services/r2Storage";
import {logInfo} from "../utils/logger";
import type {
  Query,
  DocumentData,
  CollectionReference,
} from "@google-cloud/firestore";

interface VerificationStats {
  total: number;
  withHighRes: number;
  withLowRes: number;
  withOldImageUrl: number;
  withValidR2Urls: number;
  errors: string[];
}

interface ExtendedData {
  name: string;
  value: string;
}

async function verifyMigration(groupId?: string, limit?: number) {
  const stats: VerificationStats = {
    total: 0,
    withHighRes: 0,
    withLowRes: 0,
    withOldImageUrl: 0,
    withValidR2Urls: 0,
    errors: [],
  };

  try {
    console.log("\nStarting migration verification...");

    const cardsCollection = db.collection(
      COLLECTION.CARDS
    ) as CollectionReference<DocumentData>;
    let query: Query<DocumentData> = cardsCollection;

    if (groupId) {
      query = query.where("groupId", "==", groupId);
    }
    if (limit) {
      query = query.limit(limit);
    }

    const snapshot = await query.get();
    stats.total = snapshot.size;

    console.log(`Found ${stats.total} cards to verify`);

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const extendedData = data.extendedData as ExtendedData[];
      const cardNumber = extendedData?.find(
        (field) => field.name === "Number"
      )?.value;
      const cardName = data.name || "Unknown Card";
      const cardId = cardNumber ?
        `${data.productId}_${cardNumber}` :
        `${data.productId}`;

      console.log(`\nVerifying card: ${cardName} (${cardId})`);
      console.log(`Group ID: ${data.groupId}`);
      console.log(`Card Number: ${cardNumber || "Not found"}`);

      // Check URLs
      if (data.highResUrl) {
        stats.withHighRes++;
        console.log(`High-res URL: ${data.highResUrl}`);
      }
      if (data.lowResUrl) {
        stats.withLowRes++;
        console.log(`Low-res URL: ${data.lowResUrl}`);
      }
      if (data.imageUrl) {
        stats.withOldImageUrl++;
        console.log(`Old image URL found: ${data.imageUrl}`);
      }

      if (!cardNumber) {
        stats.errors.push(
          `Missing card number for ${cardName} (${data.productId})`
        );
        continue;
      }

      // Verify R2 files exist
      if (data.highResUrl && data.lowResUrl) {
        try {
          const sanitizedCardNumber = cardNumber.replace(/\//g, "_");
          const highResPath = `${data.groupId}/${data.productId}_${sanitizedCardNumber}_400w.jpg`;
          const lowResPath = `${data.groupId}/${data.productId}_${sanitizedCardNumber}_200w.jpg`;

          console.log("Checking R2 paths:");
          console.log(`High-res: ${highResPath}`);
          console.log(`Low-res: ${lowResPath}`);

          const [highResExists, lowResExists] = await Promise.all([
            r2Storage.fileExists(highResPath),
            r2Storage.fileExists(lowResPath),
          ]);

          if (highResExists && lowResExists) {
            stats.withValidR2Urls++;
            console.log("✅ R2 files verified successfully");
          } else {
            stats.errors.push(
              `Missing R2 files for ${cardName} (${cardId}): ` +
                `High-res: ${highResExists}, Low-res: ${lowResExists}`
            );
            console.log("❌ R2 files verification failed");
          }

          // Verify URLs are accessible
          const [highResResponse, lowResResponse] = await Promise.all([
            fetch(data.highResUrl, {method: "HEAD"}),
            fetch(data.lowResUrl, {method: "HEAD"}),
          ]);

          console.log("URL Accessibility:");
          console.log(
            `High-res (${highResResponse.status}): ${
              highResResponse.ok ? "✅" : "❌"
            }`
          );
          console.log(
            `Low-res (${lowResResponse.status}): ${
              lowResResponse.ok ? "✅" : "❌"
            }`
          );

          if (!highResResponse.ok || !lowResResponse.ok) {
            stats.errors.push(
              `Invalid URLs for ${cardName} (${cardId}): ` +
                `High-res: ${highResResponse.status}, ` +
                `Low-res: ${lowResResponse.status}`
            );
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          stats.errors.push(
            `Error verifying ${cardName} (${cardId}): ${errorMessage}`
          );
          console.log(`❌ Verification error: ${errorMessage}`);
        }
      } else {
        console.log("⚠️ Missing image URLs");
        if (!data.highResUrl) {
          stats.errors.push(`Missing high-res URL for ${cardName} (${cardId})`);
        }
        if (!data.lowResUrl) {
          stats.errors.push(`Missing low-res URL for ${cardName} (${cardId})`);
        }
      }
    }

    // Print summary
    console.log("\n=== Verification Summary ===");
    console.log(`Total cards checked: ${stats.total}`);
    console.log(`Cards with high-res URLs: ${stats.withHighRes}`);
    console.log(`Cards with low-res URLs: ${stats.withLowRes}`);
    console.log(`Cards with old image URLs: ${stats.withOldImageUrl}`);
    console.log(`Cards with verified R2 URLs: ${stats.withValidR2Urls}`);

    if (stats.errors.length > 0) {
      console.log("\nErrors found:");
      stats.errors.forEach((error) => console.log(`- ${error}`));
    }

    await logInfo("Migration verification completed", {stats});
  } catch (error) {
    console.error("Verification failed:", error);
    throw error;
  }
}

// Execute if run directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    groupId: args.includes("--group-id") ?
      args[args.indexOf("--group-id") + 1] :
      undefined,
    limit: args.includes("--limit") ?
      parseInt(args[args.indexOf("--limit") + 1]) :
      undefined,
  };

  verifyMigration(options.groupId, options.limit)
    .then(() => {
      console.log("\nVerification completed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Verification failed:", error);
      process.exit(1);
    });
}
