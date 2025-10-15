// src/scripts/incrementalSync.ts
import { cardSync } from "../services/cardSync";
import { logger } from "../utils/logger";
import { db, COLLECTION } from "../config/firebase";
import { metadataService } from "../services/metadataService";
import { tcgcsvApi } from "../utils/api";
import minimist from "minimist";

interface SyncProgress {
  currentGroupIndex: number;
  currentCardIndex: number;
  totalGroups: number;
  totalCardsProcessed: number;
  startTime: Date;
  lastCheckpoint: Date;
}

class IncrementalSyncService {
  private readonly CARDS_PER_BATCH = 50; // Reduced from 1000
  private readonly DELAY_BETWEEN_BATCHES = 2000; // 2 second delay
  private readonly CHECKPOINT_INTERVAL = 100; // Save progress every 100 cards
  private readonly MAX_EXECUTION_TIME = 480; // 8 minutes (safer margin)

  private async saveProgress(syncId: string, progress: SyncProgress): Promise<void> {
    await db
      .collection(COLLECTION.SYNC_METADATA)
      .doc(`progress_${syncId}`)
      .set({
        ...progress,
        lastUpdated: new Date(),
      });
  }

  private async loadProgress(syncId: string): Promise<SyncProgress | null> {
    const doc = await db.collection(COLLECTION.SYNC_METADATA).doc(`progress_${syncId}`).get();
    if (doc.exists) {
      const data = doc.data();
      return {
        currentGroupIndex: data?.currentGroupIndex || 0,
        currentCardIndex: data?.currentCardIndex || 0,
        totalGroups: data?.totalGroups || 0,
        totalCardsProcessed: data?.totalCardsProcessed || 0,
        startTime: data?.startTime?.toDate() || new Date(),
        lastCheckpoint: data?.lastCheckpoint?.toDate() || new Date(),
      };
    }
    return null;
  }

  private isApproachingTimeout(startTime: Date): boolean {
    const executionTime = (new Date().getTime() - startTime.getTime()) / 1000;
    return executionTime > this.MAX_EXECUTION_TIME;
  }

