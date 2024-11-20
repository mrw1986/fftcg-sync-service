import {onRequest} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {Request, Response} from "express";
import {syncCards} from "./services/cardSync";
import {syncPrices} from "./services/priceSync";
import {runtimeOpts} from "./config/firebase";
import {SyncOptions} from "./types";

// Scheduled card sync
export const scheduledCardSync = onSchedule({
  schedule: "0 21 * * *",
  timeZone: "UTC",
  memory: runtimeOpts.memory,
}, async (_event) => { // Added underscore prefix
  await syncCards();
});

// Manual card sync endpoint
export const testCardSync = onRequest(
  {
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    memory: runtimeOpts.memory,
  },
  async (req: Request, res: Response) => {
    const options: SyncOptions = {
      dryRun: req.query.dryRun === "true",
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      groupId: req.query.groupId as string,
    };

    const result = await syncCards(options);
    res.json(result);
  }
);

// Scheduled price sync
export const scheduledPriceSync = onSchedule({
  schedule: "30 21 * * *",
  timeZone: "UTC",
  memory: runtimeOpts.memory,
}, async (_event) => { // Added underscore prefix
  await syncPrices();
});

// Manual price sync endpoint
export const testPriceSync = onRequest(
  {
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    memory: runtimeOpts.memory,
  },
  async (req: Request, res: Response) => {
    const options: SyncOptions = {
      dryRun: req.query.dryRun === "true",
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      groupId: req.query.groupId as string,
      productId: req.query.productId ? parseInt(req.query.productId as string) : undefined,
      showAll: req.query.showAll === "true",
    };

    const result = await syncPrices(options);
    res.json(result);
  }
);
