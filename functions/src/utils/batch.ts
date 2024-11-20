import {logInfo} from "./logger";

export interface BatchProcessorOptions {
  batchSize?: number;
  delayBetweenBatches?: number;
  onBatchComplete?: (processedCount: number, totalCount: number) => Promise<void>;
}

export async function processBatch<TItem>(
  items: TItem[],
  processor: (batch: TItem[]) => Promise<void>,
  options: BatchProcessorOptions = {}
): Promise<void> {
  const {
    batchSize = 500,
    delayBetweenBatches = 100,
    onBatchComplete,
  } = options;

  const totalBatches = Math.ceil(items.length / batchSize);
  let processedCount = 0;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;

    await processor(batch);
    processedCount += batch.length;

    if (onBatchComplete) {
      await onBatchComplete(processedCount, items.length);
    }

    logInfo(`Processed batch ${batchNumber}/${totalBatches} (${processedCount}/${items.length} items)`);

    if (i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches));
    }
  }
}
