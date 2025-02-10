import { Firestore, WriteBatch } from "firebase-admin/firestore";

export class OptimizedBatchProcessor {
  private batchPool: WriteBatch[] = [];
  private operationsInBatch: Map<WriteBatch, number> = new Map();
  private activePromises: Promise<void>[] = [];

  constructor(
    private readonly db: Firestore,
    private readonly maxConcurrentBatches: number = 50,
    private readonly maxOperationsPerBatch: number = 500
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
    const indexToReplace = this.batchPool.findIndex(
      (batch) => (this.operationsInBatch.get(batch) || 0) >= this.maxOperationsPerBatch
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
          const isCompleted = await Promise.race([promise.then(() => true), Promise.resolve(false)]);

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

  private async commitBatch(batch: WriteBatch): Promise<void> {
    try {
      await batch.commit();
      this.operationsInBatch.delete(batch); // Remove the committed batch from tracking
    } catch (error) {
      const typedError = error as { code?: string };
      if (typedError.code === "unavailable") {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await this.commitBatch(batch);
      } else {
        throw error;
      }
    }
  }

  async commitAll(): Promise<void> {
    // Gather all uncommitted batches
    const uncommittedBatches = this.batchPool.filter(
      (batch) => this.operationsInBatch.has(batch) && (this.operationsInBatch.get(batch) || 0) > 0
    );

    // Create commit promises for each uncommitted batch
    const commitPromises = uncommittedBatches.map((batch) => this.commitBatch(batch));

    // Wait for all commits to complete
    await Promise.all([...this.activePromises, ...commitPromises]);

    // Reset the state
    this.activePromises = [];
    this.initializeBatchPool();
  }
}
