// Test processing of card 24-005L description
import { db, COLLECTION } from "../config/firebase";
import { translateDescription } from "../utils/elementTranslator";

async function testCard24005LProcessing() {
  try {
    console.log("=== TESTING CARD 24-005L DESCRIPTION PROCESSING ===");

    // Get the Square Enix card
    const seCard = await db.collection(COLLECTION.SQUARE_ENIX_CARDS).doc("24-005L_HiddenLegends").get();

    if (!seCard.exists) {
      console.log("Square Enix card not found!");
      return;
    }

    const seData = seCard.data();
    if (!seData) {
      console.log("No data found in Square Enix card!");
      return;
    }
    console.log("Original Square Enix text:");
    console.log(seData.text);
    console.log(`Length: ${seData.text?.length || 0}`);

    // Test translation
    console.log("\nTesting translateDescription...");
    const processed = translateDescription(seData.text);
    console.log("Processed description:");
    console.log(processed);
    console.log(`Length: ${processed?.length || 0}`);

    // Test if processing is truncating
    if (processed && seData.text) {
      const originalLength = seData.text.length;
      const processedLength = processed.length;
      const ratio = processedLength / originalLength;

      console.log("\nLength comparison:");
      console.log(`Original: ${originalLength}`);
      console.log(`Processed: ${processedLength}`);
      console.log(`Ratio: ${ratio.toFixed(2)}`);

      if (ratio < 0.8) {
        console.log("⚠️  WARNING: Significant truncation detected!");
      } else {
        console.log("✅ Processing preserved most content");
      }
    }

    // Test fallback logic
    console.log("\nTesting fallback logic...");
    const hasSquareEnixDescription = seData.text && seData.text.trim() !== "";
    console.log("Has Square Enix description:", hasSquareEnixDescription);

    if (hasSquareEnixDescription) {
      const finalDescription = processed && processed.trim() !== "" ? processed : seData.text;
      console.log("Final description to use:");
      console.log(finalDescription);
      console.log(`Final length: ${finalDescription?.length || 0}`);
    }
  } catch (error) {
    console.error("Test error:", error);
  } finally {
    process.exit(0);
  }
}

testCard24005LProcessing();
