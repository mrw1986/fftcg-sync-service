// src/services/storageService.ts
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import axios from "axios";
import { R2_CONFIG } from "../config/r2Config";
import { logger } from "../utils/logger";

import { ImageResult } from "../types";

export class StorageService {
  private client: S3Client;
  private readonly bucket: string;
  private readonly customDomain: string;
  private readonly storagePath: string;
  private readonly maxRetries = 3;
  private readonly timeoutMs = 30000; // 30 seconds
  private readonly validImagePatterns = [
    // TCGCSV API patterns
    "_in_1000x1000.", // Highest priority
    "_400w.", // Medium priority
    "_200w.", // Lowest priority
    // Square Enix patterns
    "/cards/full/", // High res
    "/cards/thumbs/", // Low res
    "_eg.jpg", // Square Enix file suffix
  ];

  constructor() {
    // Debug logging
    console.log("StorageService Configuration:", {
      accountId: R2_CONFIG.ACCOUNT_ID,
      accessKeyId: R2_CONFIG.ACCESS_KEY_ID ? "***" : "not set",
      secretAccessKey: R2_CONFIG.SECRET_ACCESS_KEY ? "***" : "not set",
      bucket: R2_CONFIG.BUCKET_NAME,
      customDomain: R2_CONFIG.CUSTOM_DOMAIN,
      storagePath: R2_CONFIG.STORAGE_PATH,
    });

    if (!R2_CONFIG.BUCKET_NAME) {
      throw new Error("R2 bucket name is not configured");
    }

    // Define extended request handler options type
    interface ExtendedRequestHandlerOptions {
      socketTimeout?: number;
      connectionTimeout?: number;
      maxSockets?: number;
      socketAcquisitionWarningTimeout?: number;
    }

    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${R2_CONFIG.ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_CONFIG.ACCESS_KEY_ID,
        secretAccessKey: R2_CONFIG.SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
      // Increase socket limits to handle more concurrent requests
      requestHandler: {
        socketTimeout: 60000, // 60 seconds
        connectionTimeout: 60000, // 60 seconds
        maxSockets: 200, // Increase from default 50
        socketAcquisitionWarningTimeout: 5000, // 5 seconds
      } as ExtendedRequestHandlerOptions,
    });

    this.bucket = R2_CONFIG.BUCKET_NAME;
    this.customDomain = R2_CONFIG.CUSTOM_DOMAIN;
    this.storagePath = R2_CONFIG.STORAGE_PATH;

