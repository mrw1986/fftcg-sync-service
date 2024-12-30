import axios, {AxiosError} from "axios";
import {storage, STORAGE, COLLECTION, db} from "../config/firebase";
import {logError, logInfo, logWarning} from "./logger";
import * as crypto from "crypto";
import {GenericError, ImageMetadata, ImageProcessingResult} from "../types";
import {ImageValidator} from "./imageValidator";
import {imageCache} from "./imageCache";
import {ImageCompressor} from "./imageCompressor";

interface ImagePathOptions {
  groupId: string;
  productId: number;
  cardNumber: string;
  isHighRes?: boolean;
  isLowRes?: boolean;
}

export class ImageHandler {
  private bucket = storage.bucket(STORAGE.BUCKETS.CARD_IMAGES);
  private baseStorageUrl = `https://storage.googleapis.com/${STORAGE.BUCKETS.CARD_IMAGES}`;

  private sanitizeCardNumber(cardNumber: string): string {
    // Replace forward slashes with underscores or another safe character
    return cardNumber.replace(/\//g, "_");
  }

  private getHighResUrl(imageUrl: string): string {
    return imageUrl.replace(/_200w\.jpg$/, "_400w.jpg");
  }

  private getStoragePath(options: ImagePathOptions): string {
    let suffix = "_200w"; // default to low res
    if (options.isHighRes) {
      suffix = "_400w";
    }
    const sanitizedCardNumber = this.sanitizeCardNumber(options.cardNumber);
    const fileName = `${options.productId}_${sanitizedCardNumber}${suffix}.jpg`;
    return `${STORAGE.PATHS.IMAGES}/${options.groupId}/${fileName}`;
  }

  private getPublicUrl(storagePath: string): string {
    return `${this.baseStorageUrl}/${storagePath}`;
  }

  private async getImageHash(imageBuffer: Buffer): Promise<string> {
    return crypto.createHash("md5").update(imageBuffer).digest("hex");
  }

  private async compressImage(
    buffer: Buffer,
    isHighRes: boolean
  ): Promise<Buffer> {
    try {
      const result = await ImageCompressor.compress(buffer, isHighRes);
      await logInfo("Image compression successful", {
        originalSize: buffer.length,
        compressedSize: result.buffer.length,
        quality: result.info.quality,
        dimensions: `${result.info.width}x${result.info.height}`,
        timestamp: new Date().toISOString(),
      });
      return result.buffer;
    } catch (error) {
      await logWarning("Image compression skipped", {
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
      return buffer;
    }
  }

  private async downloadImage(url: string): Promise<Buffer> {
    const cacheKey = imageCache.getBufferCacheKey(url);
    const cachedBuffer = await imageCache.getBuffer(cacheKey);

    if (cachedBuffer) {
      await logInfo("Using cached image", {
        url,
        size: cachedBuffer.length,
        timestamp: new Date().toISOString(),
      });
      return cachedBuffer;
    }

    try {
      await logInfo("Attempting to download image", {
        url,
        timestamp: new Date().toISOString(),
      });

      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 30000,
        headers: {
          "Accept": "image/jpeg",
          "User-Agent": "FFTCG-Sync-Service/1.0",
        },
      });

      const buffer = Buffer.from(response.data);
      const validationError = await ImageValidator.validateImage(buffer);

      if (validationError) {
        throw new Error(`Image validation failed: ${validationError.message}`);
      }

      imageCache.setBuffer(cacheKey, buffer);

      await logInfo("Successfully downloaded and validated image", {
        url,
        size: buffer.length,
        timestamp: new Date().toISOString(),
      });

      return buffer;
    } catch (error) {
      await logWarning("Failed to download or validate image", {
        url,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
      throw error;
    }
  }

  private async shouldUpdateImage(
    options: ImagePathOptions,
    imageBuffer: Buffer
  ): Promise<boolean> {
    if (
      process.env.NODE_ENV === "test" ||
      process.env.FORCE_UPDATE === "true"
    ) {
      await logInfo("Force update enabled", {
        env: process.env.NODE_ENV,
        forceUpdate: process.env.FORCE_UPDATE,
        timestamp: new Date().toISOString(),
      });
      return true;
    }

    try {
      const storagePath = this.getStoragePath(options);
      const [fileExists] = await this.bucket.file(storagePath).exists();

      if (!fileExists) {
        await logInfo("Image does not exist in storage", {
          path: storagePath,
          timestamp: new Date().toISOString(),
        });
        return true;
      }

      const [metadata] = await this.bucket.file(storagePath).getMetadata();
      const currentHash = metadata.metadata?.hash;
      const newHash = await this.getImageHash(imageBuffer);

      await logInfo("Image hash comparison", {
        path: storagePath,
        currentHash,
        newHash,
        needsUpdate: currentHash !== newHash,
        timestamp: new Date().toISOString(),
      });

      return currentHash !== newHash;
    } catch (error) {
      await logWarning("Error checking image update status", {
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
      return true;
    }
  }

  private async saveToStorage(
    options: ImagePathOptions,
    buffer: Buffer,
    isHighRes: boolean
  ): Promise<string> {
    const storagePath = this.getStoragePath({
      ...options,
      isHighRes,
      isLowRes: !isHighRes,
    });

    const hash = await this.getImageHash(buffer);

    await logInfo(
      `Attempting to save ${isHighRes ? "high-res" : "low-res"} image`,
      {
        path: storagePath,
        size: buffer.length,
        hash,
        timestamp: new Date().toISOString(),
        metadata: {
          groupId: options.groupId,
          productId: options.productId,
          cardNumber: options.cardNumber,
        },
      }
    );

    await this.bucket.file(storagePath).save(buffer, {
      metadata: {
        contentType: "image/jpeg",
        metadata: {
          hash,
          type: isHighRes ? "highres" : "lowres",
          updatedAt: new Date().toISOString(),
        },
        cacheControl: "public, max-age=31536000",
      },
      public: true,
    });

    const [exists] = await this.bucket.file(storagePath).exists();
    const publicUrl = this.getPublicUrl(storagePath);

    await logInfo(
      `${isHighRes ? "High-res" : "Low-res"} image saved successfully`,
      {
        path: storagePath,
        size: buffer.length,
        hash,
        exists,
        publicUrl,
        timestamp: new Date().toISOString(),
      }
    );

    return publicUrl;
  }

  private async saveMetadata(
    options: ImagePathOptions,
    metadata: ImageMetadata
  ): Promise<void> {
    const sanitizedCardNumber = this.sanitizeCardNumber(options.cardNumber);
    const docRef = db
      .collection(COLLECTION.IMAGE_METADATA)
      .doc(`${options.groupId}_${options.productId}_${sanitizedCardNumber}`);

    await docRef.set(
      {
        ...metadata,
        groupId: options.groupId,
        productId: options.productId,
        cardNumber: options.cardNumber, // Keep the original card number in the metadata
        sanitizedCardNumber, // Optionally store the sanitized version
        lastUpdated: new Date(),
      },
      {merge: true}
    );

    await logInfo("Saved image metadata", {
      groupId: options.groupId,
      productId: options.productId,
      cardNumber: options.cardNumber,
      sanitizedCardNumber,
      metadata,
      timestamp: new Date().toISOString(),
    });
  }

  async processImage(
    imageUrl: string,
    groupId: string,
    productId: number,
    cardNumber: string
  ): Promise<ImageProcessingResult> {
    const options: ImagePathOptions = {
      groupId,
      productId,
      cardNumber,
    };

    try {
      await logInfo("Starting image processing", {
        imageUrl,
        groupId,
        productId,
        cardNumber,
        timestamp: new Date().toISOString(),
      });

      const highResUrl = this.getHighResUrl(imageUrl);
      let highResBuffer: Buffer | null = null;
      let lowResBuffer: Buffer | null = null;
      let updated = false;
      let lowResStorageUrl = "";
      let highResStorageUrl = "";

      // Process low-res image
      try {
        await logInfo("Downloading low-res image", {
          url: imageUrl,
          timestamp: new Date().toISOString(),
        });

        lowResBuffer = await this.downloadImage(imageUrl);
        if (lowResBuffer) {
          await logInfo("Compressing low-res image", {
            originalSize: lowResBuffer.length,
            timestamp: new Date().toISOString(),
          });

          lowResBuffer = await this.compressImage(lowResBuffer, false);
          if (
            await this.shouldUpdateImage(
              {...options, isLowRes: true},
              lowResBuffer
            )
          ) {
            lowResStorageUrl = await this.saveToStorage(
              options,
              lowResBuffer,
              false
            );
            updated = true;

            await logInfo("Low-res image updated", {
              url: lowResStorageUrl,
              size: lowResBuffer.length,
              timestamp: new Date().toISOString(),
            });
          } else {
            await logInfo("Low-res image unchanged", {
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch (error) {
        await logWarning("Low-res image processing failed", {
          productId,
          url: imageUrl,
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date().toISOString(),
        });
      }

      // Process high-res image
      try {
        await logInfo("Downloading high-res image", {
          url: highResUrl,
          timestamp: new Date().toISOString(),
        });

        highResBuffer = await this.downloadImage(highResUrl);
        if (highResBuffer) {
          await logInfo("Compressing high-res image", {
            originalSize: highResBuffer.length,
            timestamp: new Date().toISOString(),
          });

          highResBuffer = await this.compressImage(highResBuffer, true);
          if (
            await this.shouldUpdateImage(
              {...options, isHighRes: true},
              highResBuffer
            )
          ) {
            highResStorageUrl = await this.saveToStorage(
              options,
              highResBuffer,
              true
            );
            updated = true;

            await logInfo("High-res image updated", {
              url: highResStorageUrl,
              size: highResBuffer.length,
              timestamp: new Date().toISOString(),
            });
          } else {
            await logInfo("High-res image unchanged", {
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch (error) {
        await logWarning("High-res image processing failed", {
          productId,
          url: highResUrl,
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date().toISOString(),
        });
      }

      // Set storage URLs if not generated
      if (!lowResStorageUrl) {
        lowResStorageUrl = this.getPublicUrl(
          this.getStoragePath({...options, isLowRes: true})
        );
      }
      if (!highResStorageUrl) {
        highResStorageUrl = this.getPublicUrl(
          this.getStoragePath({...options, isHighRes: true})
        );
      }

      const metadata: ImageMetadata = {
        contentType: "image/jpeg",
        size: lowResBuffer?.length || 0,
        updated: new Date(),
        hash: lowResBuffer ? await this.getImageHash(lowResBuffer) : "",
        highResSize: highResBuffer?.length,
        lowResSize: lowResBuffer?.length,
      };

      await this.saveMetadata(options, metadata);

      await logInfo("Image processing completed", {
        productId,
        groupId,
        updated,
        highResUrl: highResStorageUrl,
        lowResUrl: lowResStorageUrl,
        sizes: {
          highRes: highResBuffer?.length,
          lowRes: lowResBuffer?.length,
        },
        timestamp: new Date().toISOString(),
      });

      return {
        highResUrl: highResStorageUrl,
        lowResUrl: lowResStorageUrl,
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
      await logError(genericError, "processImage");
      return {
        highResUrl: "",
        lowResUrl: "",
        metadata: {
          contentType: "image/jpeg",
          size: 0,
          updated: new Date(),
          hash: "",
          highResSize: 0,
          lowResSize: 0,
        },
        updated: false,
      };
    }
  }
}

export const imageHandler = new ImageHandler();
