// src/index.ts
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { cardSync } from "./services/cardSync";
import { priceSync } from "./services/priceSync";
import { retention } from "./utils/retention";
import { logger } from "./utils/logger";
import { db, runtimeOpts } from "./config/firebase";

// HTTP Functions
export const manualCardSync = onRequest(runtimeOpts, async (req, res) => {
  try {
    const forceUpdate = req.query.force === "true";
    const groupId = req.query.groupId as string | undefined;
    const result = await cardSync.syncCards({ forceUpdate, groupId });
    res.json(result);
  } catch (error) {
    logger.error("Manual card sync failed", { error });
    res.status(500).json({
      error: "Sync failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export const manualPriceSync = onRequest(runtimeOpts, async (req, res) => {
  try {
    const forceUpdate = req.query.force === "true";
    const groupId = req.query.groupId as string | undefined;
    const result = await priceSync.syncPrices({
      forceUpdate,
      ...(groupId && { groupId }),
    });
    res.json(result);
  } catch (error) {
    logger.error("Manual price sync failed", { error });
    res.status(500).json({
      error: "Sync failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export const manualCleanup = onRequest(runtimeOpts, async (_req, res) => {
  try {
    await retention.cleanOldData();
    res.json({ success: true });
  } catch (error) {
    logger.error("Manual cleanup failed", { error });
    res.status(500).json({
      error: "Cleanup failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export const healthCheck = onRequest(runtimeOpts, async (_req, res) => {
  try {
    await db.collection("cards").limit(1).get();
    res.json({
      status: "healthy",
      timestamp: new Date(),
      environment: process.env.NODE_ENV,
    });
  } catch (error) {
    logger.error("Health check failed", { error });
    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date(),
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Scheduled Functions
export const scheduledCardSync = onSchedule(
  {
    schedule: "0 21 * * *", // Daily at 21:00 UTC
    timeZone: "UTC",
    ...runtimeOpts,
  },
  async () => {
    try {
      logger.info("Starting scheduled card sync");
      const result = await cardSync.syncCards();
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
    ...runtimeOpts,
  },
  async () => {
    try {
      logger.info("Starting scheduled price sync");
      const result = await priceSync.syncPrices({}); // Pass empty options object
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
    ...runtimeOpts,
  },
  async () => {
    try {
      logger.info("Starting scheduled cleanup");
      await retention.cleanOldData();
      logger.info("Cleanup completed");
    } catch (error) {
      logger.error("Scheduled cleanup failed", { error });
      throw error;
    }
  }
);
