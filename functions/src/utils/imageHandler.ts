// src/utils/imageHandler.ts
import axios, {AxiosError} from "axios";
import {storage, STORAGE, COLLECTION, db} from "../config/firebase";
import {logError, logInfo, logWarning} from "./logger";
import LRUCache from "lru-cache";
import * as crypto from "crypto";
import {GenericError} from "../types";

interface ImageMetadata {
  contentType: string;
  size: number;
  updated: Date;
  hash: string;
  originalUrl: string;
  highResUrl: string;
  originalSize?: number;
  highResSize?: number;
}

interface ImageProcessingResult {
  originalUrl: string;
  highResUrl: string;
  metadata: ImageMetadata;
  updated: boolean;
}

const cacheOptions = {
  max: 1000,
  ttl: 1000 * 60 * 60, // 1 hour
};

const imageMetadataCache = new LRUCache<string, ImageMetadata>(cacheOptions);
const imageExistsCache = new LRUCache<string, boolean>(cacheOptions);

export class ImageHandler {
  private bucket = storage.bucket(STORAGE.BUCKETS.CARD_IMAGES);

  private getHighResUrl(imageUrl: string): string {
    return imageUrl.replace(/_200w\.jpg$/, "_400w.jpg");
  }

  private getStoragePath(groupId: string, productId: number, isHighRes: boolean = false): string {
    const suffix = isHighRes ? "_400w" : "_200w";
    return `${STORAGE.PATHS.IMAGES}/${groupId}/${productId}${suffix}.jpg`;
  }

  private async getImageHash(imageBuffer: Buffer): Promise<string> {
    return crypto.createHash("md5").update(imageBuffer).digest("hex");
  }

