// src/services/filterAggregationService.ts
import { db, COLLECTION } from "../config/firebase";
import { logger } from "../utils/logger";
import { RetryWithBackoff } from "../utils/retry";
import { RateLimiter } from "../utils/rateLimiter";
import * as crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { OptimizedBatchProcessor } from "./batchProcessor";

interface FilterDocument {
  fieldName: string;
  values: (string | number)[];
  hash: string;
  lastUpdated: FirebaseFirestore.FieldValue;
}

interface FilterResult {
  success: boolean;
  itemsProcessed: number;
  itemsUpdated: number;
  errors: string[];
  timing: {
    startTime: Date;
    endTime?: Date;
    duration?: number;
  };
}

interface GroupInfo {
  name: string;
  publishedOn: FirebaseFirestore.Timestamp;
}

export class FilterAggregationService {
  private readonly retry = new RetryWithBackoff();
  private readonly batchProcessor: OptimizedBatchProcessor;
  private readonly rateLimiter = new RateLimiter(500, 1000, 5); // Match main sync settings

  // Fields to aggregate
  private readonly fields = ["cardType", "category", "cost", "elements", "power", "rarity", "set"];

  constructor() {
    this.batchProcessor = new OptimizedBatchProcessor(db);
  }

  private normalizeCategory(category: string): string {
    // Handle specific categories that need consistent formatting
    if (category.toUpperCase() === "THEATRHYTHM") return "Theatrhythm";
    if (category.toUpperCase() === "MOBIUS") return "Mobius";
    if (category.toUpperCase() === "PICTLOGICA") return "Pictlogica";
    if (category.toUpperCase() === "TYPE-0") return "Type-0";

    // Handle specific category conversions to acronyms
    if (category.toLowerCase() === "world of final fantasy") return "WOFF";
    if (category.toLowerCase() === "lord of vermilion") return "LOV";

    // Check if it's a Roman numeral (I, II, III, IV, V, VI, VII, VIII, IX, X, XI, XII, XIII, XIV, XV, XVI)
    const romanNumeralPattern = /^(X{0,3})(IX|IV|V?I{0,3})$/i;
    if (romanNumeralPattern.test(category)) {
      return category.toUpperCase(); // Keep Roman numerals uppercase
    }

    // For any other category, ensure it's not all-caps unless it's an acronym
    if (category === category.toUpperCase() && category.length > 1) {
      // Check if it's a known acronym or starts with FF (Final Fantasy)
      const knownAcronyms = [
        "DFF",
        "FF",
        "WOFF",
        "FFCC",
        "FFTA",
        "FFBE",
        "FFEX",
        "FFL",
        "FFRK",
        "FFT",
        "FFTA2",
        "MQ",
        "LOV",
        "SOPFFO",
      ];

      if (knownAcronyms.includes(category) || category.startsWith("FF")) {
        return category; // Keep known acronyms as-is
      }

      // Otherwise, convert to title case (first letter of each word capitalized)
      return category
        .toLowerCase()
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    }

    return category;
  }

  private calculateHash(values: (string | number)[]): string {
    return crypto.createHash("md5").update(JSON.stringify(values)).digest("hex");
  }

  private async getStoredHash(fieldName: string): Promise<string | null> {
    const filterRef = db.collection(COLLECTION.FILTERS).doc(fieldName);
    const filterDoc = await this.retry.execute(() => filterRef.get());
    return filterDoc.exists ? filterDoc.data()?.hash : null;
  }

  private isSupplementalSet(name: string): boolean {
    return name.includes("Deck") || name.includes("Collection") || name.includes("Promo");
  }

