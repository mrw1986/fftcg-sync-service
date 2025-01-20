// src/config/environment.ts
interface Environment {
  isLocal: boolean;
  nodeEnv: string;
}

export const environment: Environment = {
  isLocal: process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test",
  nodeEnv: process.env.NODE_ENV || "development",
};
