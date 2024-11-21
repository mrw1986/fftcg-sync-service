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

async function saveLogEntry(entry: LogEntry): Promise<void> {
  // Remove undefined values and convert data to a plain object
  const cleanEntry = {
    timestamp: entry.timestamp,
    level: entry.level,
    message: entry.message,
    ...(entry.context && {context: entry.context}),
    ...(entry.data && {data: JSON.parse(JSON.stringify(entry.data))}),
  };

  await db.collection(COLLECTION.LOGS).add(cleanEntry);
}

export const logError = async (error: GenericError | GenericObject, context: string) => {
  const entry: LogEntry = {
    timestamp: new Date(),
    level: "ERROR",
    message: error.message || "Unknown error",
    context,
    data: {
      stack: error.stack || null,
      code: error.code || null,
    },
  };

  logger.error(entry.message, entry.data);
  await saveLogEntry(entry);
};

export const logInfo = async (message: string, data?: LogData) => {
  const entry: LogEntry = {
    timestamp: new Date(),
    level: "INFO",
    message,
    ...(data && {data: JSON.parse(JSON.stringify(data))}),
  };

  logger.info(message, data);
  await saveLogEntry(entry);
};

export const logWarning = async (message: string, data?: LogData) => {
  const entry: LogEntry = {
    timestamp: new Date(),
    level: "WARNING",
    message,
    ...(data && {data: JSON.parse(JSON.stringify(data))}),
  };

  logger.warn(message, data);
  await saveLogEntry(entry);
};
