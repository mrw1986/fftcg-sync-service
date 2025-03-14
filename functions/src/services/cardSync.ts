// src/services/cardSync.ts
import { db, COLLECTION } from "../config/firebase";
import { tcgcsvApi } from "../utils/api";
import { storageService } from "./storageService";
import { CardProduct, SyncResult, SyncOptions, ImageResult } from "../types";
import { logger } from "../utils/logger";
import { Cache } from "../utils/cache";
import { RetryWithBackoff } from "../utils/retry";
import * as crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { OptimizedBatchProcessor } from "./batchProcessor";

interface CardDeltaData {
  name: string;
  cleanName: string;
  modifiedOn: string;
  cardType: string | null;
  number: string | null;
  rarity: string | null;
  cost: number | null;
  power: number | null;
  elements: string[];
  set: string[]; // Added set field
  category: string | null;
  cardNumbers: string[] | null; // Added cardNumbers field for hash calculation
  fullCardNumber: string | null; // Added fullCardNumber field for hash calculation
}

interface CardDocument {
  productId: number;
  name: string;
  cleanName: string;
  fullResUrl: string | null;
  highResUrl: string | null;
  lowResUrl: string | null;
  lastUpdated: FirebaseFirestore.FieldValue;
  groupId: number;
  isNonCard: boolean;
  cardNumbers: string[] | null;
  primaryCardNumber: string | null;
  fullCardNumber: string | null;
  cardType: string | null;
  category: string | null;
  categories: string[];
  cost: number | null;
  description: string | null;
  elements: string[];
  job: string | null;
  number: string | null;
  power: number | null;
  rarity: string | null;
  set: string[]; // Added set field
  dataVersion: number; // Added dataVersion field for incremental sync
}

export class CardSyncService {
  private readonly CHUNK_SIZE = 1000;
  private readonly MAX_EXECUTION_TIME = 510; // 8.5 minutes

  private readonly cache = new Cache<string>(15);
  private readonly retry = new RetryWithBackoff();
  private readonly batchProcessor: OptimizedBatchProcessor;

  constructor() {
    this.batchProcessor = new OptimizedBatchProcessor(db);
  }

  private isApproachingTimeout(startTime: Date, safetyMarginSeconds = 30): boolean {
    const executionTime = (new Date().getTime() - startTime.getTime()) / 1000;
    return executionTime > this.MAX_EXECUTION_TIME - safetyMarginSeconds;
  }

  private getElements(card: CardProduct): string[] {
    // Check if it's a Crystal card by looking at card type or number
    const cardType = card.extendedData.find((data) => data.name === "CardType")?.value;
    const numberField = card.extendedData.find((data) => data.name === "Number");
    const isCrystal =
      (cardType && String(cardType).toLowerCase() === "crystal") ||
      (numberField?.value && String(numberField.value).toUpperCase().startsWith("C-"));

    if (isCrystal) {
      logger.info("Setting Crystal element for card", {
        id: card.productId,
        name: card.name,
        type: cardType,
        number: numberField?.value,
      });
      return ["Crystal"];
    }

    // For non-Crystal cards, process elements normally
    const elementField = card.extendedData.find((data) => data.name === "Element");
    if (!elementField?.value) return [];

    const valueStr = String(elementField.value);
    return valueStr
      .split(/[;,]/)
      .map((element: string) => element.trim())
      .filter((element: string) => element.length > 0)
      .map((element: string) => element.charAt(0).toUpperCase() + element.slice(1).toLowerCase());
  }

  private getExtendedValue(card: CardProduct, fieldName: string): string | null {
    const field = card.extendedData.find((data) => data.name === fieldName);
    return field?.value?.toString() || null;
  }

  private normalizeNumericValue(value: string | number | null | undefined): number | null {
    if (value === undefined || value === null || value === "") return null;
    const num = typeof value === "number" ? value : parseFloat(String(value));
    return isNaN(num) ? null : num;
  }

