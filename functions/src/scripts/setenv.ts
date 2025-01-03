// scripts/setenv.ts
import * as dotenv from "dotenv";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function setFirebaseConfig() {
  try {
    dotenv.config();

    const config = {
      account_id: process.env.R2_ACCOUNT_ID,
      access_key_id: process.env.R2_ACCESS_KEY_ID,
      secret_access_key: process.env.R2_SECRET_ACCESS_KEY,
      bucket_name: process.env.R2_BUCKET_NAME,
      storage_path: process.env.R2_STORAGE_PATH,
      custom_domain: process.env.R2_CUSTOM_DOMAIN,
    };

    // Remove existing config
    await execAsync("firebase functions:config:unset r2");

    // Set new config
    const configString = Object.entries(config)
      .map(([key, value]) => `r2.${key}="${value}"`)
      .join(" ");

    await execAsync(`firebase functions:config:set ${configString}`);
    console.log("Firebase config updated successfully");
  } catch (error) {
    console.error("Error setting Firebase config:", error);
  }
}

setFirebaseConfig();
