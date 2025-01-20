// src/index.ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { cardSync } from "./services/cardSync";
import { priceSync } from "./services/priceSync";
import { retention } from "./utils/retention";
import { runtimeOpts } from "./config/firebase";
import * as dotenv from "dotenv";

dotenv.config();

// Manual card sync endpoint as a callable function
export const manualCardSync = onCall(
  {
    memory: runtimeOpts.memory,
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    region: "us-central1",
  },
  async (request) => {
    try {
      const forceUpdate = request.data.force === true;
      const groupId = request.data.groupId as string | undefined;

      const result = await cardSync.syncCards({
        forceUpdate,
        groupId,
        skipImages: false,
        imagesOnly: false,
        silent: false,
        dryRun: false,
      });

      return result;
    } catch (error) {
      logger.error("Manual card sync failed", { error });
      throw new HttpsError(
        "internal",
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }
);

// Manual price sync endpoint as a callable function
export const manualPriceSync = onCall(
  {
    memory: runtimeOpts.memory,
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    region: "us-central1",
  },
  async (request) => {
    try {
      const forceUpdate = request.data.force === true;
      const groupId = request.data.groupId as string | undefined;

      const result = await priceSync.syncPrices({
        forceUpdate,
        groupId,
        silent: false,
        dryRun: false,
      });

      return result;
    } catch (error) {
      logger.error("Manual price sync failed", { error });
      throw new HttpsError(
        "internal",
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }
);

// Manual cleanup endpoint as a callable function
export const manualCleanup = onCall(
  {
    memory: runtimeOpts.memory,
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    region: "us-central1",
  },
  async () => {
    try {
      await retention.cleanOldData();
      return { success: true };
    } catch (error) {
      logger.error("Manual cleanup failed", { error });
      throw new HttpsError(
        "internal",
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  }
);

// Scheduled Functions
export const scheduledCardSync = onSchedule(
  {
    schedule: "0 21 * * *", // Daily at 21:00 UTC
    timeZone: "UTC",
    memory: runtimeOpts.memory,
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    retryCount: 3,
    region: "us-central1",
    maxInstances: 1,
  },
  async (event) => {
    try {
      logger.info("Starting scheduled card sync", {
        scheduledTime: event.scheduleTime,
      });
      const result = await cardSync.syncCards({
        forceUpdate: false,
        skipImages: false,
        imagesOnly: false,
        silent: false,
        dryRun: false,
      });
      logger.info("Card sync completed", result);
    } catch (error) {
      logger.error("Scheduled card sync failed", { error });
      throw error;
    }
  }
);

export const scheduledPriceSync = onSchedule(
  {
    schedule: "30 21 * * *", // Daily at 21:30 UTC
    timeZone: "UTC",
    memory: runtimeOpts.memory,
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    retryCount: 3,
    region: "us-central1",
    maxInstances: 1,
  },
  async (event) => {
    try {
      logger.info("Starting scheduled price sync", {
        scheduledTime: event.scheduleTime,
      });
      const result = await priceSync.syncPrices({
        forceUpdate: false,
        silent: false,
        dryRun: false,
      });
      logger.info("Price sync completed", result);
    } catch (error) {
      logger.error("Scheduled price sync failed", { error });
      throw error;
    }
  }
);

export const scheduledCleanup = onSchedule(
  {
    schedule: "0 22 * * *", // Daily at 22:00 UTC
    timeZone: "UTC",
    memory: runtimeOpts.memory,
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    retryCount: 3,
    region: "us-central1",
    maxInstances: 1,
  },
  async (event) => {
    try {
      logger.info("Starting scheduled cleanup", {
        scheduledTime: event.scheduleTime,
      });
      await retention.cleanOldData();
      logger.info("Cleanup completed");
    } catch (error) {
      logger.error("Scheduled cleanup failed", { error });
      throw error;
    }
  }
);
