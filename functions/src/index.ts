// src/index.ts

import {onRequest} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {Request, Response} from "express";
import {syncCards} from "./services/cardSync";
import {syncPrices} from "./services/priceSync";
import {runtimeOpts} from "./config/firebase";
import {SyncOptions} from "./types";
import cors = require("cors");
import * as dotenv from "dotenv";
dotenv.config();

// Initialize CORS middleware with appropriate typing
const corsMiddleware = cors({
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

// Wrap async function with CORS and error handling
const withCorsAndErrors = (
  handler: (req: Request, res: Response) => Promise<void>
) => {
  return async (req: Request, res: Response): Promise<void> => {
    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
      return new Promise((resolve) => {
        corsMiddleware(req, res, () => {
          res.status(204).send("");
          resolve();
        });
      });
    }

    // Handle actual request with CORS
    return new Promise((resolve, reject) => {
      corsMiddleware(req, res, async () => {
        try {
          await handler(req, res);
          resolve();
        } catch (error) {
          console.error("Function error:", error);
          res.status(500).json({
            error:
              error instanceof Error ? error.message : "Internal server error",
            timestamp: new Date().toISOString(),
          });
          reject(error);
        }
      });
    });
  };
};

export const scheduledCardSync = onSchedule(
  {
    schedule: "0 21 * * *", // Daily at 21:00 UTC
    timeZone: "UTC",
    memory: runtimeOpts.memory,
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    retryCount: 3,
  },
  async (_context) => {
    await syncCards();
  }
);

export const testCardSync = onRequest(
  {
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    memory: runtimeOpts.memory,
    maxInstances: 1,
  },
  withCorsAndErrors(async (req: Request, res: Response): Promise<void> => {
    const options: SyncOptions = {
      dryRun: req.query.dryRun !== "false", // default to true
      limit: req.query.limit ? parseInt(req.query.limit as string) : 5,
      groupId: req.query.groupId as string,
    };

    const result = await syncCards(options);
    res.json(result);
  })
);

export const manualCardSync = onRequest(
  {
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    memory: runtimeOpts.memory,
    maxInstances: 1,
  },
  withCorsAndErrors(async (_req: Request, res: Response): Promise<void> => {
    const result = await syncCards({dryRun: false});
    res.json(result);
  })
);

export const scheduledPriceSync = onSchedule(
  {
    schedule: "30 21 * * *", // Daily at 21:30 UTC
    timeZone: "UTC",
    memory: runtimeOpts.memory,
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    retryCount: 3,
  },
  async (_context) => {
    await syncPrices();
  }
);

export const testPriceSync = onRequest(
  {
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    memory: runtimeOpts.memory,
    maxInstances: 1,
  },
  withCorsAndErrors(async (req: Request, res: Response): Promise<void> => {
    const options: SyncOptions = {
      dryRun: req.query.dryRun === "true",
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      groupId: req.query.groupId as string,
      productId: req.query.productId ?
        parseInt(req.query.productId as string) :
        undefined,
      showAll: req.query.showAll === "true",
    };

    const result = await syncPrices(options);
    res.json(result);
  })
);

export const manualPriceSync = onRequest(
  {
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    memory: runtimeOpts.memory,
    maxInstances: 1,
  },
  withCorsAndErrors(async (_req: Request, res: Response): Promise<void> => {
    const result = await syncPrices();
    res.json(result);
  })
);

export const healthCheck = onRequest(
  {
    timeoutSeconds: 10,
    memory: "128MiB",
  },
  withCorsAndErrors(async (_req: Request, res: Response): Promise<void> => {
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
    });
  })
);
