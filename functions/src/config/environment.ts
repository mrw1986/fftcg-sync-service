// src/config/environment.ts
interface Environment {
  isLocal: boolean;
  nodeEnv: string;
  enableFirestoreLogs: boolean;
}

// Default to development if NODE_ENV is not set
const nodeEnv = process.env.NODE_ENV || "development";

// Enable Firestore logs for production and when explicitly set
const enableFirestoreLogs = process.env.ENABLE_FIRESTORE_LOGS === "true" || nodeEnv === "production";

export const environment: Environment = {
  isLocal: nodeEnv === "development" || nodeEnv === "test",
  nodeEnv,
  enableFirestoreLogs,
};
