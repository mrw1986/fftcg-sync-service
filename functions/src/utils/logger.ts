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
    if (value !== undefined) {
      if (value && typeof value === "object") {
        acc[key] = cleanLogData(value as Record<string, unknown>);
      } else {
        acc[key] = value;
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
  const cleanedData = data ? cleanLogData(data as Record<string, unknown>) : undefined;

  const entry: LogEntry = {
    timestamp: new Date(),
    level: "INFO",
    message,
    ...(cleanedData && {data: cleanedData}),
  };

  logger.info(message, cleanedData);
  await saveLogEntry(entry);
};

export const logWarning = async (message: string, data?: LogData) => {
  const cleanedData = data ? cleanLogData(data as Record<string, unknown>) : undefined;

  const entry: LogEntry = {
    timestamp: new Date(),
    level: "WARNING",
    message,
    ...(cleanedData && {data: cleanedData}),
  };

  logger.warn(message, cleanedData);
  await saveLogEntry(entry);
};
