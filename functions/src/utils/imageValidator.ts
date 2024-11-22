import {ImageValidationError} from "../types";

export class ImageValidator {
  private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

  static async validateImage(buffer: Buffer): Promise<ImageValidationError | null> {
    try {
      // Check file size
      if (buffer.length > this.MAX_FILE_SIZE) {
        return {
          code: "FILE_TOO_LARGE",
          message: `Image exceeds maximum size of ${this.MAX_FILE_SIZE / 1024 / 1024}MB`,
        };
      }

      // Check file signature (magic numbers for JPEG)
      if (!this.isJpeg(buffer)) {
        return {
          code: "INVALID_FORMAT",
          message: "Image must be in JPEG format",
        };
      }

      return null;
    } catch (error) {
      return {
        code: "VALIDATION_ERROR",
        message: error instanceof Error ? error.message : "Unknown validation error",
      };
    }
  }

  private static isJpeg(buffer: Buffer): boolean {
    return (
      buffer[0] === 0xFF &&
      buffer[1] === 0xD8 &&
      buffer[buffer.length - 2] === 0xFF &&
      buffer[buffer.length - 1] === 0xD9
    );
  }
}