  private async waitWithBackoff(baseDelay: number, attempt = 0): Promise<void> {
    const delay = Math.min(baseDelay * Math.pow(2, attempt), 10000); // Max 10 seconds
    logger.info(`Waiting ${delay}ms before next batch...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  async runIncrementalSync(
    options: {
      forceUpdate?: boolean;
      groupId?: string;
      resumeFromProgress?: boolean;
    } = {}
  ): Promise<void> {
    const syncId = `incremental_${Date.now()}`;
    const startTime = new Date();

    try {
      await logger.startSync();
      logger.info("Starting incremental sync", { syncId, options });

      // Initialize metadata
      await metadataService.initializeMetadata();
      await metadataService.startSync();

      // Get groups to process
      const groups = options.groupId ? [{ groupId: options.groupId }] : await tcgcsvApi.getGroups();

      // Load existing progress if resuming
      let progress: SyncProgress;
      if (options.resumeFromProgress) {
        const savedProgress = await this.loadProgress(syncId);
        if (savedProgress) {
          progress = savedProgress;
          logger.info("Resuming from saved progress", {
            currentGroupIndex: progress.currentGroupIndex,
            currentCardIndex: progress.currentCardIndex,
            totalCardsProcessed: progress.totalCardsProcessed,
          });
        } else {
          progress = this.initializeProgress(groups.length, startTime);
        }
      } else {
        progress = this.initializeProgress(groups.length, startTime);
      }

      // Process groups incrementally
      for (let groupIndex = progress.currentGroupIndex; groupIndex < groups.length; groupIndex++) {
        if (this.isApproachingTimeout(startTime)) {
          logger.warn("Approaching timeout, saving progress and stopping");
          progress.currentGroupIndex = groupIndex;
          await this.saveProgress(syncId, progress);
          throw new Error("Sync paused due to timeout - resume with --resume flag");
        }

        const group = groups[groupIndex];
        logger.info(`Processing group ${group.groupId} (${groupIndex + 1}/${groups.length})`);

        try {
          // Get cards for this group
          const allCards = await tcgcsvApi.getGroupProducts(group.groupId);

          // Process cards in small batches with delays
          for (
            let cardIndex = progress.currentCardIndex;
            cardIndex < allCards.length;
            cardIndex += this.CARDS_PER_BATCH
          ) {
            if (this.isApproachingTimeout(startTime)) {
              progress.currentGroupIndex = groupIndex;
              progress.currentCardIndex = cardIndex;
              await this.saveProgress(syncId, progress);
              throw new Error("Sync paused due to timeout - resume with --resume flag");
            }

            const cardBatch = allCards.slice(cardIndex, cardIndex + this.CARDS_PER_BATCH);

            let retryAttempt = 0;
            const maxRetries = 3;

            while (retryAttempt < maxRetries) {
              try {
                logger.info(
                  `Processing cards ${cardIndex + 1}-${Math.min(
                    cardIndex + this.CARDS_PER_BATCH,
                    allCards.length
                  )} of ${allCards.length} in group ${group.groupId}`
                );

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const batchResult = await (cardSync as any).processCards(cardBatch, parseInt(group.groupId), {
                  forceUpdate: options.forceUpdate || false,
                });

                progress.totalCardsProcessed += batchResult.processed;

                // Save checkpoint periodically
                if (progress.totalCardsProcessed % this.CHECKPOINT_INTERVAL === 0) {
                  progress.currentGroupIndex = groupIndex;
                  progress.currentCardIndex = cardIndex + this.CARDS_PER_BATCH;
                  progress.lastCheckpoint = new Date();
                  await this.saveProgress(syncId, progress);
                  logger.info("Checkpoint saved", {
                    totalProcessed: progress.totalCardsProcessed,
                    currentGroup: `${groupIndex + 1}/${groups.length}`,
                    currentCard: `${cardIndex + this.CARDS_PER_BATCH}/${allCards.length}`,
                  });
                }

                // Successful batch, break retry loop
                break;
              } catch (error) {
                retryAttempt++;
                const errorMessage = error instanceof Error ? error.message : "Unknown error";

                if (errorMessage.includes("RESOURCE_EXHAUSTED") || errorMessage.includes("Quota exceeded")) {
                  logger.warn(`Quota exhausted, attempt ${retryAttempt}/${maxRetries}`, { error: errorMessage });
                  if (retryAttempt < maxRetries) {
                    await this.waitWithBackoff(this.DELAY_BETWEEN_BATCHES, retryAttempt);
                    continue;
                  }
                }

                if (retryAttempt >= maxRetries) {
                  throw new Error(`Failed to process batch after ${maxRetries} attempts: ${errorMessage}`);
                }
              }
            }

            // Add delay between batches to avoid quota issues
            if (cardIndex + this.CARDS_PER_BATCH < allCards.length) {
              await this.waitWithBackoff(this.DELAY_BETWEEN_BATCHES);
            }
          }

          // Reset card index for next group
          progress.currentCardIndex = 0;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          logger.error(`Error processing group ${group.groupId}`, { error: errorMessage });

          if (errorMessage.includes("timeout") || errorMessage.includes("paused")) {
            throw error; // Re-throw timeout errors to stop sync
          }

          // Continue with next group for other errors
          await metadataService.addSyncError(`Group ${group.groupId} failed: ${errorMessage}`);
        }
      }

      // Sync completed successfully
      logger.info("Incremental sync completed successfully", {
        totalCardsProcessed: progress.totalCardsProcessed,
        duration: `${(new Date().getTime() - startTime.getTime()) / 1000}s`,
      });

      // Clean up progress tracking
      await db.collection(COLLECTION.SYNC_METADATA).doc(`progress_${syncId}`).delete();

      // Mark sync as completed
      await metadataService.completeSync(true, progress.totalCardsProcessed, groups.length);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("Incremental sync failed", { error: errorMessage, syncId });

      await metadataService.completeSync(false);
      await metadataService.addSyncError(errorMessage);

      if (!errorMessage.includes("paused")) {
        throw error;
      } else {
        logger.info("Sync paused - can be resumed later");
      }
    } finally {
      await logger.disableFirestore();
      await db.terminate();
    }
  }

  private initializeProgress(totalGroups: number, startTime: Date): SyncProgress {
    return {
      currentGroupIndex: 0,
      currentCardIndex: 0,
      totalGroups,
      totalCardsProcessed: 0,
      startTime,
      lastCheckpoint: startTime,
    };
  }
}

// CLI interface
function parseArgs(): { forceUpdate?: boolean; groupId?: string; resume?: boolean } {
  const argv = minimist(process.argv.slice(2), {
    boolean: ["force", "resume"],
    string: ["group"],
    alias: {
      f: "force",
      g: "group",
      r: "resume",
    },
  });

  const options: { forceUpdate?: boolean; groupId?: string; resume?: boolean } = {};

  if (argv.force) options.forceUpdate = true;
  if (argv.resume) options.resume = true;
  if (argv.group) options.groupId = argv.group;

  logger.info("Parsed incremental sync options:", options);
  return options;
}

async function main() {
  try {
    const options = parseArgs();
    const syncService = new IncrementalSyncService();

    await syncService.runIncrementalSync({
      forceUpdate: options.forceUpdate,
      groupId: options.groupId,
      resumeFromProgress: options.resume,
    });

    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Incremental sync process failed:", { error: errorMessage });

    if (errorMessage.includes("paused")) {
      logger.info("Use 'npx ts-node src/scripts/incrementalSync.ts --resume' to continue");
      process.exit(0);
    } else {
      process.exit(1);
    }
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { IncrementalSyncService };
