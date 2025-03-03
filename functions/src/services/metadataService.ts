// src/services/metadataService.ts
import { db, COLLECTION } from "../config/firebase";
import { logger } from "../utils/logger";
import * as admin from "firebase-admin";

export interface SyncMetadata {
  version: number;
  lastUpdated: admin.firestore.Timestamp | string;
  cardCount: number;
  groupCount: number;
  searchIndexed: boolean;
  filtersUpdated: boolean;
  syncStatus: "idle" | "in-progress" | "completed" | "failed";
  syncStartTime?: admin.firestore.Timestamp | string;
  syncEndTime?: admin.firestore.Timestamp | string;
  syncDuration?: number; // in seconds
  syncErrors?: string[];
}

class MetadataService {
  private readonly metadataDocId = "cards";

  /**
   * Get the current metadata document
   * @returns The metadata document or null if it doesn't exist
   */
  async getMetadata(): Promise<SyncMetadata | null> {
    try {
      const doc = await db.collection(COLLECTION.SYNC_METADATA).doc(this.metadataDocId).get();

      if (!doc.exists) {
        logger.info("Metadata document does not exist, will create with default values");
        return null;
      }

      return doc.data() as SyncMetadata;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Error getting metadata document", { error: errorMessage });
      return null;
    }
  }

  /**
   * Create or update the metadata document
   * @param metadata The metadata to set
   * @param merge Whether to merge with existing data (default: true)
   * @returns Success status
   */
  async updateMetadata(metadata: Partial<SyncMetadata>, merge = true): Promise<boolean> {
    try {
      const metadataRef = db.collection(COLLECTION.SYNC_METADATA).doc(this.metadataDocId);

      // If merge is true, we'll merge with existing data
      if (merge) {
        await metadataRef.set(metadata, { merge: true });
      } else {
        await metadataRef.set(metadata);
      }

      logger.info("Metadata document updated successfully", { metadata });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Error updating metadata document", { error: errorMessage });
      return false;
    }
  }

  /**
   * Increment the version number in the metadata document
   * @returns The new version number or null if the operation failed
   */
  async incrementVersion(): Promise<number | null> {
    try {
      const metadataRef = db.collection(COLLECTION.SYNC_METADATA).doc(this.metadataDocId);

      // Use a transaction to safely increment the version
      const newVersion = await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(metadataRef);

        let currentVersion = 1;
        if (doc.exists) {
          const data = doc.data() as SyncMetadata;
          currentVersion = data.version || 1;
        }

        const newVersion = currentVersion + 1;

        transaction.set(
          metadataRef,
          {
            version: newVersion,
            lastUpdated: admin.firestore.Timestamp.now(),
          },
          { merge: true }
        );

        return newVersion;
      });

