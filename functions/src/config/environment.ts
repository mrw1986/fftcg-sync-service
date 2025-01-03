// src/config/environment.ts
import * as functions from "firebase-functions";
import * as dotenv from "dotenv";

// Load .env file in development
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

// Helper function to get config value
function getConfigValue(key: string): string {
  // In production, use Firebase config
  if (process.env.NODE_ENV === "production") {
    const config = functions.config();
    return config.r2?.[key.toLowerCase().replace("r2_", "")] || "";
  }

  // In development, use .env file
  return process.env[key] || "";
}

export const environment = {
  nodeEnv: process.env.NODE_ENV || "development",
  isLocal: process.env.NODE_ENV !== "production",
  r2: {
    accountId: getConfigValue("R2_ACCOUNT_ID"),
    accessKeyId: getConfigValue("R2_ACCESS_KEY_ID"),
    secretAccessKey: getConfigValue("R2_SECRET_ACCESS_KEY"),
    bucketName: getConfigValue("R2_BUCKET_NAME"),
    storagePath: getConfigValue("R2_STORAGE_PATH"),
    customDomain: getConfigValue("R2_CUSTOM_DOMAIN"),
  },
};

// Skip validation in production since we're using Firebase config
if (process.env.NODE_ENV !== "production") {
  const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}
