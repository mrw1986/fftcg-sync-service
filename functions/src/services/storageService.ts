// src/services/storageService.ts
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import axios from "axios";
import { R2_CONFIG } from "../config/r2";
import { logger } from "../utils/logger";

interface ImageResult {
  fullResUrl: string;
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
    "_in_1000x1000.", // Highest priority
    "_400w.", // Medium priority
    "_200w.", // Lowest priority
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
      // Check for specific S3 errors
      if (error instanceof Error) {
        // NoSuchKey or 404 means the image doesn't exist
        if (error.name === "NotFound" || error.name === "NoSuchKey") {
          return false;
        }

        // Log other errors but don't fail the whole process
        logger.info(`Image check error for ${path}: ${error.message}`);
      }
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
            Accept: "image/jpeg,image/png,image/*",
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
      } catch (unknownError) {
        const error = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
        const axiosError = unknownError as { response?: { status?: number } };

        // If we get a 403, this means the image doesn't exist or access is denied
        // Don't retry and don't log as error since this is an expected case
        if (axiosError?.response?.status === 403) {
          logger.info(`Image not available (403) for URL: ${url}`);
          throw new Error("IMAGE_NOT_AVAILABLE");
        }

        lastError = error;

        if (attempt === retries) {
          logger.error(`Failed to download image after ${retries + 1} attempts`, {
            url,
            error: error.message,
            stack: error.stack,
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
      } catch (unknownError) {
        const error = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
        lastError = error;

        logger.error(`Upload attempt ${attempt + 1} failed`, {
          path,
          error: error.message,
          stack: error.stack,
        });

        if (attempt === retries) break;
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }

    throw lastError || new Error("Upload failed after retries");
  }

  private getImagePath(groupId: string, cardNumber: string, resolution: "1000x1000" | "400w" | "200w"): string {
    const suffix = resolution === "1000x1000" ? "_in_1000x1000" : `_${resolution}`;
    return `${this.storagePath}/${groupId}/${cardNumber}${suffix}.jpg`;
  }

  private getPlaceholderResult(
    baseMetadata: {
      contentType: string;
      productId: string;
      groupId: string;
      lastUpdated: string;
    },
    originalUrl?: string
  ): ImageResult {
    return {
      fullResUrl: this.PLACEHOLDER_URL,
      highResUrl: this.PLACEHOLDER_URL,
      lowResUrl: this.PLACEHOLDER_URL,
      metadata: {
        ...baseMetadata,
        isPlaceholder: true,
        originalUrl,
        errorMessage: originalUrl ? "Invalid image URL" : "Image URL missing",
      },
    };
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

    try {
      if (!this.isValidImageUrl(imageUrl)) {
        return this.getPlaceholderResult(baseMetadata, imageUrl);
      }

      // Check if images already exist in R2
      const fullResPath = this.getImagePath(groupId, cardNumber, "1000x1000");
      const highResPath = this.getImagePath(groupId, cardNumber, "400w");
      const lowResPath = this.getImagePath(groupId, cardNumber, "200w");

      const [fullResExists, highResExists, lowResExists] = await Promise.all([
        this.checkImageExists(fullResPath).catch(() => false),
        this.checkImageExists(highResPath).catch(() => false),
        this.checkImageExists(lowResPath).catch(() => false),
      ]);

      // If all images exist, return their URLs
      if (fullResExists && highResExists && lowResExists) {
        const existingFullResUrl = `${this.customDomain}/${fullResPath}`;
        const existingHighResUrl = `${this.customDomain}/${highResPath}`;
        const existingLowResUrl = `${this.customDomain}/${lowResPath}`;

        logger.info(`Using existing images for product ${productId}:`, {
          fullResUrl: existingFullResUrl,
          highResUrl: existingHighResUrl,
          lowResUrl: existingLowResUrl,
        });

        return {
          fullResUrl: existingFullResUrl,
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
        // Create URLs for different resolutions
        const fullResTcgUrl = baseUrl.replace(/_[^.]+\./, "_in_1000x1000.");
        const highResTcgUrl = baseUrl.replace(/_[^.]+\./, "_400w.");
        const lowResTcgUrl = baseUrl.replace(/_[^.]+\./, "_200w.");

        logger.info(`Attempting to download images for product ${productId}:`, {
          fullRes: fullResTcgUrl,
          highRes: highResTcgUrl,
          lowRes: lowResTcgUrl,
        });

        // Try to download each resolution
        const [fullResBuffer, highResBuffer, lowResBuffer] = await Promise.all([
          this.downloadImage(fullResTcgUrl).catch((error) => {
            logger.info(`Failed to download full resolution image: ${error.message}`);
            return null;
          }),
          this.downloadImage(highResTcgUrl).catch((error) => {
            logger.info(`Failed to download high resolution image: ${error.message}`);
            return null;
          }),
          this.downloadImage(lowResTcgUrl).catch((error) => {
            logger.info(`Failed to download low resolution image: ${error.message}`);
            return null;
          }),
        ]);

        // Log which resolutions were successfully downloaded
        logger.info(`Download results for product ${productId}:`, {
          fullResDownloaded: !!fullResBuffer,
          highResDownloaded: !!highResBuffer,
          lowResDownloaded: !!lowResBuffer,
        });

        // Prepare arrays for successful uploads
        const uploadPromises: Promise<string>[] = [];
        const uploadPaths: string[] = [];

        // Add available images to upload queue
        if (fullResBuffer) {
          uploadPromises.push(this.uploadToR2WithRetry(fullResBuffer, fullResPath, baseMetadata));
          uploadPaths.push(fullResPath);
        }
        if (highResBuffer) {
          uploadPromises.push(this.uploadToR2WithRetry(highResBuffer, highResPath, baseMetadata));
          uploadPaths.push(highResPath);
        }
        if (lowResBuffer) {
          uploadPromises.push(this.uploadToR2WithRetry(lowResBuffer, lowResPath, baseMetadata));
          uploadPaths.push(lowResPath);
        }

        const uploadedUrls = await Promise.all(uploadPromises);

        // Create a map of paths to URLs
        const urlMap = uploadPaths.reduce((map, path, index) => {
          map[path] = uploadedUrls[index];
          return map;
        }, {} as { [key: string]: string });

        // Determine which URLs to use, falling back to the highest available resolution
        const result: ImageResult = {
          fullResUrl: urlMap[fullResPath] || urlMap[highResPath] || urlMap[lowResPath] || this.PLACEHOLDER_URL,
          highResUrl: urlMap[highResPath] || urlMap[fullResPath] || urlMap[lowResPath] || this.PLACEHOLDER_URL,
          lowResUrl: urlMap[lowResPath] || urlMap[highResPath] || urlMap[fullResPath] || this.PLACEHOLDER_URL,
          metadata: {
            ...baseMetadata,
            originalUrl: imageUrl,
          },
        };

        // Log the final URLs being stored
        logger.info(`Final image URLs for product ${productId}:`, {
          fullResUrl: result.fullResUrl,
          highResUrl: result.highResUrl,
          lowResUrl: result.lowResUrl,
          isPlaceholder: result.fullResUrl === this.PLACEHOLDER_URL,
          originalUrl: imageUrl,
          fallbacksUsed: {
            fullRes: result.fullResUrl !== urlMap[fullResPath],
            highRes: result.highResUrl !== urlMap[highResPath],
            lowRes: result.lowResUrl !== urlMap[lowResPath],
          },
        });

        return result;
      } catch (unknownError) {
        const error = unknownError instanceof Error ? unknownError : new Error(String(unknownError));

        if (error.message !== "IMAGE_NOT_AVAILABLE") {
          logger.error(`Failed to process images for ${productId}`, {
            error: error.message,
            stack: error.stack,
          });
        }

        return this.getPlaceholderResult(baseMetadata, imageUrl);
      }
    } catch (error) {
      logger.error(`Failed to process images for ${productId}`, {
        error: error instanceof Error ? error.message : "Unknown error",
        imageUrl,
        groupId,
        cardNumber,
      });
      return this.getPlaceholderResult(baseMetadata, imageUrl);
    }
  }
}

export const storageService = new StorageService();
