interface CardDetails {
  id: number;
  name: string;
  groupId: string;
  cardNumber: string;
  normalPrice?: number;
  foilPrice?: number;
  rawPrices: Array<{
    type: string;
    price: number;
    groupId: string;
  }>;
  highResUrl?: string;
  lowResUrl?: string;
}

interface SyncLoggerOptions {
  type: "manual" | "scheduled" | "both";
  limit?: number;
  dryRun?: boolean;
  groupId?: string;
  batchSize?: number;
}

interface SyncResults {
  success: number;
  failures: number;
  groupId?: string;
  type: string;
  imagesProcessed?: number;
  imagesUpdated?: number;
}

export class SyncLogger {
  private startTime: number;
  private cards: CardDetails[] = [];
  private groups: Map<string, { products: number; prices: number }> = new Map();

  constructor(private options: SyncLoggerOptions) {
    this.startTime = Date.now();
  }

  async start(): Promise<void> {
    console.log("\nStarting sync operation...");
    console.log(`Type: ${this.options.type}`);
    if (this.options.limit) console.log(`Limit: ${this.options.limit} cards`);
    if (this.options.groupId) console.log(`Group ID: ${this.options.groupId}`);
    console.log(`Dry Run: ${this.options.dryRun ? "Yes" : "No"}`);
    console.log("\n=== Processing Data ===");
  }

  async logGroupFound(totalGroups: number): Promise<void> {
    if (this.options.groupId) {
      console.log(`Processing group ${this.options.groupId}`);
    } else {
      console.log(`Found ${totalGroups} groups to process`);
    }
  }

  async logGroupDetails(
    groupId: string,
    products: number,
    prices: number
  ): Promise<void> {
    if (!this.options.groupId || this.options.groupId === groupId) {
      this.groups.set(groupId, {products, prices});
      console.log(`Group ${groupId}: ${products} products, ${prices} prices`);
    }
  }

  async logCardDetails(details: CardDetails): Promise<void> {
    if (!this.options.groupId || this.options.groupId === details.groupId) {
      this.cards.push(details);
      if (this.cards.length === 1) {
        console.log("\n=== Card Details ===");
      }

      console.log(`\nCard: ${details.name}`);
      console.log(`ID: ${details.id}`);
      if (details.cardNumber) console.log(`Number: ${details.cardNumber}`);
      console.log(`Group: ${details.groupId}`);

      if (details.rawPrices.length > 0) {
        console.log("Prices:");
        details.rawPrices.forEach((price) => {
          console.log(`  ${price.type}: $${price.price.toFixed(2)}`);
        });
      }

      if (details.highResUrl || details.lowResUrl) {
        console.log("Images:");
        if (details.highResUrl) {
          console.log(`  High Res: ${details.highResUrl}`);
        }
        if (details.lowResUrl) {
          console.log(`  Low Res: ${details.lowResUrl}`);
        }
      }
    }
  }

  async logManualSyncStart(): Promise<void> {
    console.log("\n=== Starting Manual Sync ===");
    if (this.options.groupId) {
      console.log(`Filtering for group: ${this.options.groupId}`);
    }
    if (this.options.dryRun) {
      console.log("DRY RUN MODE - No data will be modified");
    }
    if (this.options.limit) {
      console.log(`Limited to ${this.options.limit} cards`);
    }
    if (this.options.batchSize) {
      console.log(`Batch size: ${this.options.batchSize}`);
    }
    console.log();
  }

  async logSyncResults(results: SyncResults): Promise<void> {
    const duration = (Date.now() - this.startTime) / 1000;

    console.log("\n=== Sync Results ===");
    console.log(`Operation: ${results.type}`);
    if (results.groupId) {
      console.log(`Group: ${results.groupId}`);
    }
    console.log(`Duration: ${duration.toFixed(1)} seconds`);
    console.log(`Successful Operations: ${results.success}`);
    console.log(`Failed Operations: ${results.failures}`);

    if (typeof results.imagesProcessed === "number") {
      console.log("\nImage Processing:");
      console.log(`Total Processed: ${results.imagesProcessed}`);
      console.log(`Updated: ${results.imagesUpdated || 0}`);
      console.log(
        `Unchanged: ${results.imagesProcessed - (results.imagesUpdated || 0)}`
      );
    }

    if (this.cards.length > 0) {
      console.log(`\nProcessed Cards: ${this.cards.length}`);
      const withImages = this.cards.filter(
        (card) => card.highResUrl || card.lowResUrl
      ).length;
      console.log(`Cards with Images: ${withImages}`);
      console.log(`Cards without Images: ${this.cards.length - withImages}`);
    }
  }

  async finish(): Promise<void> {
    const totalDuration = (Date.now() - this.startTime) / 1000;
    console.log("\n=== Operation Complete ===");
    console.log(`Total Duration: ${totalDuration.toFixed(1)} seconds`);

    if (this.options.dryRun) {
      console.log("\nThis was a dry run - no changes were made");
      console.log("Remove --dry-run flag to perform actual updates");
    }
  }
}
