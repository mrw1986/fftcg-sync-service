// src/utils/imageCompressor.ts

import sharp from "sharp";
import {logInfo} from "./logger";

export interface CompressionResult {
  buffer: Buffer;
  info: {
    width: number;
    height: number;
    size: number;
    format: string;
    quality: number;
  };
}

export class ImageCompressor {
  private static readonly QUALITY = {
    HIGH_RES: 90,
    LOW_RES: 85,
  };

  private static readonly DIMENSIONS = {
    HIGH_RES: 400,
    LOW_RES: 200,
  };

  static async compress(
    buffer: Buffer,
    isHighRes: boolean = false
  ): Promise<CompressionResult> {
    try {
      const quality = isHighRes ? this.QUALITY.HIGH_RES : this.QUALITY.LOW_RES;
      const targetWidth = isHighRes ? this.DIMENSIONS.HIGH_RES : this.DIMENSIONS.LOW_RES;

      const originalInfo = await sharp(buffer).metadata();
      const originalSize = buffer.length;

      const image = sharp(buffer).jpeg({
        quality,
        progressive: true,
        mozjpeg: true,
      });

      if (originalInfo.width && originalInfo.width > targetWidth) {
        image.resize(targetWidth, null, {
          fit: "inside",
          withoutEnlargement: true,
        });
      }

      const compressedBuffer = await image.toBuffer();
      const compressedInfo = await sharp(compressedBuffer).metadata();

      await logInfo("Image compression complete", {
        originalSize,
        compressedSize: compressedBuffer.length,
        dimensions: `${compressedInfo.width}x${compressedInfo.height}`,
        quality,
        timestamp: new Date().toISOString(),
      });

      return {
        buffer: compressedBuffer,
        info: {
          width: compressedInfo.width || 0,
          height: compressedInfo.height || 0,
          size: compressedBuffer.length,
          format: compressedInfo.format || "jpeg",
          quality,
        },
      };
    } catch (error) {
      throw new Error(
        `Image compression failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  static async isCompressible(buffer: Buffer): Promise<boolean> {
    try {
      const info = await sharp(buffer).metadata();
      return info.format === "jpeg" || info.format === "jpg";
    } catch {
      return false;
    }
  }
}
