// src/test/testSync.ts

// Force test mode and updates
process.env.NODE_ENV = "test";
process.env.FORCE_UPDATE = "true";

import {syncCards} from "../services/cardSync";

async function testSync() {
  console.log("\n=== Testing Card Sync ===");

  const testGroups = [
    {id: "23783", name: "Hidden Legends"},
    {id: "1939", name: "Opus I"},
    {id: "23568", name: "Hidden Trials"},
  ];

  for (const group of testGroups) {
    console.log(`\nTesting sync for ${group.name} (${group.id})`);

    try {
      const options = {
        groupId: group.id,
        limit: 5,
        dryRun: false, // Changed to false to actually process updates
        showAll: true,
        force: true,
        skipImages: false,
      };

      const result = await syncCards(options);

      console.log("\nSync Results:");
      console.log(`Status: ${result.status}`);
      console.log(`Cards Processed: ${result.cardCount}`);
      console.log(`Groups Updated: ${result.groupsUpdated}`);
      console.log(`Images Processed: ${result.imagesProcessed}`);
      console.log(`Images Updated: ${result.imagesUpdated}`);

      if (result.errors.length > 0) {
        console.log("\nErrors:");
        result.errors.forEach((error) => console.log(`- ${error}`));
      }
    } catch (error) {
      console.error(`Error syncing ${group.name}:`, error);
    }
  }
}

// Execute the test
console.log("Starting Card Sync tests...");
testSync()
  .then(() => console.log("\nAll Card Sync tests completed!"))
  .catch(console.error);
