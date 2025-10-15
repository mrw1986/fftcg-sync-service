import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

/**
 * Security Migration Script
 *
 * This script performs the security migration for the FFTCG Companion app:
 * 1. Creates the admins collection for role-based access control
 * 2. Adds collectionCount field to user documents
 *
 * Run this script with:
 * npx ts-node src/scripts/security-migration.ts
 */

// Initialize Firebase Admin if not already initialized
try {
  admin.initializeApp();
} catch (error) {
  // App might already be initialized
}

const db = admin.firestore();

/**
 * Main migration function
 */
async function runSecurityMigration() {
  try {
    logger.info("Starting security migration...");

    // Set up admins collection
    await setupAdminsCollection();

    // Update user documents with collectionCount field
    await updateUserDocuments();

    logger.info("Security migration completed successfully");
  } catch (error) {
    logger.error("Error running security migration:", error);
    throw error;
  }
}

/**
 * Set up the admins collection with authorized users
 */
async function setupAdminsCollection() {
  try {
    logger.info("Setting up admins collection...");

    // List of authorized admin emails
    const adminEmails = ["mrw1986@gmail.com", "preliatorzero@gmail.com", "fftcgcompanion@gmail.com"];

    // Get user documents for these emails
    for (const email of adminEmails) {
      // Find user with this email
      const userQuery = await db.collection("users").where("email", "==", email).limit(1).get();

      if (!userQuery.empty) {
        const userId = userQuery.docs[0].id;

        // Check if admin document already exists
        const adminDoc = await db.collection("admins").doc(userId).get();

        if (!adminDoc.exists) {
          // Create admin document
          await db.collection("admins").doc(userId).set({
            email: email,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            role: "admin",
          });
          logger.info(`Added admin role for user: ${email}`);
        } else {
          logger.info(`Admin role already exists for user: ${email}`);
        }
      } else {
        logger.warn(`Could not find user with email: ${email}`);
      }
    }

    logger.info("Admins collection setup completed");
  } catch (error) {
    logger.error("Error setting up admins collection:", error);
    throw error;
  }
}

/**
 * Update user documents with collectionCount field
 */
async function updateUserDocuments() {
  try {
    logger.info("Updating user documents with collectionCount field...");

    // Get all user documents
    const userDocs = await db.collection("users").get();

    for (const userDoc of userDocs.docs) {
      const userId = userDoc.id;

      // Check if collectionCount field already exists
      if (!Object.prototype.hasOwnProperty.call(userDoc.data(), "collectionCount")) {
        // Count user's collection items
        const collectionQuery = await db.collection("collections").where("userId", "==", userId).get();

        const collectionCount = collectionQuery.size;

        // Update user document with collectionCount
        await db.collection("users").doc(userId).update({
          collectionCount: collectionCount,
        });

        logger.info(`Updated user ${userId} with collectionCount: ${collectionCount}`);
      } else {
        logger.info(`User ${userId} already has collectionCount field`);
      }
    }

    logger.info("User documents update completed");
  } catch (error) {
    logger.error("Error updating user documents:", error);
    throw error;
  }
}

// Run the migration if this script is executed directly
if (require.main === module) {
  runSecurityMigration()
    .then(() => {
      logger.info("Migration script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("Migration script failed:", error);
      process.exit(1);
    });
}

// Export the function for use in other scripts
export { runSecurityMigration };
