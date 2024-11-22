// src/test/testImageHandler.ts
import {ImageHandler} from "../utils/imageHandler";

const TEST_CASES = [
  {
    imageUrl: "https://tcgplayer-cdn.tcgplayer.com/product/477236_200w.jpg",
    groupId: "23783",
    productId: 477236,
    description: "FFVII Boss Deck",
  },
];

async function testImageProcessing() {
  try {
    console.log("\nTesting Image Handler...");
    const imageHandler = new ImageHandler();

    for (const testCase of TEST_CASES) {
      console.log(`\nTesting image download and processing for ${testCase.description}...`);
      console.log(`Original URL: ${testCase.imageUrl}`);
      console.log(`High-res URL: ${testCase.imageUrl.replace("_200w.jpg", "_400w.jpg")}`);

      const result = await imageHandler.processImage(
        testCase.imageUrl,
        testCase.groupId,
        testCase.productId
      );

      console.log("Image Processing Results:", {
        originalUrl: result.originalUrl,
        highResUrl: result.highResUrl,
        updated: result.updated,
        metadata: {
          size: result.metadata.size,
          originalSize: result.metadata.originalSize,
          highResSize: result.metadata.highResSize,
          contentType: result.metadata.contentType,
          updated: result.metadata.updated,
        },
      });

      // Test cache behavior
      console.log("\nTesting cache behavior...");
      const cachedResult = await imageHandler.processImage(
        testCase.imageUrl,
        testCase.groupId,
        testCase.productId
      );

      console.log("Cache Test Results:", {
        cached: !cachedResult.updated,
        originalUrl: cachedResult.originalUrl,
        highResUrl: cachedResult.highResUrl,
      });
    }

    // Test cleanup
    console.log("\nTesting image cleanup (dry run)...");
    await imageHandler.cleanup(true);

    // Test error handling
    console.log("\nTesting error handling...");
    const invalidResult = await imageHandler.processImage(
      "https://invalid-url.com/image.jpg",
      TEST_CASES[0].groupId,
      TEST_CASES[0].productId
    );

    console.log("Error Handling Results:", {
      fallbackToOriginal: invalidResult.originalUrl === "https://invalid-url.com/image.jpg",
      updated: invalidResult.updated,
    });
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }
}

async function runTests() {
  console.log("Starting Image Handler tests...");

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
