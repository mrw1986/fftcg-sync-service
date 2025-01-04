// src/scripts/prodSync.ts
import { cardSync } from "../services/cardSync";
import { priceSync } from "../services/priceSync";
import { logger, LogData } from "../utils/logger";


interface SyncStats {
  success: boolean;
  itemsProcessed: number;
  itemsUpdated: number;
  errors: string[];
  duration: number;
}

interface SyncOptions {
  forceUpdate?: boolean;
  groupId?: string;
  cardsOnly?: boolean;
  pricesOnly?: boolean;
}

// Move runProductionSync into a class for better organization
class ProductionSync {
  async run(options: SyncOptions = {}) {
    const startTime = Date.now();
    const results: {
      cards?: SyncStats;
      prices?: SyncStats;
    } = {};

    try {
      logger.info("Starting production sync", { options } as LogData);

      // Run card sync if not prices-only
      if (!options.pricesOnly) {
        logger.info("Starting card sync...");
        const cardResult = await cardSync.syncCards({
          forceUpdate: options.forceUpdate,
          groupId: options.groupId,
        });

        results.cards = {
          success: cardResult.success,
          itemsProcessed: cardResult.itemsProcessed,
          itemsUpdated: cardResult.itemsUpdated,
          errors: cardResult.errors,
          duration: cardResult.timing.duration || 0,
        };

        logger.info("Card sync completed", { stats: results.cards } as LogData);
      }

      // Run price sync if not cards-only
      if (!options.cardsOnly) {
        logger.info("Starting price sync...");
        const priceResult = await priceSync.syncPrices({
          forceUpdate: options.forceUpdate,
          groupId: options.groupId,
        });

        results.prices = {
          success: priceResult.success,
          itemsProcessed: priceResult.itemsProcessed,
          itemsUpdated: priceResult.itemsUpdated,
          errors: priceResult.errors,
          duration: priceResult.timing.duration || 0,
        };

        logger.info("Price sync completed", { stats: results.prices } as LogData);
      }

      const totalDuration = (Date.now() - startTime) / 1000;
      logger.info(`Full sync completed in ${totalDuration}s`, { results } as LogData);

      return results;
    } catch (error) {
      logger.error("Production sync failed", { error } as LogData);
      throw error;
    }
  }
}

function parseArgs(args: string[]): SyncOptions {
  const options: SyncOptions = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
    case "--force":
      options.forceUpdate = true;
      break;
    case "--group":
      options.groupId = args[++i];
      break;
    case "--cards-only":
      options.cardsOnly = true;
      break;
    case "--prices-only":
      options.pricesOnly = true;
      break;
    case "--help":
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Usage: npx ts-node src/scripts/prodSync.ts [options]

Options:
  --force         Force update all items regardless of changes
  --group <id>    Sync specific group ID only
  --cards-only    Only sync card data
  --prices-only   Only sync price data
  --help          Show this help message
  
Examples:
  npx ts-node src/scripts/prodSync.ts
  npx ts-node src/scripts/prodSync.ts --force
  npx ts-node src/scripts/prodSync.ts --group 23244
  npx ts-node src/scripts/prodSync.ts --cards-only
  `);
}

// Create singleton instance
export const productionSync = new ProductionSync();

// Command line execution
async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  console.log("Starting production sync with options:", options);

  try {
    const results = await productionSync.run(options);
    console.log("Sync completed successfully!");
    console.log(JSON.stringify(results, null, 2));
    process.exit(0);
  } catch (error) {
    console.error("Sync failed:", error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
