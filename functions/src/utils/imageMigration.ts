import {db, COLLECTION} from "../config/firebase";
import {logError, logInfo} from "./logger";
import {imageHandler} from "./imageHandler";
import {CardProduct} from "../types";
import {isNonCardProduct} from "./productValidation";

function getCardNumber(product: CardProduct): string {
  // Skip card number validation for non-card products
  if (isNonCardProduct(product.name)) {
    return product.productId.toString();
  }

  const numberField = product.extendedData.find(
    (data) => data.name === "Number"
  );
  if (!numberField) {
    throw new Error(`Missing card number for productId: ${product.productId}`);
  }
  return numberField.value;
}

export async function migrateImages(): Promise<void> {
  try {
    const snapshot = await db.collection(COLLECTION.CARDS).get();
    let processed = 0;
    let failed = 0;

    for (const doc of snapshot.docs) {
      const card = doc.data() as CardProduct;

      try {
        if (!card.imageUrl) {
          continue;
        }

        const isNonCard = isNonCardProduct(card.name);
        const cardNumber = isNonCard ?
          card.productId.toString() :
          getCardNumber(card);

        // Use the new processAndStoreImage method
        const result = await imageHandler.processAndStoreImage(
          card.imageUrl,
          card.productId,
          card.groupId.toString(),
          cardNumber
        );

        // Update the document with new URLs
        await doc.ref.update({
          highResUrl: result.highResUrl,
          lowResUrl: result.lowResUrl,
          imageMetadata: result.metadata,
          lastUpdated: new Date(),
          imageUrl: null, // Remove the old imageUrl
        });

        await logInfo("Migrated image", {
          productId: card.productId,
          groupId: card.groupId,
          highResUrl: result.highResUrl,
          lowResUrl: result.lowResUrl,
          updated: result.updated,
        });

        processed++;
      } catch (error) {
        failed++;
        await logError(
          {
            message: error instanceof Error ? error.message : "Unknown error",
            name: error instanceof Error ? error.name : "UnknownError",
            code: "IMAGE_MIGRATION_ERROR",
          },
          `Failed to migrate image for ${card.productId}`
        );
      }
    }

    await logInfo("Migration completed", {
      processed,
      failed,
      total: snapshot.size,
    });
  } catch (error) {
    await logError(
      {
        message: error instanceof Error ? error.message : "Unknown error",
        name: error instanceof Error ? error.name : "UnknownError",
        code: "MIGRATION_ERROR",
      },
      "Failed to complete migration"
    );
    throw error;
  }
}
