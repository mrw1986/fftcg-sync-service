// src/utils/logger.ts
import { db } from "../config/firebase";
import { SyncResult, SyncTiming } from "../types";
import { environment } from "../config/environment";

export type LogData = Record<string, unknown>;

export interface SyncStats {
  startTime: Date;
  endTime?: Date;
  totalItems: number;
  successCount: number;
  errorCount: number;
  duration?: number;
}

export interface SyncSummary {
  tcgSync?: {
    success: boolean;
    processed: number;
    updated: number;
    errors: number;
    duration: string;
  };
  seSync?: {
    success: boolean;
    processed: number;
    updated: number;
    errors: number;
    duration: string;
  };
  seUpdate?: {
    success: boolean;
    totalCards: number;
    matchesFound: number;
    cardsUpdated: number;
    durationSeconds: number;
  };
  searchIndex?: {
    totalProcessed: number;
    totalUpdated: number;
    success: boolean;
  };
  startTime: Date;
  endTime: Date;
  duration: number;
  environment: string;
}

// Extends Partial<SyncResult> to match the shape of sync results
interface SyncStepData extends Partial<SyncResult> {
  timing?: SyncTiming;
  totalCards?: number;
  matchesFound?: number;
  cardsUpdated?: number;
  durationSeconds?: number;
  totalProcessed?: number;
  totalUpdated?: number;
}

interface ErrorData {
  error: string | Error;
}

export class Logger {
  private readonly COLLECTION = "sync_summaries";
  private firestoreEnabled = true;
  private currentSyncId: string | null = null;
  private syncStartTime: Date | null = null;
  private summary: Partial<SyncSummary> = {};

  async disableFirestore(): Promise<void> {
    if (this.currentSyncId) {
      await this.saveSyncSummary();
    }
    this.firestoreEnabled = false;
  }

  private generateSyncId(): string {
    const now = new Date();
    return `sync_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(
      2,
      "0"
    )}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(
      now.getSeconds()
    ).padStart(2, "0")}`;
  }

  private async saveSyncSummary(): Promise<void> {
    if (!this.currentSyncId || !this.firestoreEnabled || !environment.enableFirestoreLogs) return;

    const endTime = new Date();
    const duration = (endTime.getTime() - (this.syncStartTime?.getTime() || endTime.getTime())) / 1000;

    const finalSummary: SyncSummary = {
      ...this.summary,
      startTime: this.syncStartTime || endTime,
      endTime,
      duration,
      environment: environment.nodeEnv,
    } as SyncSummary;

    try {
      await db.collection(this.COLLECTION).doc(this.currentSyncId).set(finalSummary, { merge: true });
    } catch (error) {
      console.error("Failed to save sync summary:", error instanceof Error ? error.message : String(error));
    }
  }

  async startSync(): Promise<void> {
    this.currentSyncId = this.generateSyncId();
    this.syncStartTime = new Date();
    this.summary = {};
    console.log(`Starting sync with ID: ${this.currentSyncId}`);
  }

  async info(message: string, data?: LogData | SyncStepData): Promise<void> {
    // Only log to console
    console.log(`[INFO] ${message}`, data || "");

    // Update summary if this is a sync step completion
    if (this.currentSyncId && message.includes("completed:")) {
      if (message.includes("TCGCSV sync")) {
        this.summary.tcgSync = {
          success: Boolean(data?.success),
          processed: (data as SyncStepData)?.itemsProcessed || 0,
          updated: (data as SyncStepData)?.itemsUpdated || 0,
          errors: (data as SyncStepData)?.errors?.length || 0,
          duration: `${(data as SyncStepData)?.timing?.duration || 0}s`,
        };
      } else if (message.includes("Square Enix sync")) {
        this.summary.seSync = {
          success: Boolean(data?.success),
          processed: (data as SyncStepData)?.itemsProcessed || 0,
          updated: (data as SyncStepData)?.itemsUpdated || 0,
          errors: (data as SyncStepData)?.errors?.length || 0,
          duration: `${(data as SyncStepData)?.timing?.duration || 0}s`,
        };
      } else if (message.includes("Square Enix data update")) {
        this.summary.seUpdate = {
          success: Boolean(data?.success),
          totalCards: (data as SyncStepData)?.totalCards || 0,
          matchesFound: (data as SyncStepData)?.matchesFound || 0,
          cardsUpdated: (data as SyncStepData)?.cardsUpdated || 0,
          durationSeconds: (data as SyncStepData)?.durationSeconds || 0,
        };
      } else if (message.includes("Search index update")) {
        this.summary.searchIndex = {
          totalProcessed: (data as SyncStepData)?.totalProcessed || 0,
          totalUpdated: (data as SyncStepData)?.totalUpdated || 0,
          success: true,
        };
      }

      // Save summary after each major step
      await this.saveSyncSummary();
    }
  }

  async error(message: string, data?: LogData | ErrorData): Promise<void> {
    // Only log to console
    console.error(`[ERROR] ${message}`, data || "");

    // If this is a sync error, update and save summary
    if (this.currentSyncId && message.includes("Sync process failed:")) {
      await this.saveSyncSummary();
    }
  }

  async warn(message: string, data?: LogData | ErrorData): Promise<void> {
    // Only log to console
    console.warn(`[WARN] ${message}`, data || "");
  }

  async log(
    level: "INFO" | "ERROR" | "WARN",
    message: string,
    metadata?: LogData | SyncStepData | ErrorData
  ): Promise<void> {
    // Only log to console with appropriate level
    const logFn = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
    logFn(`[${level}] ${message}`, metadata || "");
  }
}

export const logger = new Logger();
