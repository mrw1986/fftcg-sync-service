// Find cards with "Dull" in their descriptions to test the fix
import { db, COLLECTION } from "../config/firebase";

async function findCardsWithDull() {
  try {
    console.log("Searching for cards with 'Dull' in their descriptions...");

    // Query cards that contain "Dull" in their description
    const snapshot = await db
      .collection(COLLECTION.CARDS)
      .where("description", ">=", "Dull")
      .where("description", "<=", "Dull\uf8ff")
      .limit(10)
      .get();

    if (snapshot.empty) {
      console.log("No cards found with 'Dull' in description using direct query.");

      // Try a broader approach - get some cards and filter manually
      console.log("Trying broader search...");
      const allCardsSnapshot = await db.collection(COLLECTION.CARDS).where("description", "!=", null).limit(100).get();

      const cardsWithDull = allCardsSnapshot.docs.filter((doc) => {
        const data = doc.data();
        return data.description && data.description.toLowerCase().includes("dull");
      });

      if (cardsWithDull.length === 0) {
        console.log("No cards found with 'Dull' in description.");
        return;
      }

      console.log(`Found ${cardsWithDull.length} cards with 'Dull' in description:`);
      cardsWithDull.slice(0, 5).forEach((doc) => {
        const data = doc.data();
        console.log(`\nCard ID: ${doc.id}`);
        console.log(`Name: ${data.name}`);
        console.log(`Description: ${data.description}`);
        console.log("---");
      });
    } else {
      console.log(`Found ${snapshot.size} cards with 'Dull' in description:`);
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        console.log(`\nCard ID: ${doc.id}`);
        console.log(`Name: ${data.name}`);
        console.log(`Description: ${data.description}`);
        console.log("---");
      });
    }
  } catch (error) {
    console.error("Error searching for cards:", error);
  } finally {
    await db.terminate();
    process.exit(0);
  }
}

findCardsWithDull();
