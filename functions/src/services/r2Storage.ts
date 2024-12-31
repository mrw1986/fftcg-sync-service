import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import {R2_CONFIG} from "../config/r2"; // Import the R2 configuration
import {logInfo, logWarning} from "../utils/logger";
import {ImagePathOptions} from "../utils/imageHandler";

// Define RollbackInfo type
interface RollbackInfo {
  path: string;
  metadata: Record<string, string>;
}

export class R2Storage {
  private client: S3Client;
  private bucket: string;
  private storagePath: string;
  private customDomain: string;
  private rollbackQueue: RollbackInfo[] = []; // Rollback queue

  constructor() {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${R2_CONFIG.ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_CONFIG.ACCESS_KEY_ID,
        secretAccessKey: R2_CONFIG.SECRET_ACCESS_KEY,
      },
    });
    this.bucket = R2_CONFIG.BUCKET_NAME;
    this.storagePath = R2_CONFIG.STORAGE_PATH;
    this.customDomain = R2_CONFIG.CUSTOM_DOMAIN;
  }

  private getFullPath(path: string): string {
    return `${this.storagePath}/${path}`;
  }

  sanitizeCardNumber(cardNumber: string | undefined): string {
    if (!cardNumber) {
      throw new Error("Card number is required");
    }
    return cardNumber.replace(/\//g, "_");
  }

  getStoragePath(options: ImagePathOptions): string {
    let suffix = "_200w"; // default to low res
    if (options.isHighRes) {
      suffix = "_400w";
    }
    const sanitizedCardNumber = this.sanitizeCardNumber(options.cardNumber);
    const fileName = `${options.productId}_${sanitizedCardNumber}${suffix}.jpg`;
    return `${options.groupId}/${fileName}`;
  }

  async uploadImage(
    path: string,
    buffer: Buffer,
    metadata: Record<string, string>
  ): Promise<string> {
    const fullPath = this.getFullPath(path);

    try {
      // Pre-upload validation
      await logInfo("Validating image upload", {
        path: fullPath,
        size: buffer.length,
        metadata,
      });

      if (!buffer || buffer.length === 0) {
        throw new Error("Empty buffer provided for upload");
      }

      // Store current metadata for potential rollback
      const existingMetadata = await this.getImageMetadata(path);
      if (existingMetadata) {
        this.addToRollback(path, existingMetadata); // Add to rollback queue
      }

      // Upload to R2
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: fullPath,
          Body: buffer,
          ContentType: "image/jpeg",
          ContentLength: buffer.length,
          Metadata: metadata,
          CacheControl: "public, max-age=31536000",
        })
      );

      // Verify upload
      const uploadedMetadata = await this.getImageMetadata(path);
      if (!uploadedMetadata) {
        throw new Error("Upload verification failed - metadata not found");
      }

      // Verify metadata matches
      const metadataMatch = await this.compareMetadata(path, metadata);
      if (!metadataMatch) {
        throw new Error("Upload verification failed - metadata mismatch");
      }

      const publicUrl = this.getPublicUrl(fullPath);

      await logInfo("Image upload successful", {
        path: fullPath,
        size: buffer.length,
        url: publicUrl,
        metadata: uploadedMetadata,
      });

      return publicUrl;
    } catch (error) {
      await logWarning("Image upload failed", {
        path: fullPath,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  async getImageMetadata(path: string): Promise<Record<string, string> | null> {
    const fullPath = this.getFullPath(path);
    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: fullPath,
        })
      );

      await logInfo("Retrieved image metadata", {
        path: fullPath,
        metadata: response.Metadata,
        contentLength: response.ContentLength,
        lastModified: response.LastModified,
      });

      return response.Metadata || null;
    } catch (error) {
      if ((error as any).name === "NotFound") {
        await logInfo("Image metadata not found", {path: fullPath});
        return null;
      }
      await logWarning("Failed to retrieve image metadata", {
        path: fullPath,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  async fileExists(path: string): Promise<boolean> {
    const fullPath = this.getFullPath(path);
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: fullPath,
        })
      );

      await logInfo("Image file exists", {path: fullPath});
      return true;
    } catch (error) {
      if ((error as any).name === "NotFound") {
        await logInfo("Image file does not exist", {path: fullPath});
        return false;
      }
      await logWarning("Error checking file existence", {
        path: fullPath,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  async validateUpload(path: string, expectedSize: number): Promise<boolean> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.getFullPath(path),
        })
      );

      const actualSize = response.ContentLength || 0;
      const isValid = actualSize === expectedSize;

      await logInfo("Validating uploaded image", {
        path,
        expectedSize,
        actualSize,
        isValid,
        metadata: response.Metadata,
      });

      return isValid;
    } catch (error) {
      await logWarning("Image validation failed", {
        path,
        expectedSize,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return false;
    }
  }

  async compareMetadata(
    path: string,
    expectedMetadata: Record<string, string>
  ): Promise<boolean> {
    const storedMetadata = await this.getImageMetadata(path);
    if (!storedMetadata) return false;

    const relevantFields = ["hash", "type", "size"]; // Compare only relevant fields
    const matches = relevantFields.every(
      (field) => storedMetadata[field] === expectedMetadata[field]
    );

    await logInfo("Metadata comparison result", {
      path,
      matches,
      stored: storedMetadata,
      expected: expectedMetadata,
    });

    return matches;
  }

  async rollback(): Promise<void> {
    await logInfo("Starting rollback", {
      queueLength: this.rollbackQueue.length,
    });

    for (const {path, metadata} of this.rollbackQueue.reverse()) {
      try {
        await this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: this.getFullPath(path),
            Metadata: metadata,
          })
        );

        await logInfo("Rollback successful for path", {
          path,
          metadata,
        });
      } catch (rollbackError) {
        await logWarning("Rollback failed for path", {
          path,
          metadata,
          error:
            rollbackError instanceof Error ?
              rollbackError.message :
              "Unknown error",
        });
      }
    }

    this.rollbackQueue = [];
    await logInfo("Rollback complete", {
      timestamp: new Date().toISOString(),
    });
  }

  async deleteFile(path: string): Promise<void> {
    const fullPath = this.getFullPath(path);
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: fullPath,
        })
      );

      await logInfo("File deleted successfully", {path: fullPath});
    } catch (error) {
      await logWarning("File deletion failed", {
        path: fullPath,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  getPublicUrl(path: string): string {
    return `${this.customDomain}/${this.getFullPath(path)}`;
  }

  // Add the 'addToRollback' method
  private addToRollback(path: string, metadata: Record<string, string>): void {
    this.rollbackQueue.push({path, metadata});
  }
}

export const r2Storage = new R2Storage();
