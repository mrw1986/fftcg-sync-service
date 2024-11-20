import {logInfo} from "./logger";

/**
 * Tracks progress of long-running operations
 */
export class ProgressTracker {
  private startTime: number;
  private current: number;

  /**
   * Creates a new progress tracker
   * @param {number} total - Total number of items to process
   * @param {string} description - Description of the operation
   */
  constructor(
    private total: number,
    private description: string,
  ) {
    this.startTime = Date.now();
    this.current = 0;
  }

  /**
   * Updates progress and logs current status
   * @param {number} amount - Number of items processed in this update
   * @return {void}
   */
  update(amount = 1): void {
    this.current += amount;
    const elapsed = (Date.now() - this.startTime) / 1000;
    const percent = (this.current / this.total) * 100;
    const remaining = this.total - this.current;

    logInfo(
      `${this.description}: ${this.current}/${this.total} ` +
      `(${percent.toFixed(1)}%) - ${remaining} remaining - ` +
      `Elapsed time: ${elapsed.toFixed(1)}s`,
    );
  }

  /**
   * Gets current progress status
   * @return {Object} Progress information
   */
  getProgress(): { current: number; total: number; elapsed: number } {
    return {
      current: this.current,
      total: this.total,
      elapsed: (Date.now() - this.startTime) / 1000,
    };
  }
}
