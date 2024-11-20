import LRUCache from "lru-cache";
import {CacheType, CardProduct} from "../types";

const options = {
  max: 500,
  ttl: 1000 * 60 * 60, // 1 hour
};

export const cardCache = new LRUCache<string, CardProduct>(options);

export const getCacheKey = (type: CacheType, id: number): string => {
  return `${type}:${id}`;
};
