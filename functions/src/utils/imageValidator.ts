// src/utils/imageValidator.ts
import sharp from "sharp";
import {logInfo, logWarning} from "./logger";

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  metadata?: sharp.Metadata;
}

export class ImageValidator {
  private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
  private static readonly ALLOWED_FORMATS = ["jpeg", "jpg"];
  private static readonly REQUIRED_METADATA = [
    "format",
    "width",
    "height",
    "size",
  ];

  static async validateImage(buffer: Buffer): Promise<ValidationResult> {
    try {
      // Check file size
      if (buffer.length > this.MAX_FILE_SIZE) {
        return {
          isValid: false,
          error: `Image exceeds maximum size of ${
            this.MAX_FILE_SIZE / 1024 / 1024
          }MB`,
        };
      }

      // Get image metadata using sharp
      const metadata = await sharp(buffer).metadata();

      // Validate format
      if (!metadata.format || !this.ALLOWED_FORMATS.includes(metadata.format)) {
        return {
          isValid: false,
          error: `Invalid image format: ${
            metadata.format
          }. Allowed formats: ${this.ALLOWED_FORMATS.join(", ")}`,
        };
      }

      // Validate required metadata
      const missingMetadata = this.REQUIRED_METADATA.filter(
        (field) => !(field in metadata)
      );
      if (missingMetadata.length > 0) {
        return {
          isValid: false,
          error: `Missing required metadata: ${missingMetadata.join(", ")}`,
        };
      }

      await logInfo("Image validation successful", {
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        size: buffer.length,
      });

      return {
        isValid: true,
        metadata,
      };
    } catch (error) {
      await logWarning("Image validation failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return {
        isValid: false,
        error:
          error instanceof Error ? error.message : "Unknown validation error",
      };
    }
  }
}
