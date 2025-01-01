import {ImageMetadata} from "../types";
import {logWarning} from "./logger";

export class ImageValidator {
  static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  static readonly ALLOWED_FORMATS = ["jpeg", "jpg"] as const;
  static readonly REQUIRED_METADATA = [
    "contentType",
    "size",
    "updated",
    "hash",
  ] as const;

  static validateSize(size: number): boolean {
    if (size <= 0) {
      logWarning("Invalid file size", {size});
      return false;
    }

    if (size > ImageValidator.MAX_FILE_SIZE) {
      logWarning("File too large", {
        size,
        maxSize: ImageValidator.MAX_FILE_SIZE,
      });
      return false;
    }

    return true;
  }

  static validateFormat(format: string): boolean {
    const normalizedFormat = format.toLowerCase();
    if (!ImageValidator.ALLOWED_FORMATS.includes(normalizedFormat as any)) {
      logWarning("Invalid format", {
        format,
        allowedFormats: ImageValidator.ALLOWED_FORMATS,
      });
      return false;
    }
    return true;
  }

  static validateMetadata(metadata: Partial<ImageMetadata>): boolean {
    const missingFields = ImageValidator.REQUIRED_METADATA.filter(
      (field: keyof ImageMetadata) => !metadata[field]
    );

    if (missingFields.length > 0) {
      logWarning("Missing required metadata fields", {missingFields});
      return false;
    }

    return true;
  }
}
