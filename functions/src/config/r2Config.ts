// src/config/r2Config.ts
import * as dotenv from "dotenv";

// Load .env file
dotenv.config();

interface R2Config {
    ACCOUNT_ID: string;
    ACCESS_KEY_ID: string;
    SECRET_ACCESS_KEY: string;
    BUCKET_NAME: string;
    STORAGE_PATH: string;
    CUSTOM_DOMAIN: string;
}

type R2ConfigKey = keyof R2Config;

const getConfig = (): R2Config => {
  try {
    const configuration: R2Config = {
      ACCOUNT_ID: process.env.R2_ACCOUNT_ID || "",
      ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || "",
      SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || "",
      BUCKET_NAME: process.env.R2_BUCKET_NAME || "",
      STORAGE_PATH: process.env.R2_STORAGE_PATH || "card-images",
      CUSTOM_DOMAIN: process.env.R2_CUSTOM_DOMAIN || "",
    };

    // Debug logging
    console.log("Loading R2 Configuration:", {
      ...configuration,
      ACCESS_KEY_ID: configuration.ACCESS_KEY_ID ? "***" : "not set",
      SECRET_ACCESS_KEY: configuration.SECRET_ACCESS_KEY ? "***" : "not set",
    });

    // Validate required fields
    const requiredFields: R2ConfigKey[] = ["ACCOUNT_ID", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "BUCKET_NAME"];
    for (const field of requiredFields) {
      if (!configuration[field]) {
        throw new Error(`Missing required R2 configuration: ${field}`);
      }
    }

    return configuration;
  } catch (error) {
    console.error("Error loading R2 config:", error);
    throw error;
  }
};

export const R2_CONFIG = getConfig();

// Add this to help with debugging
console.log("R2 Configuration loaded:", {
  ACCOUNT_ID: R2_CONFIG.ACCOUNT_ID,
  BUCKET_NAME: R2_CONFIG.BUCKET_NAME,
  STORAGE_PATH: R2_CONFIG.STORAGE_PATH,
  CUSTOM_DOMAIN: R2_CONFIG.CUSTOM_DOMAIN,
  // Hide sensitive data
  ACCESS_KEY_ID: R2_CONFIG.ACCESS_KEY_ID ? "***" : "not set",
  SECRET_ACCESS_KEY: R2_CONFIG.SECRET_ACCESS_KEY ? "***" : "not set",
});
