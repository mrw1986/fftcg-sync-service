// src/utils/retry.ts
import { logger } from "./logger";

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
}

interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

export class RetryWithBackoff {
  private readonly config: RetryConfig;
  private readonly circuitBreaker: CircuitBreakerConfig;
  private readonly retryableStatusCodes = new Set([408, 429, 500, 502, 503, 504]);

  private circuitState = {
    failures: 0,
    lastFailure: 0,
    isOpen: false,
  };

  private statistics = {
    totalAttempts: 0,
    totalRetries: 0,
    totalFailures: 0,
    totalSuccesses: 0,
    circuitBreaksCount: 0,
  };

  constructor(retryConfig?: Partial<RetryConfig>, circuitBreakerConfig?: Partial<CircuitBreakerConfig>) {
    this.config = {
      maxRetries: retryConfig?.maxRetries ?? 3,
      initialDelay: retryConfig?.initialDelay ?? 1000,
      maxDelay: retryConfig?.maxDelay ?? 10000,
      backoffFactor: retryConfig?.backoffFactor ?? 2,
    };

    this.circuitBreaker = {
      failureThreshold: circuitBreakerConfig?.failureThreshold ?? 5,
      resetTimeout: circuitBreakerConfig?.resetTimeout ?? 60000,
    };

    // Start periodic statistics logging
    setInterval(() => this.logStatistics(), 5 * 60 * 1000); // Every 5 minutes
  }

  private checkCircuitBreaker(): boolean {
    if (!this.circuitState.isOpen) {
      return true;
    }

    const timeSinceLastFailure = Date.now() - this.circuitState.lastFailure;
    if (timeSinceLastFailure >= this.circuitBreaker.resetTimeout) {
      this.circuitState.isOpen = false;
      this.circuitState.failures = 0;
      return true;
    }

    return false;
  }

  private updateCircuitBreaker(failed: boolean): void {
    if (failed) {
      this.circuitState.failures++;
      this.circuitState.lastFailure = Date.now();

      if (this.circuitState.failures >= this.circuitBreaker.failureThreshold) {
        this.circuitState.isOpen = true;
        this.statistics.circuitBreaksCount++;
        logger.warn("Circuit breaker opened", {
          failures: this.circuitState.failures,
          resetTimeout: this.circuitBreaker.resetTimeout,
        });
      }
    } else {
      this.circuitState.failures = 0;
    }
  }

  private isRetryableError(error: Error): boolean {
    // Check if it's an HTTP error with status code
    const statusCode = (error as any).response?.status;
    if (statusCode && this.retryableStatusCodes.has(statusCode)) {
      return true;
    }

    // Check for network-related errors
    const errorMessage = error.message.toLowerCase();
    return (
      errorMessage.includes("timeout") ||
      errorMessage.includes("network") ||
      errorMessage.includes("connection") ||
      errorMessage.includes("econnrefused") ||
      errorMessage.includes("econnreset")
    );
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.checkCircuitBreaker()) {
      throw new Error("Circuit breaker is open");
    }

    let lastError: Error | null = null;
    let delay = this.config.initialDelay;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      this.statistics.totalAttempts++;

      try {
        const result = await operation();
        this.updateCircuitBreaker(false);
        this.statistics.totalSuccesses++;
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.statistics.totalFailures++;

        if (attempt === this.config.maxRetries) {
          this.updateCircuitBreaker(true);
          break;
        }

        if (!this.isRetryableError(lastError)) {
          throw lastError;
        }

        this.statistics.totalRetries++;
        logger.info(`Retry attempt ${attempt + 1} of ${this.config.maxRetries}`, {
          error: lastError.message,
          delay,
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * this.config.backoffFactor, this.config.maxDelay);
      }
    }

    throw lastError || new Error("Operation failed after retries");
  }

  private logStatistics(): void {
    const totalOperations = this.statistics.totalSuccesses + this.statistics.totalFailures;
    const successRate = totalOperations > 0 ? (this.statistics.totalSuccesses / totalOperations) * 100 : 0;

    logger.info("Retry statistics", {
      totalAttempts: this.statistics.totalAttempts,
      totalRetries: this.statistics.totalRetries,
      totalSuccesses: this.statistics.totalSuccesses,
      totalFailures: this.statistics.totalFailures,
      circuitBreaks: this.statistics.circuitBreaksCount,
      successRate: `${successRate.toFixed(2)}%`,
      circuitBreakerStatus: this.circuitState.isOpen ? "OPEN" : "CLOSED",
      currentFailures: this.circuitState.failures,
    });
  }

  getStatistics() {
    return { ...this.statistics };
  }

  resetStatistics(): void {
    this.statistics = {
      totalAttempts: 0,
      totalRetries: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      circuitBreaksCount: 0,
    };
  }
}
