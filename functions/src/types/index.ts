// functions/src/types/index.ts

export interface GenericError extends Error {
  code?: string;
  message: string;
  stack?: string;
}

export interface CardProduct {
  productId: number;
  name: string;
  cleanName: string;
  imageUrl: string;
  storageImageUrl?: string; // Added for Firebase Storage URL
  categoryId: number;
  groupId: number;
  url: string;
  modifiedOn: string;
  imageCount: number;
  imageMetadata?: ImageMetadata; // Added for image metadata
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
}

export interface SyncOptions {
  dryRun?: boolean;
  limit?: number;
  groupId?: string;
  productId?: number;
  showAll?: boolean;
  skipImages?: boolean; // Added to optionally skip image processing
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
  imagesProcessed?: number; // Added for image tracking
  imagesUpdated?: number; // Added for image tracking
}

export type CacheType = "card" | "price" | "image";

export interface PriceData {
  normal?: CardPrice;
  foil?: CardPrice;
  lastUpdated: Date;
}

// New interfaces for image handling
export interface ImageMetadata {
  contentType: string;
  size: number;
  updated: Date;
  hash: string;
  originalUrl: string;
  highResUrl: string;
  groupId?: string;
  productId?: number;
  lastUpdated?: Date;
}

export interface ImageProcessingResult {
  url: string;
  metadata: ImageMetadata;
  updated: boolean;
}

export interface ImageSyncStats {
  processed: number;
  updated: number;
  failed: number;
  skipped: number;
}

// Update existing interfaces
export interface LogData {
  imageMetadata?: ImageMetadata;
  imageSyncStats?: ImageSyncStats;
  [key: string]: any;
}

// Cache interfaces
export interface CacheOptions {
  max: number;
  ttl: number;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expires: number;
}

// Error types
export interface ImageProcessingError extends GenericError {
  productId: number;
  groupId: string;
  originalUrl: string;
  type: "download" | "upload" | "metadata" | "unknown";
}

export type GenericObject = Record<string, any>;

// Batch processing types
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

// Enhanced logging types for image processing
export interface ImageLogEntry {
  timestamp: Date;
  level: "INFO" | "WARNING" | "ERROR";
  message: string;
  context?: string;
  metadata?: ImageMetadata;
  error?: ImageProcessingError;
  stats?: ImageSyncStats;
}

// Storage types
export interface StoragePaths {
  original: string;
  processed: string;
}

export interface StorageOptions {
  contentType: string;
  metadata?: Record<string, string>;
  cacheControl?: string;
}

// Progress tracking for image processing
export interface ImageProcessingProgress {
  total: number;
  current: number;
  updated: number;
  failed: number;
  startTime: number;
  estimatedTimeRemaining?: number;
}
