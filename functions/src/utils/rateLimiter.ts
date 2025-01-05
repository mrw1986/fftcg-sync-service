// src/utils/rateLimiter.ts
import { logger } from "./logger";

export class RateLimiter {
  private queue: Array<() => Promise<unknown>> = [];
  private processing = false;
  private readonly maxRate: number;
  private readonly interval: number;
  private readonly maxConcurrent: number;
  private currentConcurrent = 0;

  private readonly tokenBucket = {
    tokens: 0,
    lastRefill: Date.now(),
  };

  private readonly statistics = {
    totalProcessed: 0,
    totalQueued: 0,
    maxQueueLength: 0,
    totalWaitTime: 0,
  };

  constructor(maxRate = 500, intervalMs = 1000, maxConcurrent = 5) {
    this.maxRate = maxRate;
    this.interval = intervalMs;
    this.maxConcurrent = maxConcurrent;
    this.tokenBucket.tokens = maxRate;

    // Start periodic statistics logging
    setInterval(() => this.logStatistics(), 5 * 60 * 1000); // Every 5 minutes
  }

  private refillTokens(): number {
    const now = Date.now();
    const timePassed = now - this.tokenBucket.lastRefill;
    const refillAmount = Math.floor((timePassed / this.interval) * this.maxRate);

    this.tokenBucket.tokens = Math.min(this.maxRate, this.tokenBucket.tokens + refillAmount);
    this.tokenBucket.lastRefill = now;

    return this.tokenBucket.tokens;
  }

  private async acquireToken(): Promise<void> {
    while (this.tokenBucket.tokens <= 0) {
      const sleepTime = Math.ceil(this.interval / this.maxRate);
      await new Promise((resolve) => setTimeout(resolve, sleepTime));
      this.refillTokens();
    }
    this.tokenBucket.tokens--;
  }

  async add<T>(operation: () => Promise<T>): Promise<T> {
    const queueStartTime = Date.now();
    this.statistics.totalQueued++;
    this.statistics.maxQueueLength = Math.max(this.statistics.maxQueueLength, this.queue.length + 1);

    return new Promise<T>((resolve, reject) => {
      const wrappedOperation = async () => {
        try {
          await this.acquireToken();
          const result = await operation();

          this.statistics.totalProcessed++;
          this.statistics.totalWaitTime += Date.now() - queueStartTime;

          resolve(result);
          return result;
        } catch (error) {
          reject(error);
          throw error;
        }
      };

      this.queue.push(wrappedOperation);

      if (!this.processing) {
        void this.process();
      }
    });
  }

  private async process(): Promise<void> {
    this.processing = true;
    const batchSize = Math.floor(this.maxRate / (this.interval / 1000));

    while (this.queue.length > 0) {
      if (this.currentConcurrent >= this.maxConcurrent) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      const batch = this.queue.splice(0, Math.min(batchSize, this.queue.length));
      this.currentConcurrent++;

      try {
        await Promise.all(
          batch.map((op) =>
            op().finally(() => {
              this.currentConcurrent--;
            })
          )
        );
      } catch (error) {
        logger.error("Error processing rate-limited batch", { error });
      }

      if (this.queue.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.interval));
      }
    }

    this.processing = false;
  }

  private logStatistics(): void {
    const avgWaitTime =
      this.statistics.totalProcessed > 0 ? this.statistics.totalWaitTime / this.statistics.totalProcessed : 0;

    logger.info("Rate limiter statistics", {
      totalProcessed: this.statistics.totalProcessed,
      totalQueued: this.statistics.totalQueued,
      maxQueueLength: this.statistics.maxQueueLength,
      averageWaitTime: `${(avgWaitTime / 1000).toFixed(2)}s`,
      currentQueueLength: this.queue.length,
      currentConcurrent: this.currentConcurrent,
      availableTokens: this.tokenBucket.tokens,
    });
  }

  getStatistics() {
    return { ...this.statistics };
  }
}
