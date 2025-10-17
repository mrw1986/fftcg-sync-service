/**
 * Utility for translating Japanese FFTCG elements to English
 */

// Japanese to English element mapping
export const elementMap: Record<string, string> = {
  火: "Fire",
  氷: "Ice",
  風: "Wind",
  土: "Earth",
  雷: "Lightning",
  水: "Water",
  光: "Light",
  闇: "Dark",
};

/**
 * Translates an array of Japanese element strings to English
 * @param elements Array of Japanese element strings
 * @returns Array of English element strings
 */
export function translateElements(elements: string[]): string[] {
  return elements.map((element) => elementMap[element] || element);
}

/**
 * Translates card description text, converting Japanese element symbols to English format
 * and applying other standardization rules
 * @param description Card description string with potential Japanese symbols
 * @returns Processed description with English symbols and formatting
 */
export function translateDescription(description: string | null): string | null {
  if (!description) return null;

  // 1. Convert Square Enix markup to standard format
  let processed = description
    // Convert [[br]] to line breaks
    .replace(/\[\[br\]\]/g, "\n")
    // Convert [[i]] to <em> and [[/]] to </em>
    .replace(/\[\[i\]\]/g, "<em>")
    .replace(/\[\[\/\]\]/g, "</em>");

  // 2. Convert Japanese element symbols to English format using elementMap
  Object.entries(elementMap).forEach(([japanese, english]) => {
    const regex = new RegExp(`《${japanese}》`, "g");
    processed = processed.replace(regex, `{${english.charAt(0)}}`);
  });

  // 3. Convert Japanese numbers in 《》 to English format
  processed = processed.replace(/《(\d+)》/g, "{$1}");

  // 4. Capitalize "ex burst" to "EX BURST"
  processed = processed.replace(/\bex burst\b/gi, "EX BURST");

  // 5. Remove any HTML tags wrapping Dull (but preserve the Dull text)
  processed = processed.replace(/<[^>]+>Dull<\/[^>]+>/g, "Dull");

  // 6. Handle "Dull" text based on position relative to colon
  const parts = processed.split(/\s*:\s*/);
  if (parts.length === 2) {
    let leftSide = parts[0];
    let rightSide = parts[1];

    // Only process left side if it contains more than just "Dull"
    // If left side is just "Dull" (ability cost), preserve it as-is
    if (leftSide.trim() !== "Dull") {
      // Temporarily protect [Dull]
      leftSide = leftSide.replace(/\[Dull\]/g, "###PROTECTED_DULL###");
      // Remove unbracketed Dull only if there are other words
      leftSide = leftSide.replace(/\bDull\b/g, "");
      // Restore [Dull]
      leftSide = leftSide.replace(/###PROTECTED_DULL###/g, "[Dull]");
    }

    // Right side: Remove duplicate "Dull" words and convert bracketed to unbracketed
    rightSide = rightSide.replace(/\bDull\s+Dull\b/g, "Dull");
    rightSide = rightSide.replace(/\[Dull\]/g, "Dull");

    // Combine the parts
    processed = `${leftSide}: ${rightSide}`;
  }

  return processed;
}
