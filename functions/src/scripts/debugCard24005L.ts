// Debug script for card 24-005L
import { db, COLLECTION } from "../config/firebase";

async function debugCard24005L() {
  try {
    console.log("=== DEBUG CARD 24-005L ===");

    // 1. Find the TCG card
    console.log("\n1. Looking for TCG card with fullCardNumber 24-005L...");
    const tcgCardsQuery = await db.collection(COLLECTION.CARDS).where("fullCardNumber", "==", "24-005L").get();

    console.log(`Found ${tcgCardsQuery.docs.length} TCG cards with fullCardNumber 24-005L`);

    if (tcgCardsQuery.docs.length > 0) {
      const tcgCard = tcgCardsQuery.docs[0];
      const tcgData = tcgCard.data();
      console.log("TCG Card Data:", {
        id: tcgCard.id,
        name: tcgData.name,
        fullCardNumber: tcgData.fullCardNumber,
        cardNumbers: tcgData.cardNumbers,
        primaryCardNumber: tcgData.primaryCardNumber,
        description: tcgData.description,
        descriptionLength: tcgData.description?.length || 0,
        set: tcgData.set,
      });
    }

    // 2. Find Square Enix cards
    console.log("\n2. Looking for Square Enix cards with code 24-005L...");
    const seCardsQuery = await db.collection(COLLECTION.SQUARE_ENIX_CARDS).get();
    const seCards = seCardsQuery.docs.filter((doc) => {
      const data = doc.data();
      const code = data.code || doc.id.split("_")[0].replace(/;/g, "/");
      return code === "24-005L" || code.includes("24-005L");
    });

    console.log(`Found ${seCards.length} Square Enix cards with code containing 24-005L`);

    seCards.forEach((doc, index) => {
      const data = doc.data();
      const code = data.code || doc.id.split("_")[0].replace(/;/g, "/");
      console.log(`Square Enix Card ${index + 1}:`, {
        docId: doc.id,
        code: code,
        name: data.name,
        text: data.text,
        textLength: data.text?.length || 0,
        set: data.set,
      });
    });

    // 3. Test the matching logic
    console.log("\n3. Testing card matching logic...");
    if (tcgCardsQuery.docs.length > 0 && seCards.length > 0) {
      const tcgCard = tcgCardsQuery.docs[0].data();

      seCards.forEach((seDoc, index) => {
        const seCard = seDoc.data();
        const seCode = seCard.code || seDoc.id.split("_")[0].replace(/;/g, "/");

        console.log(`\nTesting match ${index + 1}:`);
        console.log("TCG card numbers:", tcgCard.cardNumbers);
        console.log("SE card code:", seCode);
        console.log("TCG set:", tcgCard.set);
        console.log("SE set:", seCard.set);

        // Test number matching
        const seNumbers = seCode.split("/").map((n: string) =>
          n
            .trim()
            .replace(/[-\s.,;]/g, "")
            .toUpperCase()
        );
        const tcgNumbers = (tcgCard.cardNumbers || []).map((n: string) => n.replace(/[-\s.,;]/g, "").toUpperCase());

        console.log("Normalized SE numbers:", seNumbers);
        console.log("Normalized TCG numbers:", tcgNumbers);

        const numberMatch = tcgNumbers.some((tcgNum: string) => seNumbers.some((seNum: string) => tcgNum === seNum));
        console.log("Number match:", numberMatch);

        // Test set matching
        const setMatch =
          !tcgCard.set ||
          !seCard.set ||
          tcgCard.set.some((tcgSet: string) =>
            seCard.set.some((seSet: string) => tcgSet.trim().toLowerCase() === seSet.trim().toLowerCase())
          );
        console.log("Set match:", setMatch);
        console.log("Overall match:", numberMatch && setMatch);
      });
    }
  } catch (error) {
    console.error("Debug error:", error);
  } finally {
    process.exit(0);
  }
}

debugCard24005L();
