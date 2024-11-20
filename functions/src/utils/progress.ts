// src/utils/progress.ts

import {logInfo} from "./logger";

export interface ProgressStats {
  current: number;
  total: number;
  percent: number;
  elapsed: number;
  rate: number;
  remaining: number;
  eta: number;
}

export class EnhancedProgressTracker {
  private startTime: number;
  private current: number;
  private estimates: number[] = [];
  private lastUpdate: number;
  private updateInterval: number;

  constructor(
    private total: number,
    private description: string,
    options: { updateInterval?: number } = {}
  ) {
    this.startTime = Date.now();
    this.current = 0;
    this.lastUpdate = Date.now();
    this.updateInterval = options.updateInterval || 1000; // Default 1 second
  }

  private calculateStats(): ProgressStats {
    const now = Date.now();
    const elapsed = (now - this.startTime) / 1000;
    const percent = (this.current / this.total) * 100;
    const rate = this.current / elapsed;
    const remaining = this.total - this.current;
    const eta = remaining / rate;

    return {
      current: this.current,
      total: this.total,
      percent,
      elapsed,
      rate,
      remaining,
      eta,
    };
  }

  update(amount = 1): void {
    const now = Date.now();
    this.current += amount;

    // Only update log if enough time has passed
    if (now - this.lastUpdate >= this.updateInterval) {
      const stats = this.calculateStats();
      this.estimates.push(stats.eta);

      // Keep only last 10 estimates for averaging
      if (this.estimates.length > 10) {
        this.estimates.shift();
      }

      const avgEta = this.estimates.reduce((a, b) => a + b, 0) / this.estimates.length;

      logInfo(
        `${this.description}: ${stats.current}/${stats.total} ` +
        `(${stats.percent.toFixed(1)}%) - ${stats.remaining} remaining - ` +
        `ETA: ${avgEta.toFixed(1)}s - Rate: ${stats.rate.toFixed(1)}/s`
      );

      this.lastUpdate = now;
    }
  }

  getProgress(): ProgressStats {
    return this.calculateStats();
  }
}
