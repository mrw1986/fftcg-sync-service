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

function cleanLogData(
  data: Record<string, unknown>,
  depth = 0
): Record<string, unknown> {
  // Prevent infinite recursion
  if (depth > 10) {
    return {error: "Maximum recursion depth exceeded"};
  }

  // Handle null or undefined
  if (!data) {
    return {};
  }

  try {
    return Object.entries(data).reduce((acc, [key, value]) => {
      // Skip undefined and null values
      if (value === undefined || value === null) {
        return acc;
      }

      // Handle different types of values
      if (value instanceof Date) {
        acc[key] = value.toISOString();
      } else if (typeof value === "function") {
        // Skip functions
        return acc;
      } else if (Array.isArray(value)) {
        // Handle arrays
        acc[key] = value.map((item) =>
          typeof item === "object" && item !== null ?
            cleanLogData(item as Record<string, unknown>, depth + 1) :
            item
        );
      } else if (typeof value === "object") {
        // Handle objects
        try {
          // Check if object can be safely converted to string
          JSON.stringify(value);
          acc[key] = cleanLogData(value as Record<string, unknown>, depth + 1);
        } catch (e) {
          // If circular reference is detected, return a simplified version
          acc[key] = "[Circular]";
        }
      } else {
        // Handle primitive values
        acc[key] = value;
      }

      return acc;
    }, {} as Record<string, unknown>);
  } catch (error) {
    // If any error occurs during cleaning, return a simplified object
    return {
      error: "Error cleaning log data",
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function saveLogEntry(entry: LogEntry): Promise<void> {
  try {
    const cleanEntry = {
      timestamp: entry.timestamp,
      level: entry.level,
      message: entry.message,
      ...(entry.context && {context: entry.context}),
      ...(entry.data && {data: cleanLogData(entry.data)}),
    };

    await db.collection(COLLECTION.LOGS).add(cleanEntry);
  } catch (error) {
    console.error("Error saving log entry:", error);
  }
}

export const logError = async (
  error: GenericError | GenericObject,
  context: string
) => {
  try {
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
  } catch (e) {
    console.error("Error in logError:", e);
  }
};

export const logInfo = async (message: string, data?: LogData) => {
  try {
    const cleanedData = data ?
      cleanLogData({
        ...data,
        timestamp: new Date().toISOString(),
      }) :
      undefined;

    const entry: LogEntry = {
      timestamp: new Date(),
      level: "INFO",
      message,
      ...(cleanedData &&
        Object.keys(cleanedData).length > 0 && {data: cleanedData}),
    };

    logger.info(message, cleanedData);
    await saveLogEntry(entry);
  } catch (e) {
    console.error("Error in logInfo:", e);
  }
};

export const logWarning = async (message: string, data?: LogData) => {
  try {
    const cleanedData = data ?
      cleanLogData({
        ...data,
        timestamp: new Date().toISOString(),
      }) :
      undefined;

    const entry: LogEntry = {
      timestamp: new Date(),
      level: "WARNING",
      message,
      ...(cleanedData &&
        Object.keys(cleanedData).length > 0 && {data: cleanedData}),
    };

    logger.warn(message, cleanedData);
    await saveLogEntry(entry);
  } catch (e) {
    console.error("Error in logWarning:", e);
  }
};
