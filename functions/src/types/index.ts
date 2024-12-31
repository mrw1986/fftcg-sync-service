// src/types/index.ts

import type * as express from "express";

export {express};

export interface GenericError extends Error {
  code?: string;
  message: string;
  stack?: string;
}

export interface MigrationResult {
  success: boolean;
  error?: string;
  stats: {
    processed: number;
    skipped: number;
    errors: string[];
  };
}

export interface CardProduct {
  productId: number;
  name: string;
  cleanName: string;
  imageUrl?: string; // TCGPlayer URL (from API)
  highResUrl: string; // Firebase Storage URL (_400w)
  lowResUrl: string; // Firebase Storage URL (_200w)
  categoryId: number;
  groupId: number;
  url: string;
  modifiedOn: string;
  imageCount: number;
  imageMetadata?: ImageMetadata;
  extendedData: Array<{
    name: string;
    displayName: string;
    value: string;
  }>;
}

export interface CardPrice {
  productId: number;
  lowPrice: number;
  midPrice: number;
  highPrice: number;
  marketPrice: number | null;
  directLowPrice: number | null;
  subTypeName: "Normal" | "Foil";
  cardNumber?: string; // Add this if cardNumber exists
}

export interface SyncOptions {
  dryRun?: boolean;
  limit?: number;
  groupId?: string;
  productId?: number;
  showAll?: boolean;
  skipImages?: boolean;
  imagesOnly?: boolean; // New option
  silent?: boolean;
  force?: boolean;
}

export interface SyncMetadata {
  lastSync: Date;
  status: "in_progress" | "success" | "failed" | "completed_with_errors";
  cardCount: number;
  type: "manual" | "scheduled";
  groupsProcessed: number;
  groupsUpdated: number;
  errors: string[];
  duration?: number;
  imagesProcessed?: number;
  imagesUpdated?: number;
}

export type CacheType = "card" | "price" | "image";

export interface PriceData {
  normal?: CardPrice;
  foil?: CardPrice;
  lastUpdated: Date;
  productId: number;
  cardNumber: string;
}

export interface ImageMetadata {
  contentType: string;
  size: number;
  updated: Date;
  hash: string;
  groupId?: string;
  productId?: number;
  cardNumber?: string;
  lastUpdated?: Date;
  originalSize?: number;
  highResSize?: number;
  lowResSize?: number;
}

export interface ImageProcessingResult {
  highResUrl: string; // Firebase Storage URL (_400w)
  lowResUrl: string; // Firebase Storage URL (_200w)
  metadata: ImageMetadata;
  updated: boolean;
}

export interface ImageSyncStats {
  processed: number;
  updated: number;
  failed: number;
  skipped: number;
}

export interface LogData {
  imageMetadata?: ImageMetadata;
  imageSyncStats?: ImageSyncStats;
  [key: string]: any;
}

export interface CacheOptions {
  max: number;
  ttl: number;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expires: number;
}

export interface ImageProcessingError extends GenericError {
  productId: number;
  groupId: string;
  originalUrl: string;
  type: "download" | "upload" | "metadata" | "unknown";
}

export type GenericObject = Record<string, any>;

export interface BatchProcessingStats {
  total: number;
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
}

export interface BatchOptions {
  batchSize?: number;
  delayBetweenBatches?: number;
  onBatchComplete?: (stats: BatchProcessingStats) => Promise<void>;
  skipImages?: boolean;
  retryFailedImages?: boolean;
}

export interface BatchProgress {
  totalBatches: number;
  currentBatch: number;
  processedCount: number;
  totalItems: number;
}

export interface ImageLogEntry {
  timestamp: Date;
  level: "INFO" | "WARNING" | "ERROR";
  message: string;
  context?: string;
  metadata?: ImageMetadata;
  error?: ImageProcessingError;
  stats?: ImageSyncStats;
}

export interface StoragePaths {
  original: string;
  processed: string;
}

export interface StorageOptions {
  contentType: string;
  metadata?: Record<string, string>;
  cacheControl?: string;
}

export interface ImageProcessingProgress {
  total: number;
  current: number;
  updated: number;
  failed: number;
  startTime: number;
  estimatedTimeRemaining?: number;
}

export interface ImageValidationError {
  code: "FILE_TOO_LARGE" | "INVALID_FORMAT" | "VALIDATION_ERROR";
  message: string;
}

export interface SyncMode {
  type: "data" | "images" | "full";
  isForced: boolean;
  isDryRun: boolean;
}

export interface RefreshOptions {
  isDryRun: boolean;
  isVerbose: boolean;
  isForce: boolean;
  groupId?: string;
  skipImages: boolean;
  imagesOnly: boolean;
}