  private async downloadImage(url: string): Promise<Buffer> {
    try {
      await logInfo(`Attempting to download image from: ${url}`);
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 30000,
        headers: {
          "Accept": "image/jpeg",
          "User-Agent": "FFTCG-Sync-Service/1.0",
        },
      });
      await logInfo(`Successfully downloaded image from: ${url}`);
      return Buffer.from(response.data);
    } catch (error) {
      await logWarning(
        `Failed to download image: ${error instanceof Error ? error.message : "Unknown error"}`,
        {url, errorDetails: error instanceof Error ? error.message : "Unknown error"}
      );
      throw error;
    }
  }

  private async shouldUpdateImage(
    groupId: string,
    productId: number,
    imageBuffer: Buffer,
    isHighRes: boolean
  ): Promise<boolean> {
    const storagePath = this.getStoragePath(groupId, productId, isHighRes);
    const cacheKey = `${groupId}:${productId}:${isHighRes ? "high" : "original"}`;

    try {
      const cachedMetadata = imageMetadataCache.get(cacheKey);
      if (cachedMetadata) {
        const newHash = await this.getImageHash(imageBuffer);
        return cachedMetadata.hash !== newHash;
      }

      const exists = imageExistsCache.get(cacheKey);
      if (exists === false) return true;

      const [fileExists] = await this.bucket.file(storagePath).exists();
      imageExistsCache.set(cacheKey, fileExists);

      if (!fileExists) return true;

      const [metadata] = await this.bucket.file(storagePath).getMetadata();
      const currentHash = metadata.metadata?.hash;
      const newHash = await this.getImageHash(imageBuffer);

      return currentHash !== newHash;
    } catch (error) {
      const genericError: GenericError = {
        message: error instanceof Error ? error.message : "Unknown error",
        name: error instanceof Error ? error.name : "UnknownError",
        code: error instanceof AxiosError ? error.code : undefined,
        stack: error instanceof Error ? error.stack : undefined,
      };
      await logError(genericError, "shouldUpdateImage");
      return true;
    }
  }

  private async saveMetadata(
    groupId: string,
    productId: number,
    metadata: ImageMetadata
  ): Promise<void> {
    const docRef = db.collection(COLLECTION.IMAGE_METADATA)
      .doc(`${groupId}_${productId}`);

    await docRef.set({
      ...metadata,
      groupId,
      productId,
      lastUpdated: new Date(),
    }, {merge: true});

    const cacheKey = `${groupId}:${productId}`;
    imageMetadataCache.set(cacheKey, metadata);
  }

  async processImage(
    imageUrl: string,
    groupId: string,
    productId: number
  ): Promise<ImageProcessingResult> {
    try {
      await logInfo(`Processing image for product ${productId} in group ${groupId}`, {
        originalUrl: imageUrl,
        highResUrl: this.getHighResUrl(imageUrl),
      });

      const highResUrl = this.getHighResUrl(imageUrl);
      let originalBuffer: Buffer | null = null;
      let highResBuffer: Buffer | null = null;
      let updated = false;

      try {
        originalBuffer = await this.downloadImage(imageUrl);
      } catch (error) {
        await logWarning(`Original image download failed for ${productId}`, {
          url: imageUrl,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }

      try {
        highResBuffer = await this.downloadImage(highResUrl);
      } catch (error) {
        await logWarning(`High-res image download failed for ${productId}`, {
          url: highResUrl,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }

      if (!originalBuffer && !highResBuffer) {
        throw new Error(`Failed to download both image versions for product ${productId}`);
      }

      const metadata: ImageMetadata = {
        contentType: "image/jpeg",
        size: 0,
        updated: new Date(),
        hash: "",
        originalUrl: imageUrl,
        highResUrl: highResUrl,
        originalSize: originalBuffer?.length,
        highResSize: highResBuffer?.length,
      };

      if (originalBuffer) {
        const originalNeedsUpdate = await this.shouldUpdateImage(groupId, productId, originalBuffer, false);
        if (originalNeedsUpdate) {
          const originalPath = this.getStoragePath(groupId, productId, false);
          const originalHash = await this.getImageHash(originalBuffer);
          await this.bucket.file(originalPath).save(originalBuffer, {
            metadata: {
              contentType: "image/jpeg",
              metadata: {
                hash: originalHash,
                type: "original",
                updatedAt: new Date().toISOString(),
              },
            },
          });
          updated = true;
          metadata.hash = originalHash;
          metadata.size = originalBuffer.length;
        }
      }

      if (highResBuffer) {
        const highResNeedsUpdate = await this.shouldUpdateImage(groupId, productId, highResBuffer, true);
        if (highResNeedsUpdate) {
          const highResPath = this.getStoragePath(groupId, productId, true);
          const highResHash = await this.getImageHash(highResBuffer);
          await this.bucket.file(highResPath).save(highResBuffer, {
            metadata: {
              contentType: "image/jpeg",
              metadata: {
                hash: highResHash,
                type: "highres",
                updatedAt: new Date().toISOString(),
              },
            },
          });
          updated = true;
        }
      }

      await this.saveMetadata(groupId, productId, metadata);

      const [originalStorageUrl] = await this.bucket.file(
        this.getStoragePath(groupId, productId, false)
      ).getSignedUrl({
        action: "read",
        expires: "03-01-2500",
      });

      const [highResStorageUrl] = await this.bucket.file(
        this.getStoragePath(groupId, productId, true)
      ).getSignedUrl({
        action: "read",
        expires: "03-01-2500",
      });

      return {
        originalUrl: originalStorageUrl,
        highResUrl: highResStorageUrl,
        metadata,
        updated,
      };
    } catch (error) {
      const genericError: GenericError = {
        message: error instanceof Error ? error.message : "Unknown error",
        name: error instanceof Error ? error.name : "UnknownError",
        code: error instanceof AxiosError ? error.code : undefined,
        stack: error instanceof Error ? error.stack : undefined,
      };
      await logError({
        ...genericError,
        metadata: {
          productId,
          groupId,
          originalUrl: imageUrl,
          highResUrl: this.getHighResUrl(imageUrl),
        },
      }, "processImage");
      return {
        originalUrl: imageUrl,
        highResUrl: this.getHighResUrl(imageUrl),
        metadata: {
          contentType: "image/jpeg",
          size: 0,
          updated: new Date(),
          hash: "",
          originalUrl: imageUrl,
          highResUrl: this.getHighResUrl(imageUrl),
        },
        updated: false,
      };
    }
  }

  async cleanup(dryRun = true): Promise<void> {
    try {
      const [files] = await this.bucket.getFiles({
        prefix: STORAGE.PATHS.IMAGES,
      });

      const activeImages = await db.collection(COLLECTION.IMAGE_METADATA).get();
      const activeImagePaths = new Set([
        ...activeImages.docs.map((doc) => this.getStoragePath(
          doc.data().groupId,
          doc.data().productId,
          false
        )),
        ...activeImages.docs.map((doc) => this.getStoragePath(
          doc.data().groupId,
          doc.data().productId,
          true
        )),
      ]);

      let deletedCount = 0;
      for (const file of files) {
        if (!activeImagePaths.has(file.name)) {
          if (!dryRun) {
            await file.delete();
          }
          deletedCount++;
        }
      }

      await logInfo(`Cleanup complete. ${deletedCount} files ${dryRun ? "would be" : "were"} deleted.`);
    } catch (error) {
      const genericError: GenericError = {
        message: error instanceof Error ? error.message : "Unknown error",
        name: error instanceof Error ? error.name : "UnknownError",
        code: error instanceof AxiosError ? error.code : undefined,
        stack: error instanceof Error ? error.stack : undefined,
      };
      await logError(genericError, "cleanup");
    }
  }
}