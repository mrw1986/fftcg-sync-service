import { squareEnixSync } from "../services/squareEnixSync";
import { logger } from "../utils/logger";
import * as crypto from "crypto";

interface SquareEnixCard {
  code: string;
  type_en: string;
  element: string[];
  rarity: string;
  cost: string;
  power: string;
  category_1: string;
  category_2?: string;
  multicard: string;
  ex_burst: string;
  set: string[];
}

const elementMap: Record<string, string> = {
  火: "Fire",
  氷: "Ice",
  風: "Wind",
  土: "Earth",
  雷: "Lightning",
  水: "Water",
  光: "Light",
  闇: "Dark",
};

function calculateHash(card: SquareEnixCard): string {
  // Normalize element array
  const normalizedElement =
    card.type_en === "Crystal" || card.code.startsWith("C-") ?
      ["Crystal"] :
      (card.element || [])
        .map((e: string) => elementMap[e] || e)
        .filter((e: string) => e)
        .sort();

  // Normalize set array
  const normalizedSet = (card.set || []).filter((s: string) => s).sort();

  // Only include fields that affect the card's properties
  const apiData = {
    code: card.code || "",
    element: normalizedElement,
    rarity: card.rarity || "",
    cost: card.cost || "",
    power: card.power || "",
    category_1: card.category_1 || "",
    category_2: card.category_2 || null,
    multicard: card.multicard === "1",
    ex_burst: card.ex_burst === "1",
    set: normalizedSet,
    cardNumbers: (card.code.includes("/") ? card.code.split("/") : [card.code])
      .map((num: string) => num.trim())
      .filter((num: string) => num)
      .sort(),
  };

  const jsonData = JSON.stringify(apiData);
  return crypto.createHash("md5").update(jsonData).digest("hex");
}

async function main() {
  try {
    // Run test 3 times
    for (let i = 0; i < 3; i++) {
      logger.info(`Test run ${i + 1}:`);

      // Fetch all cards
      const cards = await squareEnixSync.fetchAllCards();

      // Find C-001
      const c001 = cards.find((card) => card.code === "C-001");
      if (!c001) {
        logger.error("Card C-001 not found");
        continue;
      }

      // Log full card data
      logger.info("Full card data:", { card: c001 });

      // Calculate hash
      const hash = calculateHash(c001);
      logger.info("Hash data:", {
        code: c001.code,
        data: JSON.stringify(
          {
            code: c001.code || "",
            element:
              c001.type_en === "Crystal" ? ["Crystal"] : (c001.element || []).map((e) => elementMap[e] || e).sort(),
            rarity: c001.rarity || "",
            cost: c001.cost || "",
            power: c001.power || "",
            category_1: c001.category_1 || "",
            category_2: c001.category_2 || null,
            multicard: c001.multicard === "1",
            ex_burst: c001.ex_burst === "1",
            set: (c001.set || []).sort(),
            cardNumbers: [c001.code],
          },
          null,
          2
        ),
        hash,
      });

      // Wait 5 seconds between runs
      if (i < 2) {
        logger.info("Waiting 5 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  } catch (error) {
    logger.error("Test failed:", { error: String(error) });
  }
}

if (require.main === module) {
  main().catch((error) => logger.error("Fatal error:", { error: String(error) }));
}
