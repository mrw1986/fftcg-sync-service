// src/index.ts
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { Request, Response } from "express";
import { cardSync } from "./services/cardSync";
import { priceSync } from "./services/priceSync";
import { retention } from "./utils/retention";
import { runtimeOpts } from "./config/firebase";

// Scheduled card sync
export const scheduledCardSync = onSchedule({
  schedule: "0 21 * * *", // Daily at 21:00 UTC
  timeZone: "UTC",
  region: "us-central1",
  memory: runtimeOpts.memory,
  minInstances: 0,
  maxInstances: 10,
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  retryCount: 3,
}, async () => { // Removed _context parameter since it's unused
  await cardSync.syncCards();
});

// Manual card sync endpoint for testing
export const testCardSync = onRequest({
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  memory: runtimeOpts.memory,
  maxInstances: 1,
}, async (req: Request, res: Response) => {
  const options = {
    dryRun: true, // Always true for test endpoint
    limit: req.query.limit ? parseInt(req.query.limit as string) : 5, // Default to 5
    groupId: req.query.groupId as string,
  };

  const result = await cardSync.syncCards(options);
  res.json(result);
});

export const manualCardSync = onRequest({
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  memory: runtimeOpts.memory,
  maxInstances: 1,
}, async (_req: Request, res: Response) => {
  const result = await cardSync.syncCards({ dryRun: false }); // Full sync
  res.json(result);
});

// Scheduled price sync
export const scheduledPriceSync = onSchedule({
  schedule: "30 21 * * *", // Daily at 21:30 UTC
  timeZone: "UTC",
  region: "us-central1",
  memory: runtimeOpts.memory,
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  retryCount: 3,
}, async () => { // Removed _context parameter since it's unused
  await priceSync.syncPrices();
});

// Manual price sync endpoint for testing
export const testPriceSync = onRequest({
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  memory: runtimeOpts.memory,
  maxInstances: 1,
}, async (req: Request, res: Response) => {
  const options = {
    dryRun: req.query.dryRun === "true",
    limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
    groupId: req.query.groupId as string,
    productId: req.query.productId ? parseInt(req.query.productId as string) : undefined,
    showAll: req.query.showAll === "true",
  };

  const result = await priceSync.syncPrices(options);
  res.json(result);
});

// For manually triggering full price sync
export const manualPriceSync = onRequest({
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  memory: runtimeOpts.memory,
  maxInstances: 1,
}, async (_req: Request, res: Response) => {
  const result = await priceSync.syncPrices();
  res.json(result);
});

// Health check endpoint
export const healthCheck = onRequest({
  timeoutSeconds: 10,
  memory: "128MiB",
  region: "us-central1",
}, async (_req: Request, res: Response) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// Scheduled cleanup
export const scheduledCleanup = onSchedule({
  schedule: "0 22 * * *", // Daily at 22:00 UTC
  timeZone: "UTC",
  region: "us-central1",
  memory: runtimeOpts.memory,
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  retryCount: 3,
}, async () => {
  await retention.cleanOldData();
});

// Manual cleanup endpoint
export const manualCleanup = onRequest({
  timeoutSeconds: runtimeOpts.timeoutSeconds,
  memory: runtimeOpts.memory,
  maxInstances: 1,
}, async (_req: Request, res: Response) => {
  await retention.cleanOldData();
  res.json({ success: true });
});
