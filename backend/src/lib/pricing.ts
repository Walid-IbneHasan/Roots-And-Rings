export interface PriceInput {
  basePrice: number;
  salePrice?: number | null;
  flashPrice?: number | null;
  flashStartAt?: Date | null;
  flashEndAt?: Date | null;
  currency: string;
}

export interface ResolvedPrice {
  price: number;
  compareAt: number | null;
  isOnSale: boolean;
  isOnFlash: boolean;
  currency: string;
}

/**
 * Read-time price resolution: flash → sale → base. Flash applies only while
 * now ∈ [flashStartAt, flashEndAt] and flashPrice < basePrice (auto-reverts after).
 */
export function resolvePrice(input: PriceInput, now: Date = new Date()): ResolvedPrice {
  const { basePrice, salePrice, flashPrice, flashStartAt, flashEndAt, currency } = input;

  const flashActive =
    flashPrice != null &&
    flashStartAt != null &&
    flashEndAt != null &&
    now >= flashStartAt &&
    now <= flashEndAt &&
    flashPrice < basePrice;

  if (flashActive) {
    return { price: flashPrice!, compareAt: basePrice, isOnSale: false, isOnFlash: true, currency };
  }

  const saleActive = salePrice != null && salePrice < basePrice;
  if (saleActive) {
    return { price: salePrice!, compareAt: basePrice, isOnSale: true, isOnFlash: false, currency };
  }

  return { price: basePrice, compareAt: null, isOnSale: false, isOnFlash: false, currency };
}

export interface VariantPriceOverride {
  price?: number | null;
  salePrice?: number | null;
}

/**
 * Resolve a variant's price: variant overrides product price/sale when non-null,
 * otherwise inherits product values. Flash window is taken from the product.
 */
export function resolveVariantPrice(
  product: PriceInput,
  variant: VariantPriceOverride,
  now: Date = new Date(),
): ResolvedPrice {
  const basePrice = variant.price != null ? variant.price : product.basePrice;
  const salePrice = variant.price != null ? variant.salePrice ?? null : product.salePrice ?? null;
  return resolvePrice(
    {
      basePrice,
      salePrice,
      flashPrice: product.flashPrice ?? null,
      flashStartAt: product.flashStartAt ?? null,
      flashEndAt: product.flashEndAt ?? null,
      currency: product.currency,
    },
    now,
  );
}
