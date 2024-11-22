// src/test/testImageHandler.ts

import {ImageHandler} from "../utils/imageHandler";
import {ImageCompressor} from "../utils/imageCompressor";

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
    console.log("\n=== Testing Image Handler ===");
    const imageHandler = new ImageHandler();

    for (const testCase of TEST_CASES) {
      console.log(`\nProcessing: ${testCase.description}`);
      console.log("URLs:");
      console.log(`- Original: ${testCase.imageUrl}`);
      console.log(`- High-res: ${testCase.imageUrl.replace("_200w.jpg", "_400w.jpg")}`);

      // Test compression independently
      console.log("\n=== Compression Test ===");
      const response = await fetch(testCase.imageUrl);
      const buffer = Buffer.from(await response.arrayBuffer());

      const [lowResResult, highResResult] = await Promise.all([
        ImageCompressor.compress(buffer, false),
        ImageCompressor.compress(buffer, true),
      ]);

      console.log("Low-res:");
      console.log(`- Original: ${(buffer.length / 1024).toFixed(2)}KB`);
      console.log(`- Compressed: ${(lowResResult.buffer.length / 1024).toFixed(2)}KB`);
      console.log(`- Reduction: ${((1 - lowResResult.buffer.length / buffer.length) * 100).toFixed(1)}%`);
      console.log(`- Dimensions: ${lowResResult.info.width}x${lowResResult.info.height}`);

      console.log("\nHigh-res:");
      console.log(`- Original: ${(buffer.length / 1024).toFixed(2)}KB`);
      console.log(`- Compressed: ${(highResResult.buffer.length / 1024).toFixed(2)}KB`);
      console.log(`- Reduction: ${((1 - highResResult.buffer.length / buffer.length) * 100).toFixed(1)}%`);
      console.log(`- Dimensions: ${highResResult.info.width}x${highResResult.info.height}`);

      // Test full image processing
      console.log("\n=== Full Processing Test ===");
      const result = await imageHandler.processImage(
        testCase.imageUrl,
        testCase.groupId,
        testCase.productId
      );

      console.log("Processing Results:");
      console.log(`- Status: ${result.updated ? "Updated" : "Unchanged"}`);
      console.log(`- Original Size: ${(result.metadata.originalSize || 0) / 1024}KB`);
      console.log(`- High-res Size: ${(result.metadata.highResSize || 0) / 1024}KB`);
      console.log(`- Content Type: ${result.metadata.contentType}`);
      console.log(`- Last Updated: ${result.metadata.updated.toISOString()}`);

      // Test cache behavior
      console.log("\n=== Cache Test ===");
      const cachedResult = await imageHandler.processImage(
        testCase.imageUrl,
        testCase.groupId,
        testCase.productId
      );

      console.log("Cache Results:");
      console.log(`- Cached: ${!cachedResult.updated}`);
      console.log(`- Original Size: ${(cachedResult.metadata.originalSize || 0) / 1024}KB`);
      console.log(`- High-res Size: ${(cachedResult.metadata.highResSize || 0) / 1024}KB`);
    }

    // Test cleanup
    console.log("\n=== Cleanup Test (Dry Run) ===");
    await imageHandler.cleanup(true);

    // Test error handling
    console.log("\n=== Error Handling Test ===");
    const invalidResult = await imageHandler.processImage(
      "https://invalid-url.com/image.jpg",
      TEST_CASES[0].groupId,
      TEST_CASES[0].productId
    );

    console.log("Error Results:");
    console.log(`- Fallback: ${invalidResult.originalUrl === "https://invalid-url.com/image.jpg"}`);
    console.log(`- Updated: ${invalidResult.updated}`);
    console.log("- Error Handled: true");
  } catch (error) {
    console.error("\nTest failed:", error);
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
