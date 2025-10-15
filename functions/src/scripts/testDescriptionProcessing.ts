// Test script to verify description processing fixes

class DescriptionProcessor {
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

  public test() {
    const testCases = [
      {
        name: "Original issue - Dull should be preserved",
        input:
          "The \\u003Cem\\u003ECategory X\\u003C/em\\u003E Forwards you control gain " +
          "\\u003Cstrong\\u003EBrave\\u003C/strong\\u003E.\\r\\n\\u003Cbr\\u003EDull: " +
          "Choose 1 blocking Forward. It gains +1000 power until the end of the turn.",
        expected:
          "The \\u003Cem\\u003ECategory X\\u003C/em\\u003E Forwards you control gain " +
          "\\u003Cstrong\\u003EBrave\\u003C/strong\\u003E.\\r\\n\\u003Cbr\\u003EDull: " +
          "Choose 1 blocking Forward. It gains +1000 power until the end of the turn.",
      },
      {
        name: "Simple Dull ability cost",
        input: "Dull: Choose 1 Forward.",
        expected: "Dull: Choose 1 Forward.",
      },
      {
        name: "Bracketed Dull in left side",
        input: "[Dull] Summon: Choose 1 Forward.",
        expected: "[Dull] Summon: Choose 1 Forward.",
      },
      {
        name: "Mixed Dull processing",
        input: "[Dull] Other Dull: Choose 1 Forward.",
        expected: "[Dull] Other : Choose 1 Forward.",
      },
      {
        name: "Duplicate Dull removal",
        input: "Ability: Choose 1 Dull Dull Forward.",
        expected: "Ability: Choose 1 Dull Forward.",
      },
      {
        name: "EX BURST capitalization",
        input: "ex burst: This is an ex burst ability.",
        expected: "EX BURST: This is an EX BURST ability.",
      },
      {
        name: "HTML wrapped Dull",
        input: "<strong>Dull</strong>: Choose 1 Forward.",
        expected: "Dull: Choose 1 Forward.",
      },
    ];

    console.log("\n=== Description Processing Test Results ===\n");

    testCases.forEach((testCase, index) => {
      const result = this.processDescription(testCase.input);
      const passed = result === testCase.expected;

      console.log(`Test ${index + 1}: ${testCase.name}`);
      console.log(`Input:    ${testCase.input}`);
      console.log(`Expected: ${testCase.expected}`);
      console.log(`Result:   ${result}`);
      console.log(`Status:   ${passed ? "✅ PASSED" : "❌ FAILED"}`);
      console.log("---");
    });

    console.log("\n=== Test Completed ===\n");
  }
}

// Run the test
const processor = new DescriptionProcessor();
processor.test();
