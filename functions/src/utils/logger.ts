// src/utils/logger.ts
import { db } from "../config/firebase";
import { environment } from "../config/environment";
import { SyncResult } from "../types";

export type LogData = Record<string, unknown>;

export interface SyncStats {
  startTime: Date;
  endTime?: Date;
  totalItems: number;
  successCount: number;
  errorCount: number;
  duration?: number;
}

export class Logger {
  private readonly COLLECTION = "logs";

  async info(message: string, data?: LogData | SyncResult): Promise<void> {
    await this.log("INFO", message, data);
  }

  async error(message: string, data?: LogData | { error: unknown }): Promise<void> {
    await this.log("ERROR", message, data);
  }

  async logSyncStats(stats: SyncStats): Promise<void> {
    const duration = stats.endTime ? (stats.endTime.getTime() - stats.startTime.getTime()) / 1000 : undefined;

    const successRate = ((stats.successCount / stats.totalItems) * 100).toFixed(1);

    console.log({
      duration: duration ? `${duration}s` : "unknown",
      successRate: `${successRate}%`,
      totalItems: stats.totalItems,
      successful: stats.successCount,
      errors: stats.errorCount,
    });

    if (!environment.isLocal) {
      await db.collection(this.COLLECTION).add({
        type: "SYNC_STATS",
        timestamp: new Date(),
        stats: {
          ...stats,
          duration,
          successRate: parseFloat(successRate),
        },
      });
    }
  }

  async warn(message: string, data?: LogData | { error: unknown }): Promise<void> {
    await this.log("WARN", message, data);
  }

  async log(
    level: "INFO" | "ERROR" | "WARN",
    message: string,
    metadata?: LogData | SyncResult | { error: unknown }
  ): Promise<void> {
    const entry = {
      timestamp: new Date(),
      level,
      message,
      metadata: metadata || null,
      environment: environment.nodeEnv,
    };

    // Always log to console with appropriate level
    const logFn = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
    logFn(`[${level}] ${message}`, metadata || "");

    // Only log to Firestore if not in local development
    if (!environment.isLocal) {
      try {
        await db.collection(this.COLLECTION).add(entry);
      } catch (error) {
        console.error("Failed to write log to Firestore:", error);
        // Don't throw the error to prevent disrupting the application
      }
    }
  }
}

export const logger = new Logger();