  private normalizeCategory(category: string): string {
    // Handle specific categories that need consistent formatting
    if (category.toUpperCase() === "THEATRHYTHM") return "Theatrhythm";
    if (category.toUpperCase() === "MOBIUS") return "Mobius";
    if (category.toUpperCase() === "PICTLOGICA") return "Pictlogica";
    if (category.toUpperCase() === "TYPE-0") return "Type-0";

    // Handle specific category conversions to acronyms
    if (category.toLowerCase() === "world of final fantasy") return "WOFF";
    if (category.toLowerCase() === "lord of vermilion") return "LOV";

    // Check if it's a Roman numeral (I, II, III, IV, V, VI, VII, VIII, IX, X, XI, XII, XIII, XIV, XV, XVI)
    const romanNumeralPattern = /^(X{0,3})(IX|IV|V?I{0,3})$/i;
    if (romanNumeralPattern.test(category)) {
      return category.toUpperCase(); // Keep Roman numerals uppercase
    }

    // For any other category, ensure it's not all-caps unless it's an acronym
    if (category === category.toUpperCase() && category.length > 1) {
      // Check if it's a known acronym or starts with FF (Final Fantasy)
      const knownAcronyms = [
        "DFF",
        "FF",
        "WOFF",
        "FFCC",
        "FFTA",
        "FFBE",
        "FFEX",
        "FFL",
        "FFRK",
        "FFT",
        "FFTA2",
        "MQ",
        "LOV",
        "SOPFFO",
      ];

      if (knownAcronyms.includes(category) || category.startsWith("FF")) {
        return category; // Keep known acronyms as-is
      }

      // Otherwise, convert to title case (first letter of each word capitalized)
      return category
        .toLowerCase()
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    }

    return category;
  }

  private processCategories(categoryStr: string | null): { category: string | null; categories: string[] } {
    if (!categoryStr) return { category: null, categories: [] };

    // Replace HTML entity with actual middot
    const normalizedStr = categoryStr.replace(/&middot;/g, "\u00B7");

    // Split by either semicolon or middot
    const cats = normalizedStr
      .split(/[;\u00B7]/)
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => this.normalizeCategory(c)); // Apply category normalization
    if (cats.length === 0) return { category: null, categories: [] };

    // Ensure DFF is first if present
    const dffIndex = cats.findIndex((c) => c === "DFF");
    if (dffIndex > 0) {
      const dff = cats.splice(dffIndex, 1)[0];
      cats.unshift(dff);
    }

    // Join with middot for category string
    const category = cats.join("\u00B7");

