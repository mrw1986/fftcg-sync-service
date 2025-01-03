import { db } from "../config/firebase";
import { logger } from "./logger";

export class RetentionService {
  private readonly RETENTION_CONFIG = {
    logs: 7,
    cardHashes: 7,
    priceHashes: 7,
    syncMetadata: 7,
  };

  async cleanOldData(): Promise<void> {
    try {
      logger.info("Starting data retention cleanup");

      for (const [collection, days] of Object.entries(this.RETENTION_CONFIG)) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);

        const snapshot = await db.collection(collection).where("lastUpdated", "<", cutoff).get();

        if (!snapshot.empty) {
          const batch = db.batch();
          snapshot.docs.forEach((doc) => batch.delete(doc.ref));
          await batch.commit();

          logger.info(`Cleaned up ${snapshot.size} documents from ${collection}`);
        }
      }

      logger.info("Data retention cleanup completed");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Data retention cleanup failed", { error: errorMessage });
      throw error;
    }
  }
}

export const retention = new RetentionService();
