// src/utils/batch.ts
import { logger } from "./logger";

export interface BatchProcessorOptions<T, R = void> {
  batchSize?: number;
  delayBetweenBatches?: number;
  maxParallelBatches?: number;
  onBatchComplete?: (stats: BatchProcessingStats) => Promise<void>;
  processingFunction: (items: T[]) => Promise<R>;
  onBatchSuccess?: (result: R) => void;
}

export interface BatchProcessingStats {
  total: number;
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
}

export class BatchProcessor<T, R = void> {
  private readonly defaultOptions = {
    batchSize: 100,
    delayBetweenBatches: 1000,
    maxParallelBatches: 3,
  };

  async processBatches(
    items: T[],
    options: BatchProcessorOptions<T, R>
  ): Promise<BatchProcessingStats> {
    const {
      batchSize = this.defaultOptions.batchSize,
      delayBetweenBatches = this.defaultOptions.delayBetweenBatches,
      maxParallelBatches = this.defaultOptions.maxParallelBatches,
      onBatchComplete,
      processingFunction,
      onBatchSuccess,
    } = options;

    const stats: BatchProcessingStats = {
      total: items.length,
      processed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
    };

    // Split items into batches
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    // Process batches with controlled parallelism
    for (let i = 0; i < batches.length; i += maxParallelBatches) {
      const currentBatches = batches.slice(i, i + maxParallelBatches);

      try {
        await Promise.all(
          currentBatches.map(async (batch) => {
            try {
              const result = await processingFunction(batch);
              if (onBatchSuccess) {
                onBatchSuccess(result);
              }
              stats.successful += batch.length;
            } catch (error) {
              logger.error("Batch processing failed", { error });
              stats.failed += batch.length;
            }
            stats.processed += batch.length;

            if (onBatchComplete) {
              await onBatchComplete(stats);
            }
          })
        );

        // Add delay between batch groups
        if (i + maxParallelBatches < batches.length) {
          await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches));
        }
      } catch (error) {
        logger.error("Failed to process batch group", { error });
      }
    }

    return stats;
  }
}

export const batchProcessor = new BatchProcessor();
