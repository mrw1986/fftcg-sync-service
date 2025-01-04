// src/utils/rateLimiter.ts
import { logger } from "./logger";

export class RateLimiter {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;
  private readonly maxRate = 500; // Firestore's maximum sustained write rate
  private readonly interval = 1000; // 1 second interval
  private readonly maxConcurrent = 3;
  private currentConcurrent = 0;

  async add(operation: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          await operation();
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      if (!this.processing) {
        void this.process();
      }
    });
  }

  private async process(): Promise<void> {
    this.processing = true;
    const batchSize = Math.floor(this.maxRate / (this.interval / 1000));

    while (this.queue.length > 0 && this.currentConcurrent < this.maxConcurrent) {
      const batch = this.queue.splice(0, Math.min(batchSize, this.queue.length));
      this.currentConcurrent++;

      try {
        await Promise.all(batch.map((op) => op()));
      } catch (error) {
        logger.error("Error processing rate-limited batch", { error });
      } finally {
        this.currentConcurrent--;
      }

      if (this.queue.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.interval));
      }
    }

    this.processing = this.queue.length > 0;
    if (this.processing) {
      void this.process();
    }
  }
}
