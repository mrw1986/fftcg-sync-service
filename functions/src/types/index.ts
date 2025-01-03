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
    value: string;
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
    value: string;
  }>;
}
