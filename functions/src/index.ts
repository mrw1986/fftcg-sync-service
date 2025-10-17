// src/index.ts
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { Request, Response } from "express";
import { cardSync } from "./services/cardSync";
import { priceSync } from "./services/priceSync";
import { groupSync } from "./services/groupSync";
import { retention } from "./utils/retention";
import { runtimeOpts } from "./config/firebase";
import { logger } from "./utils/logger";
import { tcgcsvApi } from "./utils/api";
import { CardProduct } from "types";
import { squareEnixStorage } from "./services/squareEnixStorageService";
import { main as updateCardsWithSquareEnixData } from "./scripts/updateCardsWithSquareEnixData";

// Complete scheduled sync with Square Enix update
export const scheduledCardSync = onSchedule(
  {
    schedule: "0 21 * * *", // Daily at 21:00 UTC
    timeZone: "UTC",
    region: "us-central1",
    memory: "2GiB",
    timeoutSeconds: 540,
    retryCount: 3,
    maxInstances: 1,
  },
  async (): Promise<void> => {
    try {
      console.log("Function triggered"); // Added console.log
      logger.info("Starting complete scheduled sync (groups + cards + Square Enix update)");

      // Step 1: First sync groups to ensure new groups are available
      logger.info("Step 1: Starting group sync");
      const groupResult = await groupSync.syncGroups();
      logger.info("Step 1: Group sync completed", groupResult);

      // Step 2: Then sync cards from TCGPlayer API
      logger.info("Step 2: Starting TCGPlayer card sync");
      const cardResult = await cardSync.syncCards();
      logger.info("Step 2: TCGPlayer card sync completed", cardResult);

      // Step 3: Sync Square Enix data to storage
      logger.info("Step 3: Starting Square Enix data sync");
      const seResult = await squareEnixStorage.syncSquareEnixCards();
      logger.info("Step 3: Square Enix data sync completed", seResult);

      // Step 4: Update TCG cards with Square Enix data (including complete descriptions)
      logger.info("Step 4: Starting Square Enix data update to cards");
      const updateResult = await updateCardsWithSquareEnixData();
      logger.info("Step 4: Square Enix data update completed", updateResult);

      logger.info("Complete scheduled sync finished successfully", {
        groups: groupResult,
        tcgCards: cardResult,
        squareEnixSync: seResult,
        squareEnixUpdate: updateResult,
      });
    } catch (error) {
      console.error("Function error:", error); // Added console.error
      logger.error("Complete scheduled sync failed", { error });
      throw error;
    }
  }
);

export const testApi = onRequest(
  {
    timeoutSeconds: 30,
    memory: "128MiB",
    region: "us-central1",
  },
  async (_req: Request, res: Response) => {
    try {
      console.log("Testing API connectivity...");

      // Test groups endpoint
      console.log("Testing groups endpoint...");
      const groups = await tcgcsvApi.getGroups();

      // Test products endpoint with first group
      console.log("Testing products endpoint...");
      let products: CardProduct[] = [];
      if (groups.length > 0) {
        products = await tcgcsvApi.getGroupProducts(groups[0].groupId);
      }

      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        results: {
          groups: {
            count: groups.length,
            firstGroup: groups[0],
          },
          products: {
            count: products.length,
            firstProduct: products[0],
          },
        },
      });
    } catch (error) {
      console.error("API test failed:", error);
      res.status(500).json({
        success: false,
        timestamp: new Date().toISOString(),
        error:
          error instanceof Error ?
            {
              message: error.message,
              stack: error.stack,
              name: error.name,
            } :
            String(error),
      });
    }
  }
);