    // Verify client configuration
    console.log("S3Client Configuration:", {
      endpoint: `https://${R2_CONFIG.ACCOUNT_ID}.r2.cloudflarestorage.com`,
      bucket: this.bucket,
      customDomain: this.customDomain,
      storagePath: this.storagePath,
    });
  }

  private isValidImageUrl(url: string | undefined): boolean {
    if (!url) return false;

    // Check if it's TCGPlayer's missing image SVG
    if (url.includes("image-missing.svg")) {
      logger.info(`TCGPlayer missing image URL detected: ${url}`);
      return false;
    }

    // Check if it's a Square Enix URL
    if (url.includes("fftcg.cdn.sewest.net")) {
      return url.includes("_eg.jpg") && (url.includes("/cards/full/") || url.includes("/cards/thumbs/"));
    }

    // For TCGCSV URLs, check for resolution patterns
    const isValidPattern = this.validImagePatterns.slice(0, 3).some((pattern) => url.includes(pattern));

    // If URL doesn't match our patterns, consider it invalid
    if (!isValidPattern) {
      logger.info(`No matching image pattern found for URL: ${url}`);
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

    // Create a custom axios instance with optimized settings
    const axiosInstance = axios.create({
      responseType: "arraybuffer",
      timeout: this.timeoutMs,
      headers: {
        "User-Agent": "FFTCG-Sync-Service/1.0",
        "Accept": "image/jpeg,image/png,image/*",
      },
      maxContentLength: 10 * 1024 * 1024, // 10MB max
      validateStatus: (status) => status === 200, // Only accept 200 status
      // Add connection optimization settings
      maxRedirects: 5,
      decompress: true, // Handle gzip/deflate content
    });

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await axiosInstance.get(url);
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

        // Handle rate limiting (429) with longer backoff
        if (axiosError?.response?.status === 429) {
          logger.info(`Rate limited (429) for URL: ${url}, backing off...`);
          await new Promise((resolve) => setTimeout(resolve, 5000 * Math.pow(2, attempt)));
          continue;
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

        // Exponential backoff with jitter to avoid thundering herd
        const baseDelay = 2000 * Math.pow(1.5, attempt);
        const jitter = Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
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

  private getImagePath(groupId: string, productId: number, resolution: "1000x1000" | "400w" | "200w"): string {
    const suffix = resolution === "1000x1000" ? "_in_1000x1000" : `_${resolution}`;
    return `${this.storagePath}/${groupId}/${productId}${suffix}.jpg`;
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
    const PLACEHOLDER_URL = "https://fftcgcompanion.com/card-images/image-coming-soon.jpeg";
    return {
      fullResUrl: PLACEHOLDER_URL,
      highResUrl: PLACEHOLDER_URL,
      lowResUrl: PLACEHOLDER_URL,
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
    groupId: string
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
      const fullResPath = this.getImagePath(groupId, productId, "1000x1000");
      const highResPath = this.getImagePath(groupId, productId, "400w");
      const lowResPath = this.getImagePath(groupId, productId, "200w");

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
        let downloadUrls: (string | null)[] = [];

        // Handle Square Enix URLs
        if (baseUrl.includes("fftcg.cdn.sewest.net")) {
          if (baseUrl.includes("/cards/full/")) {
            // Full resolution image - use for both full and high res
            downloadUrls = [baseUrl, baseUrl, null];
          } else if (baseUrl.includes("/cards/thumbs/")) {
            // Thumbnail image - use for low res
            downloadUrls = [null, null, baseUrl];
          } else {
            downloadUrls = [baseUrl, null, null];
          }
        } else {
          // TCGCSV URLs need transformation
          downloadUrls = [
            baseUrl.replace(/_[^.]+\./, "_in_1000x1000."),
            baseUrl.replace(/_[^.]+\./, "_400w."),
            baseUrl.replace(/_[^.]+\./, "_200w."),
          ];
        }

        logger.info(`Attempting to download images for product ${productId}:`, {
          urls: downloadUrls,
        });

        // Try to download each resolution sequentially to avoid too many concurrent requests
        const buffers: (Buffer | null)[] = [];

        // Process URLs one at a time with a small delay between requests
        for (const url of downloadUrls) {
          if (!url) {
            buffers.push(null);
            continue;
          }

          try {
            // Add a small delay between requests to avoid overwhelming the server
            if (buffers.length > 0) {
              await new Promise((resolve) => setTimeout(resolve, 100));
            }

            const buffer = await this.downloadImage(url);
            buffers.push(buffer);
          } catch (error) {
            logger.info(`Failed to download image: ${error instanceof Error ? error.message : String(error)}`);
            buffers.push(null);
          }
        }

        // Map buffers to their correct resolutions
        let [fullResBuffer, highResBuffer, lowResBuffer] = buffers;

        // For Square Enix URLs, handle buffer mapping based on URL type
        if (baseUrl.includes("fftcg.cdn.sewest.net")) {
          if (baseUrl.includes("/cards/full/")) {
            // Use full res buffer for both full and high res
            highResBuffer = fullResBuffer;
          } else if (baseUrl.includes("/cards/thumbs/")) {
            // Use thumbs buffer for low res only
            [fullResBuffer, highResBuffer] = [null, null];
          }
        }

        // Log which resolutions were successfully downloaded
        logger.info(`Download results for product ${productId}:`, {
          fullResDownloaded: !!fullResBuffer,
          highResDownloaded: !!highResBuffer,
          lowResDownloaded: !!lowResBuffer,
        });

        // Prepare arrays for successful uploads
        const uploadPaths: string[] = [];
        const urlMap: { [key: string]: string } = {};

        // Process uploads sequentially to avoid too many concurrent connections
        // Upload full resolution image
        if (fullResBuffer) {
          try {
            const url = await this.uploadToR2WithRetry(fullResBuffer, fullResPath, baseMetadata);
            urlMap[fullResPath] = url;
            uploadPaths.push(fullResPath);
            // Add a small delay between uploads
            await new Promise((resolve) => setTimeout(resolve, 100));
          } catch (error) {
            logger.error(`Failed to upload full resolution image for ${productId}`, {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Upload high resolution image
        if (highResBuffer) {
          try {
            const url = await this.uploadToR2WithRetry(highResBuffer, highResPath, baseMetadata);
            urlMap[highResPath] = url;
            uploadPaths.push(highResPath);
            // Add a small delay between uploads
            await new Promise((resolve) => setTimeout(resolve, 100));
          } catch (error) {
            logger.error(`Failed to upload high resolution image for ${productId}`, {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Upload low resolution image
        if (lowResBuffer) {
          try {
            const url = await this.uploadToR2WithRetry(lowResBuffer, lowResPath, baseMetadata);
            urlMap[lowResPath] = url;
            uploadPaths.push(lowResPath);
          } catch (error) {
            logger.error(`Failed to upload low resolution image for ${productId}`, {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Determine which URLs to use, falling back to the highest available resolution
        const PLACEHOLDER_URL = "https://fftcgcompanion.com/card-images/image-coming-soon.jpeg";
        const result: ImageResult = {
          fullResUrl: urlMap[fullResPath] || urlMap[highResPath] || urlMap[lowResPath] || PLACEHOLDER_URL,
          highResUrl: urlMap[highResPath] || urlMap[fullResPath] || urlMap[lowResPath] || PLACEHOLDER_URL,
          lowResUrl: urlMap[lowResPath] || urlMap[highResPath] || urlMap[fullResPath] || PLACEHOLDER_URL,
          metadata: {
            ...baseMetadata,
            originalUrl: imageUrl,
            isPlaceholder: !(urlMap[fullResPath] || urlMap[highResPath] || urlMap[lowResPath]),
          },
        };

        // Log the final URLs being stored
        logger.info(`Final image URLs for product ${productId}:`, {
          fullResUrl: result.fullResUrl,
          highResUrl: result.highResUrl,
          lowResUrl: result.lowResUrl,
          isPlaceholder: !result.fullResUrl,
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
      });
      return this.getPlaceholderResult(baseMetadata, imageUrl);
    }
  }
}

export const storageService = new StorageService();
