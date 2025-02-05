import { Firestore, WriteBatch } from "firebase-admin/firestore";

export class OptimizedBatchProcessor {
  private batchPool: WriteBatch[] = [];
  private operationsInBatch: Map<WriteBatch, number> = new Map();
  private activePromises: Promise<void>[] = [];

  private readonly COMMIT_TIMEOUT = 60000; // 60 seconds
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 5000; // 5 seconds

  constructor(
    private readonly db: Firestore,
    private maxConcurrentBatches: number = 20, // Removed readonly to allow dynamic adjustment
    private readonly maxOperationsPerBatch: number = 450
  ) {
    this.initializeBatchPool();
  }

  private initializeBatchPool(): void {
    this.batchPool = [];
    this.operationsInBatch.clear();

    for (let i = 0; i < this.maxConcurrentBatches; i++) {
      const batch = this.db.batch();
      this.batchPool.push(batch);
      this.operationsInBatch.set(batch, 0);
    }
  }

  private getAvailableBatch(): WriteBatch {
    // Try to find a batch with room
    for (const batch of this.batchPool) {
      const operations = this.operationsInBatch.get(batch) || 0;
      if (operations < this.maxOperationsPerBatch) {
        return batch;
      }
    }

    // If all batches are full, create a new one
    const newBatch = this.db.batch();

    // Find the index of a full batch to replace
    const indexToReplace = this.batchPool.findIndex((batch) =>
      (this.operationsInBatch.get(batch) || 0) >= this.maxOperationsPerBatch
    );

    if (indexToReplace >= 0) {
      // Commit the full batch
      const batchToCommit = this.batchPool[indexToReplace];
      const commitPromise = this.commitBatch(batchToCommit);
      this.activePromises.push(commitPromise);

      // Replace it with the new batch
      this.batchPool[indexToReplace] = newBatch;
    } else {
      // If no full batch found, add to pool if there's room
      if (this.batchPool.length < this.maxConcurrentBatches) {
        this.batchPool.push(newBatch);
      } else {
        // Replace the first batch
        const batchToCommit = this.batchPool[0];
        const commitPromise = this.commitBatch(batchToCommit);
        this.activePromises.push(commitPromise);
        this.batchPool[0] = newBatch;
      }
    }

    this.operationsInBatch.set(newBatch, 0);
    return newBatch;
  }

  async addOperation(operation: (batch: WriteBatch) => void): Promise<void> {
    const batch = this.getAvailableBatch();
    operation(batch);
    this.operationsInBatch.set(batch, (this.operationsInBatch.get(batch) || 0) + 1);

    // Clean up completed promises
    const newActivePromises: Promise<void>[] = [];

    await Promise.all(
      this.activePromises.map(async (promise) => {
        try {
          const isCompleted = await Promise.race([
            promise.then(() => true),
            Promise.resolve(false),
          ]);

          if (!isCompleted) {
            newActivePromises.push(promise);
          }
        } catch (error) {
          newActivePromises.push(promise);
        }
      })
    );

    this.activePromises = newActivePromises;

    // If we have too many active promises, wait for one to complete
    if (this.activePromises.length >= this.maxConcurrentBatches) {
      await Promise.race(this.activePromises);
    }
  }

  private async commitBatch(batch: WriteBatch, retryCount: number = 0): Promise<void> {
    try {
      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Commit timeout')), this.COMMIT_TIMEOUT);
      });

      // Attempt the commit with timeout
      await Promise.race([
        batch.commit(),
        timeoutPromise
      ]);

      this.operationsInBatch.delete(batch); // Remove the committed batch from tracking
    } catch (error) {
      const typedError = error as { code?: string; details?: string; message?: string };
      const isRetryableError =
        typedError.code === "unavailable" ||
        typedError.code === "4" || // DEADLINE_EXCEEDED
        typedError.message === 'Commit timeout' ||
        (typedError.details && typedError.details.includes('Deadline exceeded'));

      if (isRetryableError && retryCount < this.MAX_RETRIES) {
        // Exponential backoff
        const delay = this.RETRY_DELAY * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.commitBatch(batch, retryCount + 1);
      } else {
        throw error;
      }
    }
  }

  async commitAll(): Promise<void> {
    try {
      // Gather all uncommitted batches
      const uncommittedBatches = this.batchPool.filter((batch) =>
        this.operationsInBatch.has(batch) &&
        (this.operationsInBatch.get(batch) || 0) > 0
      );

      // Process batches in smaller chunks to prevent overwhelming Firestore
      const CHUNK_SIZE = 5;
      for (let i = 0; i < uncommittedBatches.length; i += CHUNK_SIZE) {
        const batchChunk = uncommittedBatches.slice(i, i + CHUNK_SIZE);
        
        // Create commit promises for the current chunk
        const commitPromises = batchChunk.map((batch) => this.commitBatch(batch, 0));
        
        // Wait for current chunk to complete before processing next chunk
        await Promise.all(commitPromises);
        
        // Small delay between chunks to prevent overload
        if (i + CHUNK_SIZE < uncommittedBatches.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Wait for any remaining active promises
      await Promise.all(this.activePromises);

      // Reset the state
      this.activePromises = [];
      this.initializeBatchPool();
    } catch (error) {
      const typedError = error as { code?: string; details?: string; message?: string };
      if (typedError.code === "4" || // DEADLINE_EXCEEDED
          (typedError.details && typedError.details.includes('Deadline exceeded'))) {
        // If we hit a deadline, reduce chunk size and retry
        this.maxConcurrentBatches = Math.max(5, Math.floor(this.maxConcurrentBatches * 0.5));
        await this.commitAll();
      } else {
        throw error;
      }
    }
  }
}
