import * as functions from "firebase-functions";
import {db, COLLECTION} from "../config/firebase";
import {GenericError, LogData, GenericObject} from "../types";

export const logger = functions.logger;

interface LogEntry {
  timestamp: Date;
  level: "INFO" | "WARNING" | "ERROR";
  message: string;
  context?: string;
  data?: Record<string, unknown>;
}

function cleanLogData(data: Record<string, unknown>): Record<string, unknown> {
  return Object.entries(data).reduce((acc, [key, value]) => {
    // Skip undefined and null values
    if (value !== undefined && value !== null) {
      if (value && typeof value === "object") {
        const cleaned = cleanLogData(value as Record<string, unknown>);
        // Only add non-empty objects
        if (Object.keys(cleaned).length > 0) {
          acc[key] = cleaned;
        }
      } else {
        // Convert any specialized types to plain values
        acc[key] = value instanceof Date ? value.toISOString() : value;
      }
    }
    return acc;
  }, {} as Record<string, unknown>);
}

async function saveLogEntry(entry: LogEntry): Promise<void> {
  const cleanEntry = {
    timestamp: entry.timestamp,
    level: entry.level,
    message: entry.message,
    ...(entry.context && {context: entry.context}),
    ...(entry.data && {data: cleanLogData(entry.data)}),
  };

  await db.collection(COLLECTION.LOGS).add(cleanEntry);
}

export const logError = async (error: GenericError | GenericObject, context: string) => {
  const errorData = cleanLogData({
    stack: error.stack,
    code: error.code,
    ...(error as GenericObject),
    timestamp: new Date().toISOString(),
  });

  const entry: LogEntry = {
    timestamp: new Date(),
    level: "ERROR",
    message: error.message || "Unknown error",
    context,
    data: errorData,
  };

  logger.error(entry.message, errorData);
  await saveLogEntry(entry);
};

export const logInfo = async (message: string, data?: LogData) => {
  const cleanedData = data ? cleanLogData({
    ...data,
    timestamp: new Date().toISOString(),
  }) : undefined;

  const entry: LogEntry = {
    timestamp: new Date(),
    level: "INFO",
    message,
    ...(cleanedData && Object.keys(cleanedData).length > 0 && {data: cleanedData}),
  };

  logger.info(message, cleanedData);
  await saveLogEntry(entry);
};

export const logWarning = async (message: string, data?: LogData) => {
  const cleanedData = data ? cleanLogData({
    ...data,
    timestamp: new Date().toISOString(),
  }) : undefined;

  const entry: LogEntry = {
    timestamp: new Date(),
    level: "WARNING",
    message,
    ...(cleanedData && Object.keys(cleanedData).length > 0 && {data: cleanedData}),
  };

  logger.warn(message, cleanedData);
  await saveLogEntry(entry);
};
