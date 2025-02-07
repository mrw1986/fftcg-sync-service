import { db, COLLECTION } from "../config/firebase";
import { logger } from "../utils/logger";
import { RetryWithBackoff } from "../utils/retry";

interface TcgCard {
  id: string;
  name: string;
  cardNumbers?: string[];
  fullCardNumber?: string;
  number?: string;
  primaryCardNumber?: string;
  power?: string;
  cost?: string;
  job?: string;
  rarity?: string;
}

interface SquareEnixCard {
  id: string;
  code: string;
  name: string;
  type: string;
  category_1: string;
  element: string[];
  job: string;
  power: string;
  cost: string;
  rarity: string;
}

const retry = new RetryWithBackoff();

// Normalize card numbers for consistent comparison
function normalizeCardNumber(number: string): string {
  // Remove all separators and whitespace first
  const clean = number.replace(/[-\s.,;/]/g, "").toUpperCase();

  // Log original and cleaned number
  logger.info("Normalizing number", {
    original: number,
    cleaned: clean,
  });

  // Handle PR prefix case (PR-###)
  if (clean.startsWith("PR")) {
    const match = clean.match(/^PR0*(\d{1,3})/);
    if (match) {
      const normalized = `PR-${match[1].padStart(3, "0")}`;
      logger.info("Normalized PR number", {
        result: normalized,
      });
      return normalized;
    }
  }

  // Handle A-### format
  if (clean.startsWith("A")) {
    const match = clean.match(/^A(\d{3})/);
    if (match) {
      const normalized = `A-${match[1]}`;
      logger.info("Normalized A number", {
        result: normalized,
      });
      return normalized;
    }
  }

  // Handle numeric prefix cases (#-###X or ##-###X)
  const match = clean.match(/^(\d{1,2})(\d{3})([A-Z])?$/);
  if (match) {
    const [, prefix, nums, letter] = match;
    const normalized = letter ? `${prefix}-${nums}${letter}` : `${prefix}-${nums}`;
    logger.info("Normalized numeric number", {
      result: normalized,
    });
    return normalized;
  }

  logger.info("Using cleaned number", {
    result: clean,
  });
  return clean;
}

// Check if two cards match based on their properties
function validateCardMatch(tcgCard: TcgCard, seCard: SquareEnixCard): boolean {
  let validationPoints = 0;
  const validationResults: Record<string, boolean> = {};

  // Check power
  if (tcgCard.power && seCard.power) {
    validationResults.power = tcgCard.power === seCard.power;
    if (validationResults.power) validationPoints++;
  }

  // Check cost
  if (tcgCard.cost && seCard.cost) {
    validationResults.cost = tcgCard.cost === seCard.cost;
    if (validationResults.cost) validationPoints++;
  }

  // Check job
  if (tcgCard.job && seCard.job) {
    validationResults.job = tcgCard.job.toLowerCase() === seCard.job.toLowerCase();
    if (validationResults.job) validationPoints++;
  }

  // Check rarity
  if (tcgCard.rarity && seCard.rarity) {
    validationResults.rarity = tcgCard.rarity.toLowerCase() === seCard.rarity.toLowerCase();
    if (validationResults.rarity) validationPoints++;
  }

  // Log validation details
  logger.info("Card validation details:", {
    tcgCardId: tcgCard.id,
    seCardId: seCard.id,
    validationResults,
    validationPoints,
  });

  // Require at least 2 matching properties for validation
  return validationPoints >= 2;
}

async function main() {
  try {
    logger.info("Starting card matching test");

    // Fetch a sample of cards from both collections
    const [tcgCardsSnapshot, seCardsSnapshot] = await Promise.all([
      retry.execute(() =>
        db.collection(COLLECTION.CARDS)
          .limit(10)
          .get()
      ),
      retry.execute(() =>
        db.collection(COLLECTION.SQUARE_ENIX_CARDS)
          .limit(20) // Fetch more to increase chance of matches
          .get()
      ),
    ]);

    const tcgCards = tcgCardsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as TcgCard[];

    const seCards = seCardsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as SquareEnixCard[];

    logger.info(`Fetched ${tcgCards.length} TCG cards and ${seCards.length} Square Enix cards`);

    // Process each TCG card
    for (const tcgCard of tcgCards) {
      logger.info("\nProcessing TCG card:", {
        id: tcgCard.id,
        name: tcgCard.name,
        cardNumbers: tcgCard.cardNumbers,
        fullCardNumber: tcgCard.fullCardNumber,
        number: tcgCard.number,
        primaryCardNumber: tcgCard.primaryCardNumber,
      });

      // Get all possible card numbers for matching
      const cardNumbers = [
        ...(tcgCard.cardNumbers || []),
        tcgCard.fullCardNumber,
        tcgCard.number,
        tcgCard.primaryCardNumber,
      ].filter(Boolean).map((num) => normalizeCardNumber(num as string));

      logger.info("Card numbers to match:", {
        original: {
          cardNumbers: tcgCard.cardNumbers,
          fullCardNumber: tcgCard.fullCardNumber,
          number: tcgCard.number,
          primaryCardNumber: tcgCard.primaryCardNumber,
        },
        normalized: cardNumbers,
      });

      // Find potential matches
      let foundCodeMatch = false;
      const matches = seCards.filter((seCard) => {
        // First check if the code matches any of the card numbers
        const normalizedSeCode = normalizeCardNumber(seCard.code);

        // Try different normalization approaches for comparison
        const codeMatches = cardNumbers.some((num) => {
          const exactMatch = num === normalizedSeCode;
          const noSuffixMatch = num.replace(/[A-Z]$/, "") === normalizedSeCode.replace(/[A-Z]$/, "");
          const result = exactMatch || noSuffixMatch;

          if (result) {
            logger.info("Found code match:", {
              tcgNumber: num,
              seCode: normalizedSeCode,
              matchType: exactMatch ? "exact" : "no-suffix",
            });
            foundCodeMatch = true;
          }

          return result;
        });

        // Only proceed with validation if we have a code match
        if (!codeMatches) return false;

        // Validate the match using other properties
        const isValid = validateCardMatch(tcgCard, seCard);

        if (isValid) {
          logger.info("Match validated!", {
            tcgCard: {
              name: tcgCard.name,
              numbers: cardNumbers,
            },
            seCard: {
              name: seCard.name,
              code: seCard.code,
              normalizedCode: normalizedSeCode,
            },
          });
        }

        return isValid;
      });

      if (matches.length === 0) {
        logger.info("No matches found", {
          foundCodeMatch,
          cardNumbers,
        });
        continue;
      }

      // Log matches and what would be supplemented
      for (const match of matches) {
        logger.info("Found match:", {
          tcgCard: {
            id: tcgCard.id,
            name: tcgCard.name,
            cardNumbers,
          },
          squareEnixCard: {
            id: match.id,
            code: match.code,
            name: match.name,
          },
          fieldsToUpdate: {
            cardType: match.type || undefined,
            category: match.category_1 || undefined,
            elements: match.element || undefined,
            job: match.job || undefined,
            name: match.name || undefined,
            power: match.power || undefined,
            rarity: match.rarity || undefined,
          },
        });
      }
    }

    logger.info("\nTest completed successfully");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Test failed", { error: errorMessage });
    process.exit(1);
  }
}

// Run the test
main().catch(console.error);
