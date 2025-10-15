// src/scripts/checkNewGroupCards.ts
import { db, COLLECTION } from "../config/firebase";

async function main() {
  try {
    console.log("=== Checking Cards for New Groups ===\n");

    // Check the two newest groups
    const newGroupIds = [24321, 24317];

    for (const groupId of newGroupIds) {
      // Get group info
      const groupDoc = await db.collection(COLLECTION.GROUPS).doc(groupId.toString()).get();
      if (groupDoc.exists) {
        const groupData = groupDoc.data();
        console.log(`Group ${groupId}: ${groupData?.name}`);

        // Check cards for this group
        const cardsSnapshot = await db.collection(COLLECTION.CARDS)
          .where("groupId", "==", groupId.toString())
          .get();

        console.log(`  Cards in database: ${cardsSnapshot.size}`);

        if (cardsSnapshot.size > 0) {
          console.log(`  ✓ Cards are synced for ${groupData?.name}`);
        } else {
          console.log(`  ⚠️  No cards found for ${groupData?.name} - cards may need syncing`);
        }
        console.log("");
      }
    }

    await db.terminate();
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    await db.terminate();
    process.exit(1);
  }
}

main().catch(console.error);
