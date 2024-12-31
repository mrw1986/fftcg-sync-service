// src/config/r2.ts

import * as dotenv from "dotenv";
dotenv.config();

export const R2_CONFIG = {
  ACCOUNT_ID: process.env.R2_ACCOUNT_ID || "",
  ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || "",
  SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || "",
  BUCKET_NAME: process.env.R2_BUCKET_NAME || "",
  STORAGE_PATH: process.env.R2_STORAGE_PATH || "",
  CUSTOM_DOMAIN: process.env.R2_CUSTOM_DOMAIN || "",
} as const;

if (!R2_CONFIG.ACCOUNT_ID) {
  console.warn("Missing R2_ACCOUNT_ID in .env file");
}
if (!R2_CONFIG.ACCESS_KEY_ID) {
  console.warn("Missing R2_ACCESS_KEY_ID in .env file");
}
if (!R2_CONFIG.SECRET_ACCESS_KEY) {
  console.warn("Missing R2_SECRET_ACCESS_KEY in .env file");
}
if (!R2_CONFIG.BUCKET_NAME) {
  console.warn("Missing R2_BUCKET_NAME in .env file");
}
if (!R2_CONFIG.STORAGE_PATH) {
  console.warn("Missing R2_STORAGE_PATH in .env file");
}
if (!R2_CONFIG.CUSTOM_DOMAIN) {
  console.warn("Missing R2_CUSTOM_DOMAIN in .env file");
}

console.log("R2 Config:", R2_CONFIG);
