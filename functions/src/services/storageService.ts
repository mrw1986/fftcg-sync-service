// src/services/storageService.ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import axios from "axios";
import { R2_CONFIG } from "../config/r2";
import { logger } from "../utils/logger";
import * as path from "path";
import * as fs from "fs/promises";

interface ImageResult {
  highResUrl: string;
  lowResUrl: string;
  metadata: {
    contentType: string;
    productId: string;
    groupId: string;
    lastUpdated: string;
    isPlaceholder?: boolean;
  };
}

export class StorageService {
  private client: S3Client;
  private readonly bucket: string;
  private readonly customDomain: string;
  private readonly storagePath: string;
  private readonly placeholderPath: string;

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
    this.customDomain = R2_CONFIG.CUSTOM_DOMAIN;
    this.storagePath = R2_CONFIG.STORAGE_PATH;
    this.placeholderPath = path.join(process.cwd(), "functions/public/assets/image-coming-soon.jpeg");
  }

  private async getPlaceholderImage(): Promise<Buffer> {
    try {
      return await fs.readFile(this.placeholderPath);
    } catch (error) {
      logger.error("Failed to load placeholder image", { error });
      throw new Error("Failed to load placeholder image");
    }
  }

  private shouldUsePlaceholder(imageUrl?: string): boolean {
    if (!imageUrl) return true;
    return imageUrl.includes("image-missing.svg") || !imageUrl.match(/_(200w|400w)\.jpg$/);
  }

  // Simplified retry logic for image downloads/uploads
  private async downloadImage(url: string, retries = 2): Promise<Buffer> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: 10000,
          headers: {
            "User-Agent": "FFTCG-Sync-Service/1.0",
            "Accept": "image/jpeg,image/png,image/*",
          },
        });
        return Buffer.from(response.data);
      } catch (error) {
        if (attempt === retries) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
    throw new Error("Download failed after retries");
  }

  private async uploadToR2(buffer: Buffer, path: string, metadata: Record<string, string>): Promise<string> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: path,
          Body: buffer,
          ContentType: "image/jpeg",
          Metadata: metadata,
          ContentLength: buffer.length,
          CacheControl: "public, max-age=31536000",
        })
      );
      return `${this.customDomain}/${path}`;
    } catch (error) {
      logger.error(`Failed to upload to R2: ${path}`, { error });
      throw error;
    }
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
    const metadata = {
      productId: productId.toString(),
      groupId,
      lastUpdated: new Date().toISOString(),
    };

    // Handle placeholder case
    if (this.shouldUsePlaceholder(imageUrl)) {
      try {
        const placeholderBuffer = await this.getPlaceholderImage();
        const placeholderMetadata = {
          ...metadata,
          isPlaceholder: "true",
        };

        // Store placeholder in both resolutions
        const [highResUrl, lowResUrl] = await Promise.all([
          this.uploadToR2(placeholderBuffer, this.getImagePath(groupId, cardNumber, "400w"), placeholderMetadata),
          this.uploadToR2(placeholderBuffer, this.getImagePath(groupId, cardNumber, "200w"), placeholderMetadata),
        ]);

        return {
          highResUrl,
          lowResUrl,
          metadata: {
            ...metadata,
            contentType: "image/jpeg",
            isPlaceholder: true,
          },
        };
      } catch (error) {
        logger.error("Failed to process placeholder image", { error, productId });
        throw error;
      }
    }

    // Handle normal image case
    try {
      if (!imageUrl) {
        throw new Error("No image URL provided");
      }

      // Convert URLs
      const lowResUrl = imageUrl;
      const highResUrl = imageUrl.replace("_200w.jpg", "_400w.jpg");

      // Download both versions
      const [highResBuffer, lowResBuffer] = await Promise.all([
        this.downloadImage(highResUrl),
        this.downloadImage(lowResUrl),
      ]);

      // Upload both versions
      const [storedHighResUrl, storedLowResUrl] = await Promise.all([
        this.uploadToR2(highResBuffer, this.getImagePath(groupId, cardNumber, "400w"), metadata),
        this.uploadToR2(lowResBuffer, this.getImagePath(groupId, cardNumber, "200w"), metadata),
      ]);

      return {
        highResUrl: storedHighResUrl,
        lowResUrl: storedLowResUrl,
        metadata: {
          ...metadata,
          contentType: "image/jpeg",
        },
      };
    } catch (error) {
      logger.error(`Failed to process images for ${productId}`, { error });

      // Fallback to placeholder on error
      return this.processAndStoreImage(undefined, productId, groupId, cardNumber);
    }
  }
}

export const storageService = new StorageService();
