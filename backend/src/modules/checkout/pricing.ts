import type { PrismaClient } from '@prisma/client';
import { resolvePrice } from '../../lib/pricing';
import { round2 } from '../../lib/money';
import { httpError } from '../../lib/errors';

const num = (d: { toString(): string } | number | null | undefined): number | null => (d == null ? null : Number(d));

export interface PricedLine {
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  unitPrice: number;
  qty: number;
}

/** Resolve slugs → active products + default variant, re-price server-side, return lines + subtotal. */
export async function priceItems(prisma: PrismaClient, items: { slug: string; qty: number }[]): Promise<{ lines: PricedLine[]; subtotal: number }> {
  const lines: PricedLine[] = [];
  for (const it of items) {
    const product = await prisma.product.findFirst({
      where: { slug: it.slug, isActive: true },
      include: { variants: { where: { isActive: true }, orderBy: { position: 'asc' } } },
    });
    if (!product) throw httpError(400, `Unknown or unavailable product: ${it.slug}`);
    const variant = product.variants[0];
    if (!variant) throw httpError(400, `No purchasable variant for ${product.name}`);
    if (it.qty < product.minPerOrder) throw httpError(400, `Minimum ${product.minPerOrder} for ${product.name}`);
    if (product.maxPerOrder && it.qty > product.maxPerOrder) throw httpError(400, `Maximum ${product.maxPerOrder} for ${product.name}`);
    const priced = resolvePrice(
      {
        basePrice: num(product.basePrice)!,
        salePrice: num(product.salePrice),
        flashPrice: num(product.flashPrice),
        flashStartAt: product.flashStartAt,
        flashEndAt: product.flashEndAt,
        currency: product.currency,
      },
      new Date(),
    );
    lines.push({
      productId: product.id,
      variantId: variant.id,
      productName: product.name,
      variantName: variant.name,
      sku: variant.sku,
      unitPrice: priced.price,
      qty: it.qty,
    });
  }
  const subtotal = round2(lines.reduce((s, l) => s + round2(l.unitPrice * l.qty), 0));
  return { lines, subtotal };
}
