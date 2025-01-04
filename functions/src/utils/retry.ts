// src/utils/retry.ts
import { logger } from "./logger";

export class RetryWithBackoff {
  private readonly maxRetries: number;
  private readonly initialDelay: number;
  private readonly maxDelay: number;
  private readonly backoffFactor: number;

  constructor(maxRetries = 3, initialDelay = 1000, maxDelay = 10000, backoffFactor = 2) {
    this.maxRetries = maxRetries;
    this.initialDelay = initialDelay;
    this.maxDelay = maxDelay;
    this.backoffFactor = backoffFactor;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    let delay = this.initialDelay;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === this.maxRetries) {
          break;
        }

        if (this.isNonRetryableError(lastError)) {
          throw lastError;
        }

        logger.info(`Retry attempt ${attempt + 1} of ${this.maxRetries}`, {
          error: lastError.message,
          delay,
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * this.backoffFactor, this.maxDelay);
      }
    }

    throw lastError || new Error("Operation failed after retries");
  }

  private isNonRetryableError(error: Error): boolean {
    const nonRetryableErrors = ["PERMISSION_DENIED", "INVALID_ARGUMENT", "NOT_FOUND", "ALREADY_EXISTS"];

    return nonRetryableErrors.some((errorType) => error.message.includes(errorType));
  }
}
