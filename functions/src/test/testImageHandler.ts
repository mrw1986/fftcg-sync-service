// src/test/testImageHandler.ts
process.env.NODE_ENV = "test";
process.env.FORCE_UPDATE = "true";

import {ImageHandler} from "../utils/imageHandler";

const TEST_CASES = [
  {
    imageUrl: "https://tcgplayer-cdn.tcgplayer.com/product/477236_200w.jpg",
    groupId: "23783",
    productId: 477236,
    cardNumber: "P477236", // Using the new prefix format
    description: "FFVII Boss Deck",
    isNonCard: true,
  },
  {
    imageUrl: "https://tcgplayer-cdn.tcgplayer.com/product/478471_200w.jpg",
    groupId: "23783",
    productId: 478471,
    cardNumber: "23783-001L",
    description: "FFVII Cloud - Legend",
    isNonCard: false,
  },
];

async function testImageProcessing() {
  try {
    console.log("\n=== Testing Image Handler ===");
    const imageHandler = new ImageHandler();

    for (const testCase of TEST_CASES) {
      console.log(`\nProcessing: ${testCase.description}`);

      // Test URL generation
      console.log("\nURL Structure Test:");
      console.log(`Original (TCGPlayer): ${testCase.imageUrl}`);
      console.log(
        `Expected High-res: ${testCase.imageUrl.replace(
          "_200w.jpg",
          "_400w.jpg"
        )}`
      );
      console.log(
        `Expected Low-res: ${testCase.imageUrl.replace(".jpg", "_200w.jpg")}`
      );

      // Test full image processing
      console.log("\n=== Processing Test ===");
      const result = await imageHandler.processAndStoreImage(
        testCase.imageUrl,
        testCase.productId,
        testCase.groupId,
        testCase.cardNumber,
        testCase.isNonCard // Pass the isNonCard flag
      );

      console.log("\nProcessing Results:");
      console.log(`Status: ${result.updated ? "Updated" : "Unchanged"}`);
      console.log("\nURL Structure:");
      console.log(`High-res URL: ${result.highResUrl}`);
      console.log(`Low-res URL: ${result.lowResUrl}`);

      console.log("\nMetadata:");
      console.log(`Content Type: ${result.metadata.contentType}`);
      console.log(
        `Original Size: ${(result.metadata.originalSize || 0) / 1024}KB`
      );
      console.log(
        `High-res Size: ${(result.metadata.highResSize || 0) / 1024}KB`
      );
      console.log(
        `Low-res Size: ${(result.metadata.lowResSize || 0) / 1024}KB`
      );
      console.log(`Last Updated: ${result.metadata.updated.toISOString()}`);

      // Verify URL accessibility
      console.log("\nVerifying URL accessibility:");
      const urlsToTest = [
        {type: "High-res", url: result.highResUrl},
        {type: "Low-res", url: result.lowResUrl},
      ];

      for (const {type, url} of urlsToTest) {
        if (url) {
          try {
            const response = await fetch(url, {method: "HEAD"});
            console.log(
              `${type} URL accessible: ${response.ok} (${response.status})`
            );
            if (response.ok) {
              console.log(
                `Cache-Control: ${response.headers.get("cache-control")}`
              );
            }
          } catch (error) {
            console.error(`${type} URL not accessible:`, error);
          }
        } else {
          console.log(`${type} URL not generated`);
        }
      }

      // Test metadata storage
      console.log("\nVerifying metadata structure:");
      console.log(
        "- No URLs in metadata:",
        !Object.keys(result.metadata).some((key) =>
          key.toLowerCase().includes("url")
        )
      );
      console.log(
        "- Has required fields:",
        result.metadata.contentType &&
          result.metadata.size !== undefined &&
          result.metadata.updated instanceof Date
      );
    }

    // Test cleanup (dry run)
    console.log("\n=== Cleanup Test (Dry Run) ===");
  } catch (error) {
    console.error("\nTest failed:", error);
    process.exit(1);
  }
}

async function runTests() {
  console.log("Starting Image Handler tests...");
  console.log("Testing new URL structure and public access...");

  try {
    await testImageProcessing();
    console.log("\nAll Image Handler tests completed successfully!");
  } catch (error) {
    console.error("\nTests failed:", error);
    process.exit(1);
  }
}

// Execute the tests
runTests().catch(console.error);
