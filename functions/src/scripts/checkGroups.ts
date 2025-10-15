// src/scripts/checkGroups.ts
import { db, COLLECTION } from "../config/firebase";
import { tcgcsvApi } from "../utils/api";

async function main() {
  try {
    console.log("=== Checking Groups ===\n");

    // Get groups from API
    console.log("1. Groups from TCGCSV API:");
    const apiGroups = await tcgcsvApi.getGroups();
    console.log(`Found ${apiGroups.length} groups from API\n`);

    // Sort by groupId (newest first) and show top 10
    const sortedApiGroups = apiGroups
      .map((g) => ({ ...g, groupId: parseInt(g.groupId) }))
      .sort((a, b) => b.groupId - a.groupId)
      .slice(0, 10);

    console.log("Latest 10 groups from API:");
    sortedApiGroups.forEach((group) => {
      console.log(`  - Group ${group.groupId}`);
    });

    // Get groups from database
    console.log("\n2. Groups from Database:");
    const dbSnapshot = await db.collection(COLLECTION.GROUPS).get();
    console.log(`Found ${dbSnapshot.size} groups in database\n`);

    if (dbSnapshot.size > 0) {
      const dbGroups = dbSnapshot.docs
        .map((doc) => {
          const data = doc.data() as Record<string, unknown>;
          return {
            groupId: parseInt(doc.id),
            name: data.name || "Unknown",
            ...data,
          };
        })
        .sort((a, b) => b.groupId - a.groupId)
        .slice(0, 10);

      console.log("Latest 10 groups from database:");
      dbGroups.forEach((group) => {
        console.log(`  - Group ${group.groupId}: ${group.name}`);
      });
    }

    // Compare
    console.log("\n3. Comparison:");
    const dbGroupIds = new Set(dbSnapshot.docs.map((doc) => parseInt(doc.id)));
    const apiGroupIds = new Set(apiGroups.map((g) => parseInt(g.groupId)));

    const missingInDb = [...apiGroupIds].filter((id) => !dbGroupIds.has(id));
    const extraInDb = [...dbGroupIds].filter((id) => !apiGroupIds.has(id));

    if (missingInDb.length > 0) {
      console.log(`Groups in API but missing from DB: ${missingInDb.join(", ")}`);
    } else {
      console.log("✓ All API groups are present in database");
    }

    if (extraInDb.length > 0) {
      console.log(`Groups in DB but missing from API: ${extraInDb.join(", ")}`);
    } else {
      console.log("✓ No extra groups in database");
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
