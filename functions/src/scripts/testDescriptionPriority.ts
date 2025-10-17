// Test script to verify that Square Enix descriptions are correctly prioritized
import { translateDescription } from "../utils/elementTranslator";
import { logger } from "../utils/logger";

interface TestSquareEnixCard {
  code: string;
  text_en: string | null;
}

interface TestTcgCard {
  id: string;
  description?: string | null;
}

// Test function that mimics the logic from updateCardsWithSquareEnixData.ts
function testDescriptionPriority(tcgCard: TestTcgCard, seCard: TestSquareEnixCard): string | null {
  // Always prioritize Square Enix description over TCGCSV description
  const processedDescription = translateDescription(seCard.text_en);
  if (processedDescription && processedDescription.trim() !== "") {
    // Square Enix description exists and is not empty - use it as primary source
    return processedDescription;
  } else if (tcgCard.description && (!processedDescription || processedDescription.trim() === "")) {
    // Only fall back to TCGCSV description if Square Enix has no description or empty description
    return tcgCard.description;
  }

  return null;
}

function runTests() {
  logger.info("Starting description prioritization tests");

  const testCases = [
    {
      name: "Square Enix has description, TCG has description - should use Square Enix",
      tcgCard: { id: "1", description: "Old TCG description" },
      seCard: { code: "1-001H", text_en: "New Square Enix description" },
      expected: "New Square Enix description",
    },
    {
      name: "Square Enix has empty description, TCG has description - should use TCG",
      tcgCard: { id: "2", description: "TCG description" },
      seCard: { code: "1-002H", text_en: "" },
      expected: "TCG description",
    },
    {
      name: "Square Enix has null description, TCG has description - should use TCG",
      tcgCard: { id: "3", description: "TCG description" },
      seCard: { code: "1-003H", text_en: null },
      expected: "TCG description",
    },
    {
      name: "Square Enix has description with markup, TCG has plain text - should use Square Enix processed",
      tcgCard: { id: "4", description: "Plain text" },
      seCard: { code: "1-004H", text_en: "[[i]]Italic text[[/]] and [[br]] line break" },
      expected: "<em>Italic text</em> and \n line break",
    },
    {
      name: "Both have empty descriptions - should return null",
      tcgCard: { id: "5", description: "" },
      seCard: { code: "1-005H", text_en: "" },
      expected: null,
    },
    {
      name: "Square Enix has description, TCG has null - should use Square Enix",
      tcgCard: { id: "6", description: null },
      seCard: { code: "1-006H", text_en: "Square Enix only description" },
      expected: "Square Enix only description",
    },
  ];

  let passed = 0;
  let failed = 0;

  testCases.forEach((testCase, index) => {
    logger.info(`Running test ${index + 1}: ${testCase.name}`);

    const result = testDescriptionPriority(testCase.tcgCard, testCase.seCard);
    const success = result === testCase.expected;

    if (success) {
      passed++;
      logger.info(`✅ Test ${index + 1} PASSED`);
    } else {
      failed++;
      logger.error(`❌ Test ${index + 1} FAILED`, {
        expected: testCase.expected,
        actual: result,
      });
    }
  });

  logger.info(`Test results: ${passed} passed, ${failed} failed`);
  return { passed, failed, total: testCases.length };
}

if (require.main === module) {
  runTests();
}

export { runTests, testDescriptionPriority };