  private async getSortedSetValues(values: string[]): Promise<string[]> {
    // Get all groups
    const groupsSnapshot = await this.retry.execute(() => db.collection(COLLECTION.GROUPS).get());
    const groupMap = new Map<string, GroupInfo>();

    groupsSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (data.name && data.publishedOn) {
        groupMap.set(data.name, {
          name: data.name,
          publishedOn: data.publishedOn,
        });
      }
    });

    // Split values into core and supplemental sets
    const coreSets: { name: string; publishedOn: FirebaseFirestore.Timestamp }[] = [];
    const supplementalSets: { name: string; publishedOn: FirebaseFirestore.Timestamp }[] = [];

    values.forEach((value) => {
      const groupInfo = groupMap.get(value);
      if (groupInfo) {
        if (this.isSupplementalSet(value)) {
          supplementalSets.push(groupInfo);
        } else {
          coreSets.push(groupInfo);
        }
      }
    });

    // Sort both arrays by publishedOn
    coreSets.sort((a, b) => a.publishedOn.seconds - b.publishedOn.seconds);
    supplementalSets.sort((a, b) => a.publishedOn.seconds - b.publishedOn.seconds);

    // Combine the arrays, core sets first
    return [...coreSets, ...supplementalSets].map((group) => group.name);
  }

  private async extractUniqueValues(fieldName: string): Promise<(string | number)[]> {
    const snapshot = await this.retry.execute(() => db.collection(COLLECTION.CARDS).select(fieldName).get());

    const values = new Set<string | number>();

    snapshot.docs.forEach((doc) => {
      const value = doc.get(fieldName);
      if (value === null || value === undefined) return;

      if (fieldName === "category") {
        // Special handling for category field - split on middot and add individual values
        const categoryStr = String(value).replace(/&middot;/g, "\u00B7");
        const categories = categoryStr
          .split(/\u00B7/)
          .map((c) => c.trim())
          .filter(Boolean)
          .map((c) => this.normalizeCategory(c)); // Apply category normalization
        categories.forEach((c) => values.add(c));
      } else if (Array.isArray(value)) {
        // Handle array fields (e.g., elements, set)
        value.forEach((v) => {
          if (v !== null && v !== undefined) {
            values.add(v);
          }
        });
      } else {
        // Handle scalar fields
        values.add(value);
      }
    });

    // Special handling for set field
    if (fieldName === "set") {
      const setValues = Array.from(values).filter((v): v is string => typeof v === "string");
      return await this.getSortedSetValues(setValues);
    }

    // Convert Set to sorted Array for consistent hashing
    return Array.from(values).sort((a, b) => {
      if (typeof a === "number" && typeof b === "number") {
        return a - b;
      }
      return String(a).localeCompare(String(b));
    });
  }

  private async processField(
    fieldName: string,
    options: { forceUpdate?: boolean } = {}
  ): Promise<{
    processed: boolean;
    updated: boolean;
    error?: string;
  }> {
    try {
      // Extract unique values
      const values = await this.extractUniqueValues(fieldName);

      // Calculate hash of values
      const currentHash = this.calculateHash(values);
      const storedHash = await this.getStoredHash(fieldName);

      // Skip if no changes and not forcing update
      if (currentHash === storedHash && !options.forceUpdate) {
        logger.info(`Skipping filter ${fieldName} - no changes detected`);
        return { processed: true, updated: false };
      }

      // Prepare filter document
      const filterDoc: FilterDocument = {
        fieldName,
        values,
        hash: currentHash,
        lastUpdated: FieldValue.serverTimestamp(),
      };

      // Update filter document
      await this.rateLimiter.add(() =>
        this.batchProcessor.addOperation((batch) => {
          const filterRef = db.collection(COLLECTION.FILTERS).doc(fieldName);
          batch.set(filterRef, filterDoc);
        })
      );

      logger.info(`Updated filter ${fieldName} with ${values.length} unique values`);
      return { processed: true, updated: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { processed: true, updated: false, error: errorMessage };
    }
  }

  async updateFilters(options: { forceUpdate?: boolean } = {}): Promise<FilterResult> {
    const result: FilterResult = {
      success: true,
      itemsProcessed: 0,
      itemsUpdated: 0,
      errors: [],
      timing: {
        startTime: new Date(),
      },
    };

    try {
      logger.info("Starting filter aggregation", { options });

      // Process each field
      await Promise.all(
        this.fields.map(async (fieldName) => {
          const fieldResult = await this.processField(fieldName, options);
          if (fieldResult.processed) result.itemsProcessed++;
          if (fieldResult.updated) result.itemsUpdated++;
          if (fieldResult.error) result.errors.push(`Error processing ${fieldName}: ${fieldResult.error}`);
        })
      );

      // Commit all batched operations
      await this.batchProcessor.commitAll();

      // Calculate timing
      result.timing.endTime = new Date();
      result.timing.duration = (result.timing.endTime.getTime() - result.timing.startTime.getTime()) / 1000;

      logger.info(`Filter aggregation completed in ${result.timing.duration}s`, {
        processed: result.itemsProcessed,
        updated: result.itemsUpdated,
        errors: result.errors.length,
      });
    } catch (error) {
      result.success = false;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Filter aggregation failed: ${errorMessage}`);
      logger.error("Filter aggregation failed", { error: errorMessage });
    }

    return result;
  }
}

export const filterAggregation = new FilterAggregationService();
