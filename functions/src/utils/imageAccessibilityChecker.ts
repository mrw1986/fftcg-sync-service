// src/utils/imageAccessibilityChecker.ts
import axios from "axios";
import {logInfo, logWarning} from "./logger";

export interface AccessibilityResult {
  isAccessible: boolean;
  statusCode?: number;
  error?: string;
  headers?: Record<string, string>;
}

export class ImageAccessibilityChecker {
  static async checkUrl(url: string): Promise<AccessibilityResult> {
    try {
      const response = await axios.head(url, {
        timeout: 5000,
        validateStatus: () => true, // Don't throw on any status
      });

      const isAccessible = response.status === 200;
      const result: AccessibilityResult = {
        isAccessible,
        statusCode: response.status,
        headers: response.headers as Record<string, string>,
      };

      if (isAccessible) {
        await logInfo("URL accessibility check passed", {
          url,
          status: response.status,
          contentType: response.headers["content-type"],
          contentLength: response.headers["content-length"],
        });
      } else {
        await logWarning("URL accessibility check failed", {
          url,
          status: response.status,
        });
      }

      return result;
    } catch (error) {
      await logWarning("URL accessibility check error", {
        url,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        isAccessible: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
