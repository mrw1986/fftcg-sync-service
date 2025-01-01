import {db, COLLECTION} from "../config/firebase";
import {CardPrice, HistoricalPrice} from "../types";
import {logInfo, logError} from "../utils/logger";
import {processBatch} from "../utils/syncUtils";

export class HistoricalPriceSync {
  async saveDailyPrices(prices: CardPrice[]): Promise<void> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Normalize to start of day

      let totalSaved = 0;

      // Group prices by productId to combine normal and foil prices
      const priceMap = new Map<number, HistoricalPrice>();

      for (const price of prices) {
        const historicalPrice = priceMap.get(price.productId) || {
          productId: price.productId,
          date: today,
          prices: {},
          groupId: "", // We'll get this from the cards collection
          cardNumber: price.cardNumber,
        };

        // Update prices based on subTypeName
        if (price.subTypeName === "Normal") {
          historicalPrice.prices.normal = {
            low: price.lowPrice,
            mid: price.midPrice,
            high: price.highPrice,
            market: price.marketPrice,
            directLow: price.directLowPrice,
          };
        } else if (price.subTypeName === "Foil") {
          historicalPrice.prices.foil = {
            low: price.lowPrice,
            mid: price.midPrice,
            high: price.highPrice,
            market: price.marketPrice,
            directLow: price.directLowPrice,
          };
        }

        priceMap.set(price.productId, historicalPrice);
      }

      // Process the grouped prices
      await processBatch(
        Array.from(priceMap.values()),
        async (batch) => {
          const writeBatch = db.batch();

          for (const price of batch) {
            // Look up the card to get the groupId
            const cardDoc = await db
              .collection(COLLECTION.CARDS)
              .where("productId", "==", price.productId)
              .limit(1)
              .get();

            if (!cardDoc.empty) {
              price.groupId = cardDoc.docs[0].data().groupId.toString();
            }

            const docId = `${price.productId}_${
              today.toISOString().split("T")[0]
            }`;
            writeBatch.set(
              db.collection(COLLECTION.HISTORICAL_PRICES).doc(docId),
              price,
              {merge: true}
            );

            totalSaved++;
          }

          await writeBatch.commit();
        },
        {batchSize: 500}
      );

      await logInfo("Historical prices saved", {
        totalSaved,
        date: today.toISOString(),
      });
    } catch (error) {
      const err = {
        message:
          error instanceof Error ?
            error.message :
            "Failed to save historical prices",
        name: error instanceof Error ? error.name : "HistoricalPriceError",
        code: "HISTORICAL_PRICE_SAVE_ERROR",
      };
      await logError(err, "Historical price save failed");
      throw error;
    }
  }

  async getHistoricalPrices(
    productId: number,
    days: number = 30
  ): Promise<HistoricalPrice[]> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const snapshot = await db
      .collection(COLLECTION.HISTORICAL_PRICES)
      .where("productId", "==", productId)
      .where("date", ">=", startDate)
      .where("date", "<=", endDate)
      .orderBy("date", "desc")
      .get();

    return snapshot.docs.map((doc) => doc.data() as HistoricalPrice);
  }
}

export const historicalPriceSync = new HistoricalPriceSync();