    return { category, categories: cats };
  }

  private cleanCardName(name: string): string {
    logger.info("Cleaning card name", { original: name });

    // First remove all card numbers and PR prefixes
    const withoutNumbers = name
      // Remove PR numbers with secondary numbers (e.g., PR-123/1-234H)
      .replace(/\s*[-–—]\s*PR-?\d+\/[^(\s]+/, "")
      // Remove standalone PR numbers (e.g., PR-123, PR123)
      .replace(/\s*[-–—]\s*PR-?\d+/, "")
      // Remove standard card numbers (e.g., 1-234H)
      .replace(/\s*[-–—]\s*\d{1,2}-\d{3}[A-Z]/, "")
      // Remove special card numbers (e.g., A-123, C-123)
      .replace(/\s*[-–—]\s*[A-C]-\d{3}/, "")
      // Remove any remaining PR prefix
      .replace(/\s*[-–—]\s*PR\b/, "")
      .trim();

    logger.info("After number removal", { withoutNumbers });

    // Preserve special type indicators (EX, LB)
    const hasSpecialType = /\b(EX|LB)\b/.test(withoutNumbers);
    const specialType = hasSpecialType ? withoutNumbers.match(/\b(EX|LB)\b/)?.[0] : null;

    // Remove all parentheses content
    const cleanedName = withoutNumbers.replace(/\s*\([^)]+\)/g, "").trim();

    // Add back special type if it existed
    const result = specialType && !cleanedName.includes(specialType) ? `${cleanedName} ${specialType}` : cleanedName;

    logger.info("Final clean name", { result });
    return result;
  }

  private cleanDisplayName(name: string, cardNumbers: string[] | null): string {
    logger.info("Cleaning display name", { original: name });

    // First remove parentheses with PR numbers
    let withoutNumbers = name
      // Remove parentheses containing PR numbers (e.g., "(PR-055)")
      .replace(/\s*\(PR-?\d+\)/, "")
      // Remove parentheses containing card numbers (e.g., "(1-044R)", "(B-038)")
      .replace(/\s*\(\d{1,2}-\d{3}[A-Z]\)/, "")
      .replace(/\s*\([A-C]-\d{3}\)/, "")
      // Then remove other card numbers
      .replace(/(?:\s*[-–—]\s*PR)?-?\d+\/[^(\s]+(?=\s*\(|$)/, "") // PR numbers with secondary numbers
      .replace(/\s*[-–—]\s*PR-?\d+(?=\s*\(|$)/, "") // standalone PR numbers
      .replace(/\s*[-–—]\s*\d{1,2}-\d{3}[A-Z](?=\s*\(|$)/, "") // standard card numbers
      .replace(/\s*[-–—]\s*[A-C]-\d{3}(?=\s*\(|$)/, "") // special card numbers
      .replace(/\s*[-–—]\s*PR\b/, "") // remaining PR prefix
      .replace(/\s*[-–—]\s*\d+[^(\s]*(?=\s*\(|$)/, "") // remaining numbers after hyphen
      .trim();

    logger.info("After number removal", { withoutNumbers });

    // Fix incomplete parentheses patterns like "(1" or "(B" at the end of the name
    const hasIncompleteParentheses = /\([A-C1-9](?!\))/.test(withoutNumbers);
    if (hasIncompleteParentheses) {
      // Remove the incomplete parentheses
      const cleanedName = withoutNumbers.replace(/\s*\([A-C1-9][^)]*$/, "").trim();
      logger.info("Fixed incomplete parentheses", {
        original: withoutNumbers,
        cleaned: cleanedName,
      });
      withoutNumbers = cleanedName;
    }

    // Special keywords that indicate we should keep the content
    const specialKeywords = [
      "Full Art",
      "Promo",
      "Road to World Championship",
      "Champion",
      "Anniversary",
      "Prerelease Promo",
      "Alternate Art Promo",
      "Full Art Reprint",
      "Buy A Box Promo",
      "Class Zero Cadet",
    ];

    // Process all parentheses content
    const parts = withoutNumbers.split(/\s*\((.*?)\)\s*/);
    const processedParts: string[] = [parts[0]]; // Start with the base name

    logger.info("Processing parts", { baseName: parts[0], remainingParts: parts.slice(1) });

    // Process each parentheses content
    for (let i = 1; i < parts.length; i += 2) {
      const content = parts[i];
      if (!content) continue;

      logger.info("Processing content", { content });

      // Remove "(Common)" and "(Rare)" suffixes
      if (/^(?:Common|Rare)$/.test(content)) {
        logger.info("Skipping Common/Rare suffix", { content });
        continue;
      }

      // Skip PR numbers and incomplete PR parentheses
      if (/^PR-?\d+$/.test(content) || content === "PR" || content.startsWith("PR-")) {
        logger.info("Skipping PR content", { content });
        continue;
      }

      // Skip standalone card number patterns (e.g., "1", "B", "1-044R", "B-038")
      if (/^(\d{1,2}|\d{1,2}-\d{3}[A-Z]|[A-C]|[A-C]-\d{3})$/.test(content)) {
        logger.info("Skipping card number content", { content });
        continue;
      }

      // Fix partial content like "19 (Full Art" to just "Full Art"
      if (/^\d+\s+\((.+)$/.test(content)) {
        const match = content.match(/^\d+\s+\((.+)$/);
        if (match && match[1]) {
          logger.info("Fixing partial content", { original: content, fixed: match[1] });
          processedParts.push(`(${match[1]})`);
          continue;
        }
      }

      // Always keep special keywords
      if (specialKeywords.some((keyword) => content.includes(keyword))) {
        logger.info("Keeping special keyword content", { content });
        processedParts.push(`(${content})`);
        continue;
      }

      // Keep month year patterns
      const monthYearPattern =
        /^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/;
      if (monthYearPattern.test(content)) {
        logger.info("Keeping month year pattern", { content });
        processedParts.push(`(${content})`);
        continue;
      }

      // Keep content with years (but not if it's just a number)
      if (/\b\d{4}\b/.test(content) && !/^\d+$/.test(content)) {
        logger.info("Keeping content with year", { content });
        processedParts.push(`(${content})`);
        continue;
      }

      logger.info("Skipping content", { content });
    }

    // Check if this is a promo card by looking at cardNumbers
    const isPromoCard = cardNumbers?.some((num) => num.startsWith("PR-")) || /PR-?\d+/.test(name);
    const hasSpecialKeyword = processedParts.length > 1; // Has any special content in parentheses

    // If it's a promo card and doesn't have any special keywords, add (Promo)
    if (isPromoCard && !hasSpecialKeyword) {
      processedParts.push("(Promo)");
      logger.info("Adding (Promo) suffix", { isPromoCard, hasSpecialKeyword });
    }

    // Join all parts with spaces and clean up any double spaces
    const result = processedParts.join(" ").replace(/\s+/g, " ").trim();
    logger.info("Final display name", { result, isPromoCard, hasSpecialKeyword });
    return result;
  }

  private processDescription(description: string | null): string | null {
    if (!description) return null;

    // 1. Capitalize "ex burst" to "EX BURST"
    let processed = description.replace(/\bex burst\b/gi, "EX BURST");

    // 2. Remove any HTML tags wrapping Dull
    processed = processed.replace(/<[^>]+>Dull<\/[^>]+>/g, "Dull");

    // 3. Handle "Dull" text based on position relative to colon
    const parts = processed.split(/\s*:\s*/);
    if (parts.length === 2) {
      // Left side: Keep [Dull] and remove unbracketed Dull
      let leftSide = parts[0];
      // Temporarily protect [Dull]
      leftSide = leftSide.replace(/\[Dull\]/g, "###PROTECTED_DULL###");
      // Remove unbracketed Dull
      leftSide = leftSide.replace(/\bDull\b/g, "");
      // Restore [Dull]
      leftSide = leftSide.replace(/###PROTECTED_DULL###/g, "[Dull]");

      // Right side: First remove any duplicate "Dull" words
      let rightSide = parts[1];
      // Replace multiple consecutive "Dull" with a single "Dull"
      rightSide = rightSide.replace(/\bDull\s+Dull\b/g, "Dull");
      // Replace any bracketed [Dull] with unbracketed Dull
      rightSide = rightSide.replace(/\[Dull\]/g, "Dull");

      // Combine the parts
      processed = `${leftSide}: ${rightSide}`;
    }

    return processed;
  }

  private isValidNormalizedNumber(number: string): boolean {
    // Check PR-### format
    if (number.match(/^PR-\d{3}$/)) return true;
    // Check #-###X or ##-###X format
    if (number.match(/^\d{1,2}-\d{3}[A-Z]$/)) return true;
    // Check A-### format
    if (number.match(/^A-\d{3}$/)) return true;
    // Check C-### format (Crystal cards)
    if (number.match(/^C-\d{3}$/)) return true;
    // Check B-### format (Bonus cards)
    if (number.match(/^B-\d{3}$/)) return true;
    // Check Re-###X format (Reprint cards)
    if (number.match(/^Re-\d{3}[A-Z]$/)) return true;
    return false;
  }

  private normalizeCardNumber(number: string): string | null {
    // Remove all separators and whitespace
    const clean = number.replace(/[-\s.,;]/g, "").toUpperCase();

    // Handle P/PR prefix case
    if (clean.startsWith("P")) {
      // Match P/PR followed by digits, handling leading zeros
      const match = clean.match(/^P(?:R)?0*(\d{1,3})/);
      if (!match) {
        logger.warn(`Invalid P/PR card number format: ${number}`);
        return null;
      }
      // Pad to 3 digits and always use PR- prefix
      const paddedNum = match[1].padStart(3, "0");
      return `PR-${paddedNum}`;
    }

    // Handle Re-### format (Reprint cards)
    if (clean.startsWith("RE")) {
      const match = clean.match(/^RE0*(\d{1,3})([A-Z])$/);
      if (match) {
        const paddedNum = match[1].padStart(3, "0");
        return `Re-${paddedNum}${match[2]}`;
      }
    }

    // Handle A-### format
    if (clean.startsWith("A")) {
      const match = clean.match(/^A0*(\d{1,3})/);
      if (match) {
        const paddedNum = match[1].padStart(3, "0");
        return `A-${paddedNum}`;
      }
    }

    // Handle B-### format (Bonus cards)
    if (clean.startsWith("B")) {
      const match = clean.match(/^B0*(\d{1,3})/);
      if (match) {
        const paddedNum = match[1].padStart(3, "0");
        return `B-${paddedNum}`;
      }
    }

    // Handle C-### format (Crystal cards)
    if (clean.startsWith("C")) {
      const match = clean.match(/^C0*(\d{1,3})/);
      if (match) {
        const paddedNum = match[1].padStart(3, "0");
        return `C-${paddedNum}`;
      }
    }

    // Handle numeric prefix cases (#-###X or ##-###X)
    const match = clean.match(/^(\d{1,2})(\d{3})([A-Z])$/);
    if (match) {
      const [, prefix, nums, letter] = match;
      // Validate prefix is between 1-99
      const prefixNum = parseInt(prefix);
      if (prefixNum < 1 || prefixNum > 99) {
        logger.warn(`Invalid card number prefix: ${number}`);
        return null;
      }
      return `${prefix}-${nums}${letter}`;
    }

    // If the format doesn't match our expected patterns, log a warning and return null
    logger.warn(`Unable to normalize card number: ${number}`);
    return null;
  }

  private getCardNumbers(card: CardProduct): {
    numbers: string[] | null;
    primary: string | null;
    fullNumber: string | null;
  } {
    const numbers: string[] = [];
    let originalFormat = "";

    // Get all card numbers and preserve original format
    card.extendedData
      .filter((data) => data.name === "Number")
      .forEach((numberField) => {
        const valueStr = String(numberField.value);
        originalFormat = valueStr;

        // Special handling for Re- prefixed numbers
        if (valueStr.includes("Re-")) {
          logger.info(`Processing card with Re- prefix: ${valueStr}`);

          // Split on any separator and process each part
          const vals = valueStr.split(/[,;/]/).map((n: string) => n.trim());

          // Process each number individually to ensure Re- numbers are included
          for (const val of vals) {
            const normalizedNum = this.normalizeCardNumber(val);
            if (normalizedNum) {
              logger.info(`Normalized Re- number: ${val} -> ${normalizedNum}`);
              numbers.push(normalizedNum);
            }
          }
        } else {
          // Standard processing for non-Re numbers
          // Split on any separator and normalize each number
          const vals = valueStr.split(/[,;/]/).map((n: string) => n.trim());
          const normalizedNums = vals.map((num: string) => this.normalizeCardNumber(num));
          // Filter out any null values
          const validNums = normalizedNums.filter((num): num is string => num !== null);
          numbers.push(...validNums);
        }
      });

    // If no valid numbers found, return null values
    if (numbers.length === 0) {
      return {
        numbers: null,
        primary: null,
        fullNumber: null,
      };
    }

    // Remove duplicates while preserving order
    const uniqueNumbers = [...new Set(numbers)];

    // Find a valid primary card number
    let primary: string | null = null;

    // First try to find a non-Re- number to use as primary
    const nonReNumber = uniqueNumbers.find((num) => !num.startsWith("Re-"));
    if (nonReNumber && this.isValidNormalizedNumber(nonReNumber)) {
      primary = nonReNumber;
    } else {
      // If no non-Re- number, try the rightmost number
      const rightmost = uniqueNumbers[uniqueNumbers.length - 1];
      if (rightmost && this.isValidNormalizedNumber(rightmost)) {
        primary = rightmost;
      } else {
        // If rightmost isn't valid, try to find the first valid number
        const validNumber = uniqueNumbers.find((num) => this.isValidNormalizedNumber(num));
        if (validNumber) {
          primary = validNumber;
        }
      }
    }

    // For fullNumber, use forward slash as separator
    const fullNumber = uniqueNumbers.length > 0 ? uniqueNumbers.join("/") : null;

    logger.info("Processed card numbers:", {
      original: originalFormat,
      normalized: uniqueNumbers,
      primary,
      fullNumber,
    });

    return {
      numbers: uniqueNumbers,
      primary,
      fullNumber,
    };
  }

  private isNonCardProduct(card: CardProduct): boolean {
    // Check for CardType field
    const cardType = card.extendedData.find((data) => data.name === "CardType")?.value;

    // If CardType exists and is not "sealed product", it's a card
    if (cardType && String(cardType).toLowerCase() !== "sealed product") {
      return false;
    }

    // If no CardType, check for other card-specific fields
    const hasNumber = card.extendedData.some((data) => data.name === "Number" && data.value);
    const hasPower = card.extendedData.some((data) => data.name === "Power" && data.value);
    const hasJob = card.extendedData.some((data) => data.name === "Job" && data.value);

    // If it has any of these fields, it's likely a card
    if (hasNumber || hasPower || hasJob) {
      return false;
    }

    // Otherwise, assume it's a non-card product
    return true;
  }

  private getDeltaData(card: CardProduct): CardDeltaData {
    const set = ["Unknown"]; // Default to Unknown, will be updated with group name
    const numberField = card.extendedData.find((data) => data.name === "Number");
    const isCrystal = numberField?.value && String(numberField.value).toUpperCase().startsWith("C-");

    // Get card numbers for hash calculation
    const { numbers: cardNumbers, fullNumber: fullCardNumber } = this.getCardNumbers(card);

    return {
      name: card.name,
      cleanName: card.cleanName,
      modifiedOn: card.modifiedOn,
      cardType: isCrystal ? "Crystal" : this.getExtendedValue(card, "CardType"),
      number: this.getExtendedValue(card, "Number"),
      rarity: this.getExtendedValue(card, "Rarity"),
      cost: this.normalizeNumericValue(this.getExtendedValue(card, "Cost")),
      power: this.normalizeNumericValue(this.getExtendedValue(card, "Power")),
      elements: this.getElements(card),
      set,
      category: this.getExtendedValue(card, "Category"),
      cardNumbers,
      fullCardNumber,
    };
  }

  private calculateHash(card: CardProduct): string {
    const deltaData = this.getDeltaData(card);
    return crypto.createHash("md5").update(JSON.stringify(deltaData)).digest("hex");
  }

  private async getStoredHashes(productIds: number[]): Promise<Map<number, string>> {
    const hashMap = new Map<number, string>();
    const uncachedIds: number[] = [];

    productIds.forEach((id) => {
      const cacheKey = `hash_${id}`;
      const cached = this.cache.get(cacheKey);
      if (cached) {
        hashMap.set(id, cached);
      } else {
        uncachedIds.push(id);
      }
    });

    if (uncachedIds.length === 0) {
      return hashMap;
    }

    const chunks = [];
    for (let i = 0; i < uncachedIds.length; i += 10) {
      chunks.push(uncachedIds.slice(i, i + 10));
    }

    await Promise.all(
      chunks.map(async (chunk) => {
        const refs = chunk.map((id) => db.collection(COLLECTION.CARD_HASHES).doc(id.toString()));

        const snapshots = await this.retry.execute(() => db.getAll(...refs));

        snapshots.forEach((snap, index) => {
          const id = chunk[index];
          const hash = snap.exists ? snap.data()?.hash : null;
          if (hash) {
            hashMap.set(id, hash);
            this.cache.set(`hash_${id}`, hash);
          }
        });
      })
    );

    return hashMap;
  }
  private async processCards(
    cards: CardProduct[],
    groupId: number,
    options: { forceUpdate?: boolean } = {}
  ): Promise<{
    processed: number;
    updated: number;
    errors: string[];
  }> {
    const result = {
      processed: 0,
      updated: 0,
      errors: [] as string[],
    };

    try {
      const productIds = cards.map((card) => card.productId);
      const hashMap = await this.getStoredHashes(productIds);

      // Get the current metadata version
      const metadata = await db.collection(COLLECTION.SYNC_METADATA).doc("cards").get();
      const currentVersion = metadata.exists ? metadata.data()?.version || 1 : 1;
      logger.info(`Using dataVersion ${currentVersion} for card updates`);

      // Get the group name from Firestore
      const groupRef = db.collection(COLLECTION.GROUPS).doc(groupId.toString());
      const groupDoc = await this.retry.execute(() => groupRef.get());
      const groupName = groupDoc.exists ? groupDoc.data()?.name : null;
      const set = groupName ? [groupName] : [];

      await Promise.all(
        cards.map(async (card) => {
          try {
            result.processed++;

            const {
              numbers: cardNumbers,
              primary: primaryCardNumber,
              fullNumber: fullCardNumber,
            } = this.getCardNumbers(card);

            const currentHash = this.calculateHash(card);
            const storedHash = hashMap.get(card.productId);

            // Check if the card document exists
            const cardRef = db.collection(COLLECTION.CARDS).doc(card.productId.toString());
            const cardSnapshot = await this.retry.execute(() => cardRef.get());

            // Check if the card document has the dataVersion field
            const cardData = cardSnapshot.data();
            const hasDataVersion = cardSnapshot.exists && cardData && "dataVersion" in cardData;

            // Skip only if document exists, hash matches, has dataVersion, and not forcing update
            if (cardSnapshot.exists && currentHash === storedHash && hasDataVersion && !options.forceUpdate) {
              logger.info(`Skipping card ${card.productId} - no changes detected`);
              return;
            }

            // Log if processing due to missing dataVersion
            if (cardSnapshot.exists && currentHash === storedHash && !hasDataVersion) {
              logger.info(`Processing card ${card.productId} - adding dataVersion field`);
            }

            logger.info(
              `Processing card ${card.productId} - ${!cardSnapshot.exists ? "new card" : "updating existing card"}`
            );

            // Process image handling
            const imageResult = await (async () => {
              const PLACEHOLDER_URL = "https://fftcgcompanion.com/card-images/image-coming-soon.jpeg";
              if (card.imageUrl) {
                // If URL exists, process normally
                return await this.retry.execute(() =>
                  storageService.processAndStoreImage(card.imageUrl, card.productId, groupId.toString())
                );
              } else {
                // For any item without image, use placeholder URL
                return {
                  fullResUrl: PLACEHOLDER_URL,
                  highResUrl: PLACEHOLDER_URL,
                  lowResUrl: PLACEHOLDER_URL,
                  metadata: {},
                } as ImageResult;
              }
            })();

            // Get description and process it
            const rawDescription = this.getExtendedValue(card, "Description");
            const processedDescription = this.processDescription(rawDescription);

            // Process categories
            const rawCategory = this.getExtendedValue(card, "Category");
            const { category, categories } = this.processCategories(rawCategory);

            // Check if it's a Crystal card
            const numberField = card.extendedData.find((data) => data.name === "Number");
            const isCrystal = numberField?.value && String(numberField.value).toUpperCase().startsWith("C-");

            const cardDoc: CardDocument = {
              productId: card.productId,
              name: this.cleanDisplayName(card.name, cardNumbers),
              cleanName: this.cleanCardName(card.name),
              fullResUrl: imageResult.fullResUrl,
              highResUrl: imageResult.highResUrl,
              lowResUrl: imageResult.lowResUrl,
              lastUpdated: FieldValue.serverTimestamp(),
              groupId,
              isNonCard: this.isNonCardProduct(card),
              cardNumbers,
              primaryCardNumber,
              fullCardNumber,
              cardType: isCrystal ? "Crystal" : this.getExtendedValue(card, "CardType"),
              category,
              categories,
              cost: this.normalizeNumericValue(this.getExtendedValue(card, "Cost")),
              description: processedDescription,
              elements: this.getElements(card),
              job: this.getExtendedValue(card, "Job"),
              number: this.getExtendedValue(card, "Number"),
              power: this.normalizeNumericValue(this.getExtendedValue(card, "Power")),
              rarity: this.getExtendedValue(card, "Rarity"),
              set,
              dataVersion: currentVersion, // Add the current version to enable incremental sync
            };

            // Add main card document
            await this.batchProcessor.addOperation((batch) => {
              const cardRef = db.collection(COLLECTION.CARDS).doc(card.productId.toString());
              batch.set(cardRef, cardDoc, { merge: true });
            });

            // Add image metadata
            await this.batchProcessor.addOperation((batch) => {
              const cardRef = db.collection(COLLECTION.CARDS).doc(card.productId.toString());
              batch.set(cardRef.collection("metadata").doc("image"), imageResult.metadata, { merge: true });
            });

            // Update hash
            await this.batchProcessor.addOperation((batch) => {
              const hashRef = db.collection(COLLECTION.CARD_HASHES).doc(card.productId.toString());
              batch.set(
                hashRef,
                {
                  hash: currentHash,
                  lastUpdated: FieldValue.serverTimestamp(),
                },
                { merge: true }
              );
            });

            // Save delta using productId as document ID
            await this.batchProcessor.addOperation((batch) => {
              const deltaRef = db.collection(COLLECTION.CARD_DELTAS).doc(card.productId.toString());
              batch.set(
                deltaRef,
                {
                  productId: card.productId,
                  changes: cardDoc,
                  lastUpdated: FieldValue.serverTimestamp(),
                },
                { merge: true }
              );
            });

            this.cache.set(`hash_${card.productId}`, currentHash);
            result.updated++;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            result.errors.push(`Error processing card ${card.productId}: ${errorMessage}`);
            logger.error(`Error processing card ${card.productId}`, { error: errorMessage });
          }
        })
      );

      await this.batchProcessor.commitAll();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Batch processing error: ${errorMessage}`);
      logger.error("Batch processing error", { error: errorMessage });
    }

    return result;
  }

  async syncCards(options: SyncOptions & { limit?: number } = {}): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      itemsProcessed: 0,
      itemsUpdated: 0,
      errors: [],
      timing: {
        startTime: new Date(),
      },
    };

    try {
      logger.info("Starting card sync", { options });

      const groups = options.groupId ?
        [{ groupId: options.groupId }] :
        await this.retry.execute(() => tcgcsvApi.getGroups());

      // Apply limit if specified
      if (options.limit) {
        logger.info(`Limiting sync to first ${options.limit} cards`);
      }

      logger.info(`Found ${groups.length} groups to process`);

      for (const group of groups) {
        if (this.isApproachingTimeout(result.timing.startTime)) {
          logger.warn("Approaching function timeout, stopping processing");
          break;
        }

        result.timing.groupStartTime = new Date();

        try {
          logger.info(`Processing group ${group.groupId}`);

          let cards = await this.retry.execute(() => tcgcsvApi.getGroupProducts(group.groupId));

          // Apply limit if specified
          if (options.limit) {
            cards = cards.slice(0, options.limit);
          }

          logger.info(`Retrieved ${cards.length} cards for group ${group.groupId}`);

          for (let i = 0; i < cards.length; i += this.CHUNK_SIZE) {
            if (this.isApproachingTimeout(result.timing.startTime)) {
              logger.warn("Approaching function timeout, stopping chunk processing");
              break;
            }

            const cardChunk = cards.slice(i, i + this.CHUNK_SIZE);
            const batchResults = await this.processCards(cardChunk, parseInt(group.groupId), options);

            result.itemsProcessed += batchResults.processed;
            result.itemsUpdated += batchResults.updated;
            result.errors.push(...batchResults.errors);
          }

          logger.info(`Completed group ${group.groupId}`, {
            processed: result.itemsProcessed,
            updated: result.itemsUpdated,
            errors: result.errors.length,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          result.errors.push(`Error processing group ${group.groupId}: ${errorMessage}`);
          logger.error(`Error processing group ${group.groupId}`, { error: errorMessage });
        }
      }

      result.timing.endTime = new Date();
      result.timing.duration = (result.timing.endTime.getTime() - result.timing.startTime.getTime()) / 1000;

      logger.info(`TCGCSV sync completed in ${result.timing.duration}s`, {
        processed: result.itemsProcessed,
        updated: result.itemsUpdated,
        errors: result.errors.length,
      });

      // TCGCSV sync complete - Square Enix sync and search indexing handled by syncAll.ts
    } catch (error) {
      result.success = false;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Card sync failed: ${errorMessage}`);
      logger.error("Card sync failed", { error: errorMessage });
    }

    return result;
  }
}

export const cardSync = new CardSyncService();
