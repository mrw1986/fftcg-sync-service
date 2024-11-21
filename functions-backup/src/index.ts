// src/index.ts

import {onRequest} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {Request, Response} from "express";
import {syncCards} from "./services/cardSync";
import {syncPrices} from "./services/priceSync";
import {runtimeOpts} from "./config/firebase";
import {SyncOptions} from "./types";

// Scheduled card sync
export const scheduledCardSync = onSchedule({
  schedule: "0 21 * * *", // Daily at 21:00 UTC
  timeZone: "UTC",
  memory: runtimeOpts.memory,
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  retryCount: 3,
}, async (_context) => {
  await syncCards();
});

// Manual card sync endpoint for testing
export const testCardSync = onRequest({
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  memory: runtimeOpts.memory,
  maxInstances: 1,
}, async (req: Request, res: Response) => {
  const options: SyncOptions = {
    dryRun: true, // Always true for test endpoint
    limit: req.query.limit ? parseInt(req.query.limit as string) : 5, // Default to 5
    groupId: req.query.groupId as string,
  };

  const result = await syncCards(options);
  res.json(result);
});

export const manualCardSync = onRequest({
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  memory: runtimeOpts.memory,
  maxInstances: 1,
}, async (_req: Request, res: Response) => {
  const result = await syncCards({dryRun: false}); // Full sync
  res.json(result);
});

// Scheduled price sync
export const scheduledPriceSync = onSchedule({
  schedule: "30 21 * * *", // Daily at 21:30 UTC
  timeZone: "UTC",
  memory: runtimeOpts.memory,
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  retryCount: 3,
}, async (_context) => {
  await syncPrices();
});

// Manual price sync endpoint for testing
export const testPriceSync = onRequest({
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  memory: runtimeOpts.memory,
  maxInstances: 1,
}, async (req: Request, res: Response) => {
  const options: SyncOptions = {
    dryRun: req.query.dryRun === "true",
    limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
    groupId: req.query.groupId as string,
    productId: req.query.productId ? parseInt(req.query.productId as string) : undefined,
    showAll: req.query.showAll === "true",
  };

  const result = await syncPrices(options);
  res.json(result);
});

// For manually triggering full price sync
export const manualPriceSync = onRequest({
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  memory: runtimeOpts.memory,
  maxInstances: 1,
}, async (_req: Request, res: Response) => {
  const result = await syncPrices();
  res.json(result);
});

// Health check endpoint
export const healthCheck = onRequest({
  timeoutSeconds: 10,
  memory: "128MiB",
}, async (_req: Request, res: Response) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});
