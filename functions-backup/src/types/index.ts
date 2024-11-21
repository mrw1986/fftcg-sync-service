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
    categoryId: number;
    groupId: number;
    url: string;
    modifiedOn: string;
    imageCount: number;
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
  }

export type CacheType = "card" | "price";

export interface PriceData {
    normal?: CardPrice;
    foil?: CardPrice;
    lastUpdated: Date;
  }

export type LogData = any;
export type GenericObject = Record<string, any>;
