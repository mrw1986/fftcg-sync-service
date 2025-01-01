import axios, {AxiosError} from "axios";
import {logError, logInfo, logWarning} from "./logger";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import {
  ImageMetadata,
  ImageProcessingResult,
  PlaceholderImageRecord,
  GenericError,
} from "../types";
import {r2Storage} from "../services/r2Storage";
import {db, COLLECTION} from "../config/firebase";
import sharp from "sharp";

export interface ImagePathOptions {
  groupId: string;
  productId: number;
  cardNumber: string;
  isHighRes?: boolean;
  isLowRes?: boolean;
  isNonCard?: boolean;
}

export class ImageHandler {
  private readonly PLACEHOLDER_IMAGE_PATH =
    "/public/assets/image-coming-soon.jpeg";
  private readonly MISSING_IMAGE_IDENTIFIER = "image-missing.svg";
  private readonly MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

  private async loadPlaceholderImage(): Promise<Buffer> {
    try {
      const imagePath = path.join(process.cwd(), this.PLACEHOLDER_IMAGE_PATH);
      return await fs.readFile(imagePath);
    } catch (error) {
      throw new Error(
        `Failed to load placeholder image: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private async recordPlaceholderUse(
    productId: number,
    groupId: string,
    cardNumber: string,
    originalUrl?: string
  ): Promise<void> {
    const record: PlaceholderImageRecord = {
      productId,
      groupId,
      name: cardNumber,
      timestamp: new Date(),
      originalUrl,
    };

    try {
      await db
        .collection(COLLECTION.IMAGE_METADATA)
        .doc(`placeholder_${productId}`)
        .set(record);
    } catch (error) {
      await logWarning("Failed to record placeholder use", {
        productId,
        groupId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  private isPlaceholderNeeded(imageUrl: string): boolean {
    return (
      !imageUrl ||
      imageUrl.includes("image-missing.svg") ||
      imageUrl.endsWith(this.MISSING_IMAGE_IDENTIFIER)
    );
  }

  private sanitizeCardNumber(cardNumber: string | undefined): string {
    if (!cardNumber) {
      throw new Error("Card number is required");
    }
    return cardNumber.replace(/\//g, "_");
  }

  private validateImageUrl(url: string): { isValid: boolean; error?: string } {
    if (!url) {
      return {isValid: false, error: "No URL provided"};
    }

    if (!url.match(/.*\.(jpg|jpeg|svg)$/i)) {
      return {
        isValid: false,
        error: "URL does not match expected format (.jpg, .jpeg, .svg)",
      };
    }

    return {isValid: true};
  }

  private getStoragePath(options: ImagePathOptions): string {
    let suffix = "_200w"; // default to low res
    if (options.isHighRes) {
      suffix = "_400w";
    }

    // For non-card products, use a different path structure
    if (options.isNonCard) {
      return `${options.groupId}/products/${options.productId}${suffix}.jpg`;
    }

    return `${options.groupId}/cards/${
      options.productId
    }_${this.sanitizeCardNumber(options.cardNumber)}${suffix}.jpg`;
  }

  private async getImageHash(imageBuffer: Buffer): Promise<string> {
    return crypto.createHash("md5").update(imageBuffer).digest("hex");
  }

  private async downloadImage(url: string): Promise<Buffer> {
    try {
      // Convert URL to high-res version if it's not already
      const highResUrl = url.replace("_200w.jpg", "_400w.jpg");

      const response = await axios.get(highResUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
        maxContentLength: this.MAX_IMAGE_SIZE,
      });
      return Buffer.from(response.data, "binary");
    } catch (error) {
      // If 400w fails, try falling back to original URL
      if (error instanceof AxiosError && error.response?.status === 404) {
        const response = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: 30000,
          maxContentLength: this.MAX_IMAGE_SIZE,
        });
        return Buffer.from(response.data, "binary");
      }
      if (error instanceof AxiosError) {
        if (error.response?.status === 404) {
          throw new Error(`Image not found at URL: ${url}`);
        }
        throw new Error(
          `Failed to download image: ${error.message} (Status: ${error.response?.status})`
        );
      }
      throw error;
    }
  }

  private async processImage(
    imageBuffer: Buffer,
    productId: number,
    groupId: string
  ): Promise<{
    highResBuffer: Buffer;
    lowResBuffer: Buffer;
    metadata: ImageMetadata;
  }> {
    // Validate image using sharp
    const metadata = await sharp(imageBuffer).metadata();
    if (!metadata.format || !["jpeg", "jpg"].includes(metadata.format)) {
      throw new Error("Invalid image format. Only JPEG images are supported.");
    }

    // Process high-res version (400px width)
    const highResBuffer = await sharp(imageBuffer)
      .resize(400, null, {fit: "inside", withoutEnlargement: true})
      .jpeg({quality: 85, progressive: true})
      .toBuffer();

    // Process low-res version (200px width)
    const lowResBuffer = await sharp(imageBuffer)
      .resize(200, null, {fit: "inside", withoutEnlargement: true})
      .jpeg({quality: 80, progressive: true})
      .toBuffer();

    const originalHash = await this.getImageHash(imageBuffer);

    const imageMetadata: ImageMetadata = {
      contentType: "image/jpeg",
      size: imageBuffer.length,
      updated: new Date(),
      hash: originalHash,
      groupId,
      productId,
      originalSize: imageBuffer.length,
      highResSize: highResBuffer.length,
      lowResSize: lowResBuffer.length,
    };

    return {
      highResBuffer,
      lowResBuffer,
      metadata: imageMetadata,
    };
  }

  public async processAndStoreImage(
    imageUrl: string,
    productId: number,
    groupId: string,
    cardNumber: string,
    isNonCard: boolean = false
  ): Promise<ImageProcessingResult> {
    try {
      // Check if placeholder is needed
      if (this.isPlaceholderNeeded(imageUrl)) {
        return await this.handlePlaceholderImage(
          productId,
          groupId,
          cardNumber
        );
      }

      // Validate URL
      const urlValidation = this.validateImageUrl(imageUrl);
      if (!urlValidation.isValid) {
        throw new Error(urlValidation.error);
      }

      // Download and process image
      const imageBuffer = await this.downloadImage(imageUrl);
      const {highResBuffer, lowResBuffer, metadata} = await this.processImage(
        imageBuffer,
        productId,
        groupId
      );

      // Upload to R2
      const [highResUrl, lowResUrl] = await Promise.all([
        r2Storage.uploadImage(
          highResBuffer,
          this.getStoragePath({
            groupId,
            productId,
            cardNumber,
            isHighRes: true,
            isNonCard,
          }),
          metadata
        ),
        r2Storage.uploadImage(
          lowResBuffer,
          this.getStoragePath({
            groupId,
            productId,
            cardNumber,
            isLowRes: true,
            isNonCard,
          }),
          metadata
        ),
      ]);

      await logInfo("Image processed and stored", {
        productId,
        groupId,
        cardNumber,
        highResUrl,
        lowResUrl,
      });

      return {
        highResUrl,
        lowResUrl,
        metadata,
        updated: true,
      };
    } catch (error) {
      const errorObj: GenericError = {
        message: error instanceof Error ? error.message : "Unknown error",
        name: error instanceof Error ? error.name : "UnknownError",
        code: "IMAGE_PROCESSING_ERROR",
      };
      await logError(errorObj, "Image processing failed");

      return this.handlePlaceholderImage(
        productId,
        groupId,
        cardNumber,
        imageUrl
      );
    }
  }

  private async handlePlaceholderImage(
    productId: number,
    groupId: string,
    cardNumber: string,
    originalUrl?: string
  ): Promise<ImageProcessingResult> {
    try {
      const placeholderBuffer = await this.loadPlaceholderImage();
      const {highResBuffer, lowResBuffer, metadata} = await this.processImage(
        placeholderBuffer,
        productId,
        groupId
      );

      metadata.isPlaceholder = true;

      const [highResUrl, lowResUrl] = await Promise.all([
        r2Storage.uploadImage(
          highResBuffer,
          this.getStoragePath({
            groupId,
            productId,
            cardNumber,
            isHighRes: true,
          }),
          metadata
        ),
        r2Storage.uploadImage(
          lowResBuffer,
          this.getStoragePath({
            groupId,
            productId,
            cardNumber,
            isLowRes: true,
          }),
          metadata
        ),
      ]);

      await this.recordPlaceholderUse(
        productId,
        groupId,
        cardNumber,
        originalUrl
      );

      return {
        highResUrl,
        lowResUrl,
        metadata,
        updated: true,
        isPlaceholder: true,
      };
    } catch (error) {
      const errorObj: GenericError = {
        message: error instanceof Error ? error.message : "Unknown error",
        name: error instanceof Error ? error.name : "UnknownError",
        code: "PLACEHOLDER_PROCESSING_ERROR",
      };
      await logError(errorObj, "Placeholder image processing failed");
      throw error;
    }
  }

  public async getPlaceholderStats(): Promise<{
    total: number;
    byGroup: Record<string, number>;
  }> {
    try {
      const snapshot = await db
        .collection(COLLECTION.IMAGE_METADATA)
        .where("isPlaceholder", "==", true)
        .get();

      const stats = {
        total: snapshot.size,
        byGroup: {} as Record<string, number>,
      };

      snapshot.forEach((doc) => {
        const data = doc.data() as PlaceholderImageRecord;
        stats.byGroup[data.groupId] = (stats.byGroup[data.groupId] || 0) + 1;
      });

      return stats;
    } catch (error) {
      const errorObj: GenericError = {
        message: error instanceof Error ? error.message : "Unknown error",
        name: error instanceof Error ? error.name : "UnknownError",
        code: "STATS_ERROR",
      };
      await logError(errorObj, "Failed to get placeholder stats");
      return {total: 0, byGroup: {}};
    }
  }
}

export const imageHandler = new ImageHandler();
