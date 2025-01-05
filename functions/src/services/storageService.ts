// src/services/storageService.ts
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import axios from "axios";
import { R2_CONFIG } from "../config/r2";
import { logger } from "../utils/logger";

interface ImageResult {
  highResUrl: string;
  lowResUrl: string;
  metadata: {
    contentType: string;
    productId: string;
    groupId: string;
    lastUpdated: string;
    isPlaceholder?: boolean;
    originalUrl?: string;
    existingImage?: boolean;
    errorMessage?: string;
  };
}

export class StorageService {
  private client: S3Client;
  private readonly bucket: string;
  private readonly customDomain: string;
  private readonly storagePath: string;
  private readonly maxRetries = 3;
  private readonly timeoutMs = 30000; // 30 seconds
  private readonly PLACEHOLDER_URL = "https://fftcgcompanion.com/card-images/image-coming-soon.jpeg";
  private readonly validImagePatterns = [
    "_200w.", // Match _200w followed by any extension
    "_400w.", // Match _400w followed by any extension
    "_1000x1000.", // Match _1000x1000 followed by any extension
  ];

  constructor() {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${R2_CONFIG.ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_CONFIG.ACCESS_KEY_ID,
        secretAccessKey: R2_CONFIG.SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    });

    this.bucket = R2_CONFIG.BUCKET_NAME;
    this.customDomain = R2_CONFIG.CUSTOM_DOMAIN;
    this.storagePath = R2_CONFIG.STORAGE_PATH;
  }

  private isValidImageUrl(url: string | undefined): boolean {
    if (!url) return false;

    // Check if it's TCGPlayer's missing image SVG
    if (url.includes("image-missing.svg")) {
      logger.info(`TCGPlayer missing image URL detected: ${url}, using our placeholder`);
      return false;
    }

    // If URL contains any of our valid patterns, it's a valid TCGPlayer image URL
    const isValidPattern = this.validImagePatterns.some((pattern) => url.includes(pattern));

    // If URL doesn't match our patterns, consider it invalid
    if (!isValidPattern) {
      logger.info(`Invalid image URL pattern: ${url}, using placeholder`);
      return false;
    }

    return true;
  }

  private async checkImageExists(path: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: path,
        })
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  private async validateImage(buffer: Buffer): Promise<boolean> {
    if (buffer.length < 4) return false;

    const header = buffer.slice(0, 4);
    // JPEG magic number: FF D8 FF
    const isJPEG = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    // PNG magic number: 89 50 4E 47
    const isPNG = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;

    return isJPEG || isPNG;
  }

  private async downloadImage(url: string, retries = this.maxRetries): Promise<Buffer> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: this.timeoutMs,
          headers: {
            "User-Agent": "FFTCG-Sync-Service/1.0",
            "Accept": "image/jpeg,image/png,image/*",
          },
          maxContentLength: 10 * 1024 * 1024, // 10MB max
          validateStatus: (status) => status === 200, // Only accept 200 status
        });

        const buffer = Buffer.from(response.data);

        if (await this.validateImage(buffer)) {
          return buffer;
        } else {
          throw new Error("Invalid image format");
        }
      } catch (error) {
        const axiosError = error as { response?: { status?: number } };

        // If we get a 403, this means the image doesn't exist or access is denied
        // Don't retry and don't log as error since this is an expected case
        if (axiosError?.response?.status === 403) {
          logger.info(`Image not available (403) for URL: ${url}`);
          throw new Error("IMAGE_NOT_AVAILABLE");
        }

        // For other errors, continue with retry logic
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === retries) {
          logger.error(`Failed to download image after ${retries + 1} attempts`, {
            url,
            error: lastError.message,
            status: axiosError?.response?.status,
          });
          break;
        }

        // Only log retries for non-403 errors
        logger.info(`Retrying image download (attempt ${attempt + 1}/${retries})`, {
          url,
          status: axiosError?.response?.status,
        });

        await new Promise((resolve) => setTimeout(resolve, 2000 * Math.pow(2, attempt)));
      }
    }

    throw lastError || new Error("Download failed after retries");
  }

  private async uploadToR2WithRetry(
    buffer: Buffer,
    path: string,
    metadata: Record<string, string>,
    retries = this.maxRetries
  ): Promise<string> {
    let lastError: Error | null = null;

    const stringMetadata = Object.entries(metadata).reduce(
      (acc, [key, value]) => ({
        ...acc,
        [key]: String(value),
      }),
      {}
    );

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: path,
            Body: buffer,
            ContentType: "image/jpeg",
            Metadata: stringMetadata,
            ContentLength: buffer.length,
            CacheControl: "public, max-age=31536000", // Cache for 1 year
            ACL: "public-read",
          })
        );
        return `${this.customDomain}/${path}`;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.error(`Upload attempt ${attempt + 1} failed`, {
          path,
          error: lastError.message,
        });
        if (attempt === retries) break;
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }

    throw lastError || new Error("Upload failed after retries");
  }

  private getImagePath(groupId: string, cardNumber: string, resolution: "200w" | "400w"): string {
    return `${this.storagePath}/${groupId}/${cardNumber}_${resolution}.jpg`;
  }

  public async processAndStoreImage(
    imageUrl: string | undefined,
    productId: number,
    groupId: string,
    cardNumber: string
  ): Promise<ImageResult> {
    const baseMetadata = {
      productId: productId.toString(),
      groupId,
      lastUpdated: new Date().toISOString(),
      contentType: "image/jpeg",
    };

    // Check for valid TCGPlayer URL first
    if (!this.isValidImageUrl(imageUrl)) {
      logger.info(`Invalid or missing image URL for product ${productId}, using placeholder`);
      return {
        highResUrl: this.PLACEHOLDER_URL,
        lowResUrl: this.PLACEHOLDER_URL,
        metadata: {
          ...baseMetadata,
          isPlaceholder: true,
          originalUrl: imageUrl,
          errorMessage: "Invalid or missing image URL",
        },
      };
    }

    try {
      // Check if images already exist in R2
      const highResPath = this.getImagePath(groupId, cardNumber, "400w");
      const lowResPath = this.getImagePath(groupId, cardNumber, "200w");

      const [highResExists, lowResExists] = await Promise.all([
        this.checkImageExists(highResPath),
        this.checkImageExists(lowResPath),
      ]);

      // If both images exist, return their URLs
      if (highResExists && lowResExists) {
        const existingHighResUrl = `${this.customDomain}/${highResPath}`;
        const existingLowResUrl = `${this.customDomain}/${lowResPath}`;

        logger.info(`Using existing images for product ${productId}`);
        return {
          highResUrl: existingHighResUrl,
          lowResUrl: existingLowResUrl,
          metadata: {
            ...baseMetadata,
            originalUrl: imageUrl,
            existingImage: true,
          },
        };
      }

      try {
        const baseUrl = imageUrl || "";
        const highResTcgUrl = baseUrl.replace("/fit-in/", "/fit-in/437x437/");
        const lowResTcgUrl = baseUrl.replace("/fit-in/", "/fit-in/223x223/");

        const [highResBuffer, lowResBuffer] = await Promise.all([
          this.downloadImage(highResTcgUrl),
          this.downloadImage(lowResTcgUrl),
        ]);

        // Upload both versions to R2
        const [storedHighResUrl, storedLowResUrl] = await Promise.all([
          this.uploadToR2WithRetry(highResBuffer, highResPath, baseMetadata),
          this.uploadToR2WithRetry(lowResBuffer, lowResPath, baseMetadata),
        ]);

        return {
          highResUrl: storedHighResUrl,
          lowResUrl: storedLowResUrl,
          metadata: {
            ...baseMetadata,
            originalUrl: imageUrl,
          },
        };
      } catch (unknownError: unknown) {
        const error = unknownError instanceof Error ? unknownError : new Error(String(unknownError));

        // Only log as error if it's not an expected case
        if (error.message !== "IMAGE_NOT_AVAILABLE") {
          logger.error(`Failed to process images for ${productId}`, { error });
        }

        return {
          highResUrl: this.PLACEHOLDER_URL,
          lowResUrl: this.PLACEHOLDER_URL,
          metadata: {
            ...baseMetadata,
            isPlaceholder: true,
            originalUrl: imageUrl,
            errorMessage:
              error.message === "IMAGE_NOT_AVAILABLE" ? "Image not available from source" : "Image processing failed",
          },
        };
      }
    } catch (unknownError: unknown) {
      const error = unknownError instanceof Error ? unknownError : new Error(String(unknownError));

      // Only log as error if it's not an expected case
      if (error.message !== "IMAGE_NOT_AVAILABLE") {
        logger.error(`Failed to process images for ${productId}`, { error });
      }

      return {
        highResUrl: this.PLACEHOLDER_URL,
        lowResUrl: this.PLACEHOLDER_URL,
        metadata: {
          ...baseMetadata,
          isPlaceholder: true,
          originalUrl: imageUrl,
          errorMessage:
            error.message === "IMAGE_NOT_AVAILABLE" ? "Image not available from source" : "Image processing failed",
        },
      };
    }
  }
}

export const storageService = new StorageService();
