import fetch from "node-fetch";
import * as crypto from "crypto";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/132.0.0.0 Safari/537.36";

interface SquareEnixCard {
  id: string;
  code: string;
  name_en: string;
  type_en: string;
  job_en: string;
  text_en: string;
  element: string[];
  rarity: string;
  cost: string;
  power: string;
  category_1: string;
  category_2?: string;
  set: string[];
  images: {
    thumbs: string[];
    full: string[];
  };
}

interface SquareEnixApiResponse {
  count: number;
  cards: SquareEnixCard[];
}

// Element translation map from production
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

// Translate elements using the same logic as production
function translateElements(elements: string[]): string[] {
  return elements.map((element) => elementMap[element] || element);
}

// Calculate hash using the exact same method as production
function calculateHash(card: {
  type: string;
  category_1: string;
  category_2: string | null;
  element: string[];
  job: string;
  power: string;
  cost: string;
  rarity: string;
}): string {
  // Only include fields that affect the card's data, not metadata
  const deltaData = {
    type: card.type,
    category_1: card.category_1,
    category_2: card.category_2,
    element: card.element,
    job: card.job,
    power: card.power,
    cost: card.cost,
    rarity: card.rarity,
  };
  return crypto.createHash("md5").update(JSON.stringify(deltaData)).digest("hex");
}

async function fetchCards(): Promise<SquareEnixCard[]> {
  const baseUrl = "https://fftcg.square-enix-games.com/en";

  console.log("Establishing session...");
  const sessionResponse = await fetch(`${baseUrl}/card-browser`, {
    method: "GET",
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
      "accept-encoding": "gzip, deflate, br",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": USER_AGENT,
    },
  });

  if (!sessionResponse.ok) {
    throw new Error(`Failed to establish session: ${sessionResponse.status}`);
  }

  const cookies = sessionResponse.headers.get("set-cookie");
  if (!cookies) {
    throw new Error("No cookies received from session establishment");
  }

  console.log("Session established, fetching cards...");

  const cardsResponse = await fetch(`${baseUrl}/get-cards`, {
    method: "POST",
    headers: {
      "accept": "*/*",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "cookie": cookies,
      "origin": baseUrl,
      "referer": `${baseUrl}/card-browser`,
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify({
      language: "en",
      text: "",
      type: [],
      element: [],
      cost: [],
      rarity: [],
      power: [],
      category_1: [],
      set: [],
      multicard: "",
      ex_burst: "",
      code: "",
      special: "",
      exactmatch: 0,
    }),
  });

  if (!cardsResponse.ok) {
    throw new Error(`Failed to fetch cards: ${cardsResponse.status}`);
  }

  const data = (await cardsResponse.json()) as SquareEnixApiResponse;

  if (!data || !Array.isArray(data.cards)) {
    throw new Error("Invalid response format from Square Enix API");
  }

  return data.cards;
}

async function main() {
  try {
    console.log("Starting Square Enix consistency test...");

    const allCards = await fetchCards();
    console.log(`Successfully fetched ${allCards.length} cards`);

    // Take first 5 cards
    const testCards = allCards.slice(0, 5);
    console.log("Processing test cards...");

    const cardResults = testCards.map((card) => {
      // Handle Crystal cards first (same as production)
      const elements =
        card.type_en === "Crystal" || card.code.startsWith("C-") ? ["Crystal"] : translateElements(card.element);

      return {
        code: card.code,
        name: card.name_en,
        hash: calculateHash({
          type: card.type_en,
          category_1: card.category_1,
          category_2: card.category_2 || null,
          element: elements,
          job: card.type_en === "Summon" ? "" : card.job_en, // Match production logic for Summons
          power: card.power,
          cost: card.cost,
          rarity: card.rarity,
        }),
        data: {
          type: card.type_en,
          category_1: card.category_1,
          category_2: card.category_2 || null,
          element: elements,
          job: card.type_en === "Summon" ? "" : card.job_en,
          power: card.power,
          cost: card.cost,
          rarity: card.rarity,
        },
      };
    });

    console.log("Test Cards:", JSON.stringify(cardResults, null, 2));
    console.log("Test completed successfully");
  } catch (error) {
    console.error("Test failed:", error instanceof Error ? error.message : "Unknown error");
    if (error instanceof Error && error.stack) {
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  }
}

// Add timeout to the entire process
const TOTAL_TIMEOUT = 35000; // 35 seconds total
const timeoutId = setTimeout(() => {
  console.error("Script timed out after", TOTAL_TIMEOUT, "ms");
  process.exit(1);
}, TOTAL_TIMEOUT);

// Run the test
main()
  .catch((error) => {
    console.error("Unhandled error in main:", error);
    process.exit(1);
  })
  .finally(() => {
    clearTimeout(timeoutId);
  });