// Add the new HTTP endpoint for testing
export const testScheduledCardSync = onRequest(
  {
    timeoutSeconds: 540,
    memory: "2GiB",
    region: "us-central1",
  },
  async (req: Request, res: Response) => {
    try {
      console.log("Test endpoint triggered", { query: req.query });

      // Parse optional parameters from query string
      const options = {
        dryRun: req.query.dryRun === "true",
        groupId: req.query.groupId as string,
        forceUpdate: req.query.forceUpdate === "true",
      };

      logger.info("Starting manual sync test (groups + cards)", { options });

      // Test API connectivity first
      try {
        const groups = await tcgcsvApi.getGroups();
        console.log("API Groups response:", {
          groupCount: groups.length,
          firstGroup: groups[0],
        });

        if (groups.length > 0 && !options.groupId) {
          // Test getting products for the first group
          const firstGroupProducts = await tcgcsvApi.getGroupProducts(groups[0].groupId);
          console.log("First group products:", {
            groupId: groups[0].groupId,
            productCount: firstGroupProducts.length,
            firstProduct: firstGroupProducts[0],
          });
        }
      } catch (apiError) {
        console.error("API Test Failed:", apiError);
        throw new Error(
          `API Connectivity Test Failed: ${apiError instanceof Error ? apiError.message : String(apiError)}`
        );
      }

      // First sync groups
      logger.info("Starting group sync");
      const groupResult = await groupSync.syncGroups({ forceUpdate: options.forceUpdate });
      logger.info("Group sync completed", groupResult);

      // Then sync cards
      logger.info("Starting card sync");
      const cardResult = await cardSync.syncCards(options);
      logger.info("Card sync completed", cardResult);

      const result = { groups: groupResult, cards: cardResult };

      // Send detailed response
      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        options,
        result,
        debug: {
          environment: process.env.NODE_ENV,
          functionRegion: "us-central1",
          memoryLimit: "2GiB",
          timeoutSeconds: 540,
        },
      });
    } catch (error) {
      console.error("Test endpoint error:", error);
      logger.error("Manual card sync failed", { error });

      res.status(500).json({
        success: false,
        timestamp: new Date().toISOString(),
        error:
          error instanceof Error ?
            {
              message: error.message,
              stack: error.stack,
              name: error.name,
            } :
            String(error),
        options: req.query,
        debug: {
          environment: process.env.NODE_ENV,
          functionRegion: "us-central1",
        },
      });
    }
  }
);

// Manual card sync endpoint for testing
export const testCardSync = onRequest(
  {
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    memory: runtimeOpts.memory,
    maxInstances: 1,
  },
  async (req: Request, res: Response) => {
    const options = {
      dryRun: true, // Always true for test endpoint
      limit: req.query.limit ? parseInt(req.query.limit as string) : 5, // Default to 5
      groupId: req.query.groupId as string,
    };

    const result = await cardSync.syncCards(options);
    res.json(result);
  }
);

export const manualCardSync = onRequest(
  {
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    memory: runtimeOpts.memory,
    maxInstances: 1,
  },
  async (_req: Request, res: Response) => {
    try {
      // First sync groups
      const groupResult = await groupSync.syncGroups();
      // Then sync cards
      const cardResult = await cardSync.syncCards({ dryRun: false }); // Full sync

      const result = { groups: groupResult, cards: cardResult };
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

// Scheduled price sync
export const scheduledPriceSync = onSchedule(
  {
    schedule: "30 21 * * *", // Daily at 21:30 UTC
    timeZone: "UTC",
    region: "us-central1",
    memory: runtimeOpts.memory,
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    retryCount: 3,
  },
  async () => {
    // Removed _context parameter since it's unused
    await priceSync.syncPrices();
  }
);

// Manual price sync endpoint for testing
export const testPriceSync = onRequest(
  {
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    memory: runtimeOpts.memory,
    maxInstances: 1,
  },
  async (req: Request, res: Response) => {
    const options = {
      dryRun: req.query.dryRun === "true",
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      groupId: req.query.groupId as string,
      productId: req.query.productId ? parseInt(req.query.productId as string) : undefined,
      showAll: req.query.showAll === "true",
    };

    const result = await priceSync.syncPrices(options);
    res.json(result);
  }
);

// For manually triggering full price sync
export const manualPriceSync = onRequest(
  {
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    memory: runtimeOpts.memory,
    maxInstances: 1,
  },
  async (_req: Request, res: Response) => {
    const result = await priceSync.syncPrices();
    res.json(result);
  }
);

// Health check endpoint
export const healthCheck = onRequest(
  {
    timeoutSeconds: 10,
    memory: "128MiB",
    region: "us-central1",
  },
  async (_req: Request, res: Response) => {
    res.status(200).json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
    });
  }
);

// Scheduled cleanup
export const scheduledCleanup = onSchedule(
  {
    schedule: "0 22 * * *", // Daily at 22:00 UTC
    timeZone: "UTC",
    region: "us-central1",
    memory: runtimeOpts.memory,
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    retryCount: 3,
  },
  async () => {
    await retention.cleanOldData();
  }
);

// Manual cleanup endpoint
export const manualCleanup = onRequest(
  {
    timeoutSeconds: runtimeOpts.timeoutSeconds,
    memory: runtimeOpts.memory,
    maxInstances: 1,
  },
  async (_req: Request, res: Response) => {
    await retention.cleanOldData();
    res.json({ success: true });
  }
);
