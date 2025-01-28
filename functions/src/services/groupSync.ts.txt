// src/services/groupSync.ts
import { db, COLLECTION } from "../config/firebase";
import { tcgcsvApi } from "../utils/api";
import { logger } from "../utils/logger";
import { RateLimiter } from "../utils/rateLimiter";
import { Cache } from "../utils/cache";
import { RetryWithBackoff } from "../utils/retry";
import * as crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";

interface Group {
  groupId: number;
  name: string;
  abbreviation: string;
  publishedOn: string;
  modifiedOn: string;
}

interface GroupHashData {
  groupId: number;
  modifiedOn: string;
}

interface SyncResult {
  success: boolean;
  itemsProcessed: number;
  itemsUpdated: number;
  errors: string[];
  timing: {
    startTime: Date;
    endTime?: Date;
    duration?: number;
  };
}

export class GroupSyncService {
  private readonly BATCH_SIZE = 500;
  private readonly rateLimiter = new RateLimiter();
  private readonly cache = new Cache<string>(15);
  private readonly retry = new RetryWithBackoff();

  private calculateHash(data: GroupHashData): string {
    return crypto
      .createHash("md5")
      .update(JSON.stringify(data))
      .digest("hex");
  }

  private async getStoredHashes(groupIds: number[]): Promise<Map<number, string>> {
    const hashMap = new Map<number, string>();
    const uncachedIds: number[] = [];

    // Check cache first
    groupIds.forEach((id) => {
      const cacheKey = `group_hash_${id}`;
      const cached = this.cache.get(cacheKey);
      if (cached) {
        hashMap.set(id, cached);
      } else {
        uncachedIds.push(id);
      }
    });

    if (uncachedIds.length === 0) {
      return hashMap;
    }

    // Batch get uncached hashes
    const chunks = [];
    for (let i = 0; i < uncachedIds.length; i += 10) {
      chunks.push(uncachedIds.slice(i, i + 10));
    }

    await Promise.all(
      chunks.map(async (chunk) => {
        const refs = chunk.map((id) =>
          db.collection("groupHashes").doc(id.toString())
        );

        const snapshots = await this.retry.execute(() => db.getAll(...refs));

        snapshots.forEach((snap, index) => {
          const id = chunk[index];
          const hash = snap.exists ? snap.data()?.hash : null;
          if (hash) {
            hashMap.set(id, hash);
            this.cache.set(`group_hash_${id}`, hash);
          }
        });
      })
    );

    return hashMap;
  }

  private async processGroupBatch(
    groups: Group[],
    options: { forceUpdate?: boolean } = {}
  ): Promise<{
    processed: number;
    updated: number;
    errors: string[];
  }> {
    const result = {
      processed: 0,
      updated: 0,
      errors: [] as string[],
    };

    try {
      // Pre-fetch all hashes in one go
      const groupIds = groups.map((group) => group.groupId);
      const hashMap = await this.getStoredHashes(groupIds);

      let batch = db.batch();
      let batchCount = 0;

      for (const group of groups) {
        try {
          result.processed++;

          const hashData: GroupHashData = {
            groupId: group.groupId,
            modifiedOn: group.modifiedOn,
          };

          const currentHash = this.calculateHash(hashData);
          const storedHash = hashMap.get(group.groupId);

          if (currentHash === storedHash && !options.forceUpdate) {
            logger.info(`Skipping group ${group.groupId} - no changes`);
            continue;
          }

          // Prepare group document
          const groupDoc = {
            groupId: group.groupId,
            name: group.name,
            abbreviation: group.abbreviation,
            publishedOn: group.publishedOn,
            modifiedOn: group.modifiedOn,
            lastUpdated: FieldValue.serverTimestamp(),
          };

          // Add to batch
          const groupRef = db.collection(COLLECTION.GROUPS).doc(group.groupId.toString());
          batch.set(groupRef, groupDoc, { merge: true });
          batchCount++;

          // Update hash
          const hashRef = db.collection(COLLECTION.GROUP_HASHES).doc(group.groupId.toString());
          batch.set(
            hashRef,
            {
              hash: currentHash,
              lastUpdated: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          batchCount++;

          // Update cache
          this.cache.set(`group_hash_${group.groupId}`, currentHash);

          // Commit batch if reaching limit
          if (batchCount >= this.BATCH_SIZE) {
            await this.rateLimiter.add(() =>
              this.retry.execute(() => batch.commit())
            );
            batch = db.batch();
            batchCount = 0;
          }

          result.updated++;
          logger.info(`Updated group ${group.groupId}: ${group.name}`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          result.errors.push(
            `Error processing group ${group.groupId}: ${errorMessage}`
          );
        }
      }

      // Commit any remaining operations
      if (batchCount > 0) {
        await this.rateLimiter.add(() =>
          this.retry.execute(() => batch.commit())
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Batch processing error: ${errorMessage}`);
    }

    return result;
  }

  async syncGroups(options: {
    forceUpdate?: boolean;
  } = {}): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      itemsProcessed: 0,
      itemsUpdated: 0,
      errors: [],
      timing: {
        startTime: new Date(),
      },
    };

    try {
      logger.info("Starting group sync", { options });

      const groups = await tcgcsvApi.getGroups();
      logger.info(`Found ${groups.length} groups to process`);

      const batchResults = await this.processGroupBatch(
        groups as unknown as Group[],
        options
      );

      result.itemsProcessed = batchResults.processed;
      result.itemsUpdated = batchResults.updated;
      result.errors.push(...batchResults.errors);
    } catch (error) {
      result.success = false;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Group sync failed: ${errorMessage}`);
      logger.error("Group sync failed", { error: errorMessage });
    }

    // Calculate final timing
    result.timing.endTime = new Date();
    result.timing.duration =
      (result.timing.endTime.getTime() - result.timing.startTime.getTime()) / 1000;

    logger.info(`Group sync completed in ${result.timing.duration}s`, {
      processed: result.itemsProcessed,
      updated: result.itemsUpdated,
      errors: result.errors.length,
      timing: result.timing,
    });

    return result;
  }
}

export const groupSync = new GroupSyncService();