      logger.info("Metadata version incremented successfully", { newVersion });
      return newVersion;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Error incrementing metadata version", { error: errorMessage });
      return null;
    }
  }

  /**
   * Initialize the metadata document if it doesn't exist
   * @returns The initialized metadata or null if the operation failed
   */
  async initializeMetadata(): Promise<SyncMetadata | null> {
    try {
      const existingMetadata = await this.getMetadata();

      if (existingMetadata) {
        logger.info("Metadata document already exists, no initialization needed");
        return existingMetadata;
      }

      // Get counts for initial metadata
      const [cardCount, groupCount] = await Promise.all([
        db
          .collection(COLLECTION.CARDS)
          .count()
          .get()
          .then((snap) => snap.data().count),
        db
          .collection(COLLECTION.GROUPS)
          .count()
          .get()
          .then((snap) => snap.data().count),
      ]);

      const initialMetadata: SyncMetadata = {
        version: 1,
        lastUpdated: admin.firestore.Timestamp.now(),
        cardCount: cardCount || 0,
        groupCount: groupCount || 0,
        searchIndexed: false,
        filtersUpdated: false,
        syncStatus: "idle",
      };

      const success = await this.updateMetadata(initialMetadata, false);

      if (success) {
        logger.info("Metadata document initialized successfully", { initialMetadata });
        return initialMetadata;
      } else {
        logger.error("Failed to initialize metadata document");
        return null;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Error initializing metadata document", { error: errorMessage });
      return null;
    }
  }

  /**
   * Start a sync process and update the metadata accordingly
   * @returns Success status
   */
  async startSync(): Promise<boolean> {
    try {
      const now = admin.firestore.Timestamp.now();

      const syncMetadata: Partial<SyncMetadata> = {
        syncStatus: "in-progress",
        syncStartTime: now,
        syncErrors: [],
      };

      return await this.updateMetadata(syncMetadata, true);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Error starting sync in metadata", { error: errorMessage });
      return false;
    }
  }

  /**
   * Complete a sync process and update the metadata accordingly
   * @param success Whether the sync was successful
   * @param cardCount The new card count (optional)
   * @param groupCount The new group count (optional)
   * @param searchIndexed Whether the search index was updated (optional)
   * @param filtersUpdated Whether the filters were updated (optional)
   * @returns Success status
   */
  async completeSync(
    success: boolean,
    cardCount?: number,
    groupCount?: number,
    searchIndexed?: boolean,
    filtersUpdated?: boolean
  ): Promise<boolean> {
    try {
      const metadata = await this.getMetadata();
      const now = admin.firestore.Timestamp.now();

      if (!metadata) {
        logger.warn("No metadata document found when completing sync");
        return false;
      }

      const syncStartTime =
        metadata.syncStartTime instanceof admin.firestore.Timestamp ?
          metadata.syncStartTime.toDate() :
          new Date(metadata.syncStartTime || now.toDate());

      const endTime = now.toDate();
      const durationMs = endTime.getTime() - syncStartTime.getTime();
      const durationSeconds = Math.round(durationMs / 1000);

      // If the sync was successful, increment the version
      let newVersion = metadata.version;
      if (success) {
        const incrementResult = await this.incrementVersion();
        if (incrementResult !== null) {
          newVersion = incrementResult;
        }
      }

      // Get updated counts if not provided
      const [actualCardCount, actualGroupCount] = await Promise.all([
        cardCount !== undefined ?
          Promise.resolve(cardCount) :
          db
            .collection(COLLECTION.CARDS)
            .count()
            .get()
            .then((snap) => snap.data().count),
        groupCount !== undefined ?
          Promise.resolve(groupCount) :
          db
            .collection(COLLECTION.GROUPS)
            .count()
            .get()
            .then((snap) => snap.data().count),
      ]);

      const syncMetadata: Partial<SyncMetadata> = {
        version: newVersion,
        lastUpdated: now,
        syncStatus: success ? "completed" : "failed",
        syncEndTime: now,
        syncDuration: durationSeconds,
        cardCount: actualCardCount || metadata.cardCount,
        groupCount: actualGroupCount || metadata.groupCount,
      };

      if (searchIndexed !== undefined) {
        syncMetadata.searchIndexed = searchIndexed;
      }

      if (filtersUpdated !== undefined) {
        syncMetadata.filtersUpdated = filtersUpdated;
      }

      return await this.updateMetadata(syncMetadata, true);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Error completing sync in metadata", { error: errorMessage });
      return false;
    }
  }

  /**
   * Add an error to the sync errors array
   * @param error The error message or object
   * @returns Success status
   */
  async addSyncError(error: string | Error): Promise<boolean> {
    try {
      const errorMessage = error instanceof Error ? error.message : error;

      const metadataRef = db.collection(COLLECTION.SYNC_METADATA).doc(this.metadataDocId);

      await metadataRef.update({
        syncErrors: admin.firestore.FieldValue.arrayUnion(errorMessage),
      });

      logger.info("Added sync error to metadata", { error: errorMessage });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Error adding sync error to metadata", { error: errorMessage });
      return false;
    }
  }
}

export const metadataService = new MetadataService();
