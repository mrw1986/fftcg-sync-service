import { squareEnixSync } from "../services/squareEnixSync";
import { logger } from "../utils/logger";
import * as fs from "fs";

async function main() {
  try {
    logger.info("Starting Square Enix API test");

    // Fetch cards from API
    const cards = await squareEnixSync.fetchAllCards();
    logger.info(`Fetched ${cards.length} cards from Square Enix API`);

    // Write raw data to file in current directory
    fs.writeFileSync("raw-cards.json", JSON.stringify(cards, null, 2), "utf8");
    logger.info("Wrote raw card data to raw-cards.json");

    // Log first card as sample
    if (cards.length > 0) {
      const firstCard = cards[0];
      console.log("\nFirst card sample:");
      Object.entries(firstCard).forEach(([key, value]) => {
        console.log(`${key}: ${JSON.stringify(value, null, 2)}`);
      });
    }

    // Basic data validation
    console.log("\nVerifying data integrity:");
    
    // Check sequential IDs
    const hasSequentialIds = cards.every((card, index) => card.id === index + 1);
    console.log(`1. Sequential IDs: ${hasSequentialIds}`);

    // Validate total count
    console.log(`2. Total cards validation: ${cards.length === 3444}`);

    // Validate first card
    const firstCard = cards[0];
    console.log("3. First card validation:");
    console.log(`   - ID = 1: ${firstCard.id === 1}`);
    console.log(`   - Code = 1-001H: ${firstCard.code === "1-001H"}`);
    console.log(`   - Element = ["火"]: ${JSON.stringify(firstCard.element) === JSON.stringify(["火"])}`);
    console.log(`   - Set = ["Opus I"]: ${JSON.stringify(firstCard.set) === JSON.stringify(["Opus I"])}`);
    console.log(`   - Has valid image URLs: ${firstCard.images?.thumbs?.length > 0 && firstCard.images?.full?.length > 0}`);

    console.log("Test complete");

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Test failed", { error: errorMessage });
    process.exit(1);
  }
}

// Run the test
main().catch(console.error);
