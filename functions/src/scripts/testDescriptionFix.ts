// Test the description processing fix on real card data
import { db, COLLECTION } from "../config/firebase";

class DescriptionTester {
  private processDescription(description: string | null): string | null {
    if (!description) return null;

    // 1. Capitalize "ex burst" to "EX BURST"
    let processed = description.replace(/\bex burst\b/gi, "EX BURST");

    // 2. Remove any HTML tags wrapping Dull (but preserve the Dull text)
    processed = processed.replace(/<[^>]+>Dull<\/[^>]+>/g, "Dull");

    // 3. Handle "Dull" text based on position relative to colon
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

  async testCard(cardId: string) {
    try {
      console.log(`\n=== Testing Description Processing for Card ${cardId} ===\n`);

      const cardDoc = await db.collection(COLLECTION.CARDS).doc(cardId).get();

      if (!cardDoc.exists) {
        console.log(`Card ${cardId} not found.`);
        return;
      }

      const cardData = cardDoc.data();
      const originalDescription = cardData?.description;

      if (!originalDescription) {
        console.log(`Card ${cardId} has no description.`);
        return;
      }

      console.log(`Card Name: ${cardData?.name}`);
      console.log("Original Description:");
      console.log(originalDescription);
      console.log("\n--- Processing ---\n");

      const processedDescription = this.processDescription(originalDescription);

      console.log("Processed Description:");
      console.log(processedDescription);

      const changed = originalDescription !== processedDescription;
      console.log(`\nDescription Changed: ${changed ? "YES" : "NO"}`);

      if (changed) {
        console.log("\n--- Changes ---");
        console.log(`Before: ${originalDescription}`);
        console.log(`After:  ${processedDescription}`);
      }

      // Check if "Dull" at start of ability is preserved
      const hasDullAbility = /^Dull\s+/.test(originalDescription);
      const dullPreserved = processedDescription?.startsWith("Dull ") || false;

      if (hasDullAbility) {
        console.log("\n--- Dull Preservation Test ---");
        console.log(`Original has Dull ability: ${hasDullAbility}`);
        console.log(`Processed preserves Dull: ${dullPreserved}`);
        console.log(`Result: ${dullPreserved ? "✅ PASS" : "❌ FAIL"}`);
      }
    } catch (error) {
      console.error(`Error testing card ${cardId}:`, error);
    }
  }
}

async function main() {
  const tester = new DescriptionTester();

  // Test several cards with different "Dull" variations
  const testCards = [
    { id: "226789", pattern: "Dull # active" }, // Lunafreya - "Dull 1 active Category XV Forward"
    { id: "624827", pattern: "Dull, discard" }, // Wererat - "Dull, discard 1 Earth card"
    { id: "624760", pattern: "Dull, discard" }, // Armstrong - "Dull, discard 1 Fire card"
    { id: "624782", pattern: "Dull, discard" }, // Gimme Cat - "Dull, discard 1 Ice card"
    { id: "268683", pattern: "Dull # active" }, // Andrea Rhodea - "Dull 2 active Category VI Characters"
    { id: "456020", pattern: "Dull active [name]" }, // Vanille - "Dull active Vanille"
    { id: "256094", pattern: "Multiple Dull variants" }, // Lilisette - Multiple Dull patterns
    { id: "624854", pattern: "Dull in middle + S Dull" }, // Seven - Has "S Dull:" pattern
    { id: "170128", pattern: "Dull # active + abilities" }, // Ultimecia - "Dull 3 active Forwards"
  ];

  console.log("=== Comprehensive Dull Description Testing ===\n");
  console.log("Testing various patterns of 'Dull' in card descriptions to ensure they're preserved correctly.\n");

  for (const testCard of testCards) {
    console.log(`Testing Pattern: ${testCard.pattern}`);
    await tester.testCard(testCard.id);
    console.log("\n" + "=".repeat(80) + "\n");
  }

  await db.terminate();
  process.exit(0);
}

main().catch(console.error);
