import { FieldValue } from "firebase-admin/firestore";

export interface CardProduct {
  productId: number;
  name: string;
  cleanName: string;
  imageUrl?: string;
  categoryId: number;
  groupId: number;
  url: string;
  modifiedOn: string;
  imageCount: number;
  extendedData: Array<{
    name: string;
    displayName: string;
    value: string | number;
  }>;
}

export interface CardPrice {
  productId: number;
  normal?: {
    directLowPrice: number | null;
    highPrice: number;
    lowPrice: number;
    marketPrice: number;
    midPrice: number;
    subTypeName: "Normal";
  };
  foil?: {
    directLowPrice: number | null;
    highPrice: number;
    lowPrice: number;
    marketPrice: number;
    midPrice: number;
    subTypeName: "Foil";
  };
  lastUpdated: Date;
}

export interface HistoricalPrice {
  productId: number;
  date: Date;
  normal?: {
    directLow: number | null;
    high: number;
    low: number;
    market: number;
    mid: number;
  };
  foil?: {
    directLow: number | null;
    high: number;
    low: number;
    market: number;
    mid: number;
  };
  groupId: string;
}

export interface SyncTiming {
  startTime: Date;
  endTime?: Date;
  duration?: number;
  groupStartTime?: Date;
  imageStartTime?: Date;
  lastUpdateTime?: Date;
}

export interface SyncResult {
  success: boolean;
  itemsProcessed: number;
  itemsUpdated: number;
  errors: string[];
  timing: SyncTiming;
}

export interface CardHashData {
  name: string;
  cleanName: string;
  modifiedOn: string;
  extendedData: Array<{
    name: string;
    displayName: string;
    value: string | number | number | null | string[];
  }>;
}

export interface SyncOptions {
  groupId?: string;
  forceUpdate?: boolean;
  skipImages?: boolean;
  imagesOnly?: boolean;
  silent?: boolean;
  dryRun?: boolean;
}

export interface CardChanges {
  productId: number;
  name: string;
  cleanName: string;
  fullResUrl: string;
  highResUrl: string;
  lowResUrl: string;
  lastUpdated: FieldValue;
  groupId: number;
  isNonCard: boolean;
  cardNumbers: string[];
  primaryCardNumber: string;
}

export interface PriceChanges {
  productId: number;
  lastUpdated: FieldValue;
  groupId: number;
  normal?: {
    directLowPrice: number | null;
    highPrice: number;
    lowPrice: number;
    marketPrice: number;
    midPrice: number;
    subTypeName: "Normal";
  };
  foil?: {
    directLowPrice: number | null;
    highPrice: number;
    lowPrice: number;
    marketPrice: number;
    midPrice: number;
    subTypeName: "Foil";
  };
}
