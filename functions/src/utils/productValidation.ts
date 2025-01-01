// src/utils/productValidation.ts
import {CardProduct} from "../types";

export interface ProductValidationResult {
  isValid: boolean;
  reason?: string;
  isNonCard?: boolean;
}

const NON_CARD_KEYWORDS = [
  "booster",
  "box",
  "pack",
  "bundle",
  "collection",
  "starter deck",
  "boss deck",
  "display",
  "case",
  "kit",
];

export function isNonCardProduct(name: string): boolean {
  return NON_CARD_KEYWORDS.some((keyword) =>
    name.toLowerCase().includes(keyword.toLowerCase())
  );
}

export function validateFFTCGProduct(
  product: CardProduct
): ProductValidationResult {
  // Check if product name contains non-card keywords
  if (isNonCardProduct(product.name)) {
    return {
      isValid: true,
      isNonCard: true,
      reason: `Product is a ${NON_CARD_KEYWORDS.find((k) =>
        product.name.toLowerCase().includes(k.toLowerCase())
      )}`,
    };
  }

  // Try to extract and validate card number from extendedData
  try {
    const numberField = product.extendedData.find(
      (data) => data.name === "Number"
    );

    if (!numberField) {
      return {
        isValid: false,
        reason: `Missing card number for productId: ${product.productId}`,
      };
    }

    // Check if it's a promo card
    const isPromo = product.extendedData.some(
      (data) => data.name === "extNumber"
    );

    if (isPromo) {
      const extNumber = product.extendedData.find(
        (data) => data.name === "extNumber"
      );
      if (!extNumber) {
        return {
          isValid: false,
          reason: `Missing extNumber for promo productId: ${product.productId}`,
        };
      }
    }

    return {isValid: true, isNonCard: false};
  } catch (error) {
    return {
      isValid: false,
      reason: `Failed to validate card: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    };
  }
}
