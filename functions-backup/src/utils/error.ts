import {db, COLLECTION} from "../config/firebase";
import {logError} from "./logger";

export interface ErrorReport {
  timestamp: Date;
  context: string;
  error: string;
  stackTrace?: string;
  metadata?: Record<string, unknown>;
  severity: "ERROR" | "WARNING" | "CRITICAL";
}

export class DetailedError extends Error {
  constructor(
    message: string,
    public context: string,
    public metadata?: Record<string, unknown>,
    public severity: "ERROR" | "WARNING" | "CRITICAL" = "ERROR"
  ) {
    super(message);
    this.name = "DetailedError";
  }
}

export async function logDetailedError(
  error: Error,
  context: string,
  metadata?: Record<string, unknown>,
  severity: "ERROR" | "WARNING" | "CRITICAL" = "ERROR"
): Promise<void> {
  const report: ErrorReport = {
    timestamp: new Date(),
    context,
    error: error.message,
    stackTrace: error.stack,
    metadata,
    severity,
  };

  // Log to Firestore
  await db.collection(COLLECTION.LOGS)
    .add(report);

  // Log using existing logger
  await logError(error, context);
}
