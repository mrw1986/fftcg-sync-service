import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import {R2_CONFIG} from "../config/r2";
import {logInfo, logWarning} from "../utils/logger";
import {ImageMetadata} from "../types";

export class R2Storage {
  private client: S3Client;
  private bucket: string;
  private storagePath: string;
  private customDomain: string;

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

  async uploadImage(
    buffer: Buffer,
    path: string,
    metadata: ImageMetadata
  ): Promise<string> {
    const fullPath = this.getFullPath(path);

    try {
      // Pre-upload validation
      if (!buffer || buffer.length === 0) {
        throw new Error("Empty buffer provided for upload");
      }

      // Convert metadata to string values for S3 compatibility
      const stringMetadata: Record<string, string> = Object.entries(
        metadata
      ).reduce((acc, [key, value]) => {
        if (value !== undefined && value !== null) {
          if (value instanceof Date) {
            acc[key] = value.toISOString();
          } else {
            acc[key] = String(value);
          }
        }
        return acc;
      }, {} as Record<string, string>);

      // Upload to R2
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: fullPath,
          Body: buffer,
          ContentType: "image/jpeg",
          ContentLength: buffer.length,
          Metadata: stringMetadata,
          CacheControl: "public, max-age=31536000",
        })
      );

      // Verify upload
      const exists = await this.fileExists(path);
      if (!exists) {
        throw new Error("Upload verification failed - file not found");
      }

      const publicUrl = this.getPublicUrl(fullPath);

      await logInfo("Image upload successful", {
        path: fullPath,
        size: buffer.length,
        url: publicUrl,
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

      return response.Metadata || null;
    } catch (error) {
      if ((error as any).name === "NotFound") {
        return null;
      }
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
      return true;
    } catch (error) {
      if ((error as any).name === "NotFound") {
        return false;
      }
      throw error;
    }
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
    // Ensure path starts without a slash and storagePath is included
    const cleanPath = path.replace(/^\/+/, "");
    return `${this.customDomain}/${cleanPath}`;
  }

  async validateStorageSetup(): Promise<boolean> {
    try {
      const testKey = `test/validate-${Date.now()}.txt`;
      const testContent = Buffer.from("Storage validation test");

      // Test write
      await this.uploadImage(testContent, testKey, {
        contentType: "text/plain",
        size: testContent.length,
        updated: new Date(),
        hash: "test",
      });

      // Test read
      const exists = await this.fileExists(testKey);

      // Test delete
      await this.deleteFile(testKey);

      return exists;
    } catch (error) {
      await logWarning("Storage validation failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return false;
    }
  }
}

export const r2Storage = new R2Storage();
