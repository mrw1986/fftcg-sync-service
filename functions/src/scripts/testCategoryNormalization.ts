// src/scripts/testCategoryNormalization.ts
import { logger } from "../utils/logger";

// Test category normalization
function normalizeCategory(category: string): string {
  // Handle specific categories that need consistent formatting
  if (category.toUpperCase() === "THEATRHYTHM") return "Theatrhythm";
  if (category.toUpperCase() === "MOBIUS") return "Mobius";
  if (category.toUpperCase() === "PICTLOGICA") return "Pictlogica";
  if (category.toUpperCase() === "TYPE-0") return "Type-0";

  // Handle "World of Final Fantasy" -> "WOFF"
  if (category.toLowerCase() === "world of final fantasy") return "WOFF";

  // For any other category, ensure it's not all-caps unless it's an acronym
  if (category === category.toUpperCase() && category.length > 1) {
    // Check if it's a known acronym (like DFF, FF, etc.)
    const knownAcronyms = ["DFF", "FF", "WOFF", "FFCC", "FFTA", "FFBE"];
    if (knownAcronyms.includes(category)) {
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

// Test cases
const testCases = [
  // Specific categories with different formats
  "THEATRHYTHM",
  "theatrhythm",
  "Theatrhythm",
  "MOBIUS",
  "mobius",
  "Mobius",
  "PICTLOGICA",
  "pictlogica",
  "Pictlogica",
  "TYPE-0",
  "type-0",
  "Type-0",

  // World of Final Fantasy variations
  "World of Final Fantasy",
  "WORLD OF FINAL FANTASY",
  "world of final fantasy",

  // Known acronyms
  "DFF",
  "FF",
  "WOFF",
  "FFCC",

  // Other all-caps categories that should be converted
  "ADVENT CHILDREN",
  "CRYSTAL CHRONICLES",
  "FINAL FANTASY",

  // Mixed case categories that should be preserved
  "Final Fantasy",
  "Crystal Chronicles",
  "Advent Children",
];

// Run tests
function runTests() {
  logger.info("Testing category normalization...");

  testCases.forEach((testCase) => {
    const normalized = normalizeCategory(testCase);
    logger.info(`Original: "${testCase}" -> Normalized: "${normalized}"`);
  });

  logger.info("Category normalization tests completed.");
}

// Run if executed directly
if (require.main === module) {
  runTests();
}
