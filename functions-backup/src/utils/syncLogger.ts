interface CardDetails {
    id: number;
    name: string;
    groupId: string;
    normalPrice?: number;
    foilPrice?: number;
    rawPrices: Array<{
      type: "Normal" | "Foil";
      price: number;
      groupId: string;
    }>;
  }

export class SyncLogger {
  private startTime: number;
  private cards: CardDetails[] = [];
  private groups: Map<string, { products: number; prices: number }> = new Map();

  constructor(private options: {
      type: "test" | "manual" | "scheduled";
      limit?: number;
      dryRun?: boolean;
      groupId?: string;
    }) {
    this.startTime = Date.now();
  }

  async start(): Promise<void> {
    console.log("\nStarting sync operation...");
    console.log(`Type: ${this.options.type}`);
    if (this.options.limit) console.log(`Limit: ${this.options.limit} cards`);
    if (this.options.groupId) console.log(`Group ID: ${this.options.groupId}`);
    console.log(`Dry Run: ${this.options.dryRun ? "true" : "false"}`);
    console.log("\n=== Fetching Raw Data ===");
  }

  async logGroupFound(totalGroups: number): Promise<void> {
    console.log(`Found ${totalGroups} groups`);
  }

  async logGroupDetails(groupId: string, products: number, prices: number): Promise<void> {
    this.groups.set(groupId, {products, prices});
    console.log(`Group ${groupId} has ${products} products and ${prices} prices`);
  }

  async logCardDetails(details: CardDetails): Promise<void> {
    this.cards.push(details);
    if (this.cards.length === 1) {
      console.log("\n=== Card Details ===");
    }

    console.log(`Card: ${details.name} (${details.groupId || "UNKNOWN"})`);
    console.log(`- ID: ${details.id}`);
    console.log(`- Group ID: ${details.groupId || "UNKNOWN"}`);

    if (details.rawPrices.length > 0) {
      console.log("- Raw Prices:");
      details.rawPrices.forEach((price) => {
        console.log(`  > ${price.type}: $${price.price.toFixed(2)} (Group: ${price.groupId})`);
      });
    }

    console.log(`- Normal Price: $${details.normalPrice?.toFixed(2) || "0.00"}`);
    console.log(`- Foil Price: $${details.foilPrice?.toFixed(2) || "0.00"}`);
    console.log("---");
  }

  async logSyncResults(results: {
      success: number;
      failures: number;
      groupId?: string;
    }): Promise<void> {
    const duration = (Date.now() - this.startTime) / 1000;

    console.log(`\n=== ${this.capitalizeFirst(this.options.type)} Sync Results ===`);
    if (this.options.dryRun) console.log("DRY RUN MODE - No data will be modified");
    if (this.options.limit) console.log(`Processing limited to ${this.options.limit} cards`);

    console.log("\nResults:");
    console.log(`- Success: ${results.success}`);
    console.log(`- Failures: ${results.failures}`);
    console.log(`- Duration: ${duration.toFixed(1)} seconds`);
    if (results.groupId) console.log(`- Group ID: ${results.groupId}`);
  }

  async finish(): Promise<void> {
    console.log("\nSync operation completed!");
  }

  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
