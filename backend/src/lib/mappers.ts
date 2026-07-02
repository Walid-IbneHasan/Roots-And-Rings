import type { Prisma } from '@prisma/client';
import { env } from '../env';
import { resolvePrice } from './pricing';

function num(d: Prisma.Decimal | number | null | undefined): number | null {
  if (d == null) return null;
  return typeof d === 'number' ? d : Number(d);
}

export type Availability = 'in_stock' | 'out_of_stock' | 'backorder';

/** Product-level availability from active-variant stock + backorder policy. */
export function computeAvailability(
  variants: { isActive: boolean; stock: number }[],
  allowBackorder: boolean,
): Availability {
  const inStock = variants.some((v) => v.isActive && v.stock > 0);
  if (inStock) return 'in_stock';
  return allowBackorder ? 'backorder' : 'out_of_stock';
}

/** Prefix root-relative upload paths with APP_URL so a cross-origin storefront can load them. */
export function absUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  return `${env.APP_URL}${u.startsWith('/') ? '' : '/'}${u}`;
}

export interface ImageDTO {
  src: string;
  alt: string;
  isPrimary: boolean;
  width: number | null;
  height: number | null;
}
export interface RefDTO {
  slug: string;
  name: string;
}
export interface ProductDTO {
  slug: string;
  name: string;
  subtitle: string | null;
  sku: string;
  price: number;
  compareAt: number | null;
  isOnSale: boolean;
  isOnFlash: boolean;
  currency: string;
  category: RefDTO | null;
  categoryName: string | null;
  bodyType: string | null;
  badges: string[];
  shortDescription: string;
  description: string;
  curatorsNote: string | null;
  specs: Record<string, unknown>;
  edition: unknown | null;
  seenInInteriors: unknown | null;
  images: ImageDTO[];
  collections: RefDTO[];
  isFeatured: boolean;
  featuredOrder: number | null;
  createdAt: string;
  publishedAt: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  availability: Availability;
}
export interface CollectionDTO {
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  image: { src: string | null; alt: string };
}

type ProductWithRelations = Prisma.ProductGetPayload<{
  include: { category: true; images: true; collections: true; variants: true };
}>;

export function mapProduct(p: ProductWithRelations, now: Date = new Date()): ProductDTO {
  const resolved = resolvePrice(
    {
      basePrice: num(p.basePrice)!,
      salePrice: num(p.salePrice),
      flashPrice: num(p.flashPrice),
      flashStartAt: p.flashStartAt,
      flashEndAt: p.flashEndAt,
      currency: p.currency,
    },
    now,
  );

  const images = [...p.images]
    .sort((a, b) => a.position - b.position)
    .map((im) => ({
      src: absUrl(im.url)!,
      alt: im.alt ?? p.name,
      isPrimary: im.isPrimary,
      width: im.width ?? null,
      height: im.height ?? null,
    }));

  return {
    slug: p.slug,
    name: p.name,
    subtitle: p.subtitle ?? null,
    sku: p.sku,
    price: resolved.price,
    compareAt: resolved.compareAt,
    isOnSale: resolved.isOnSale,
    isOnFlash: resolved.isOnFlash,
    currency: resolved.currency,
    category: p.category ? { slug: p.category.slug, name: p.category.name } : null,
    categoryName: p.category?.name ?? null,
    bodyType: p.bodyType ?? null,
    badges: Array.isArray(p.badges) ? (p.badges as string[]) : [],
    shortDescription: p.shortDescription,
    description: p.description,
    curatorsNote: p.curatorsNote ?? null,
    specs: (p.specs as Record<string, unknown>) ?? {},
    edition: p.edition ?? null,
    seenInInteriors: p.seenInInteriors ?? null,
    images,
    collections: p.collections.map((c) => ({ slug: c.slug, name: c.name })),
    isFeatured: p.isFeatured,
    featuredOrder: p.featuredOrder ?? null,
    createdAt: p.createdAt.toISOString(),
    publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
    ratingAvg: num(p.ratingAvg),
    ratingCount: p.ratingCount,
    availability: computeAvailability(p.variants, p.allowBackorder),
  };
}

export function mapCollection(c: {
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  imageUrl: string | null;
}): CollectionDTO {
  return {
    slug: c.slug,
    name: c.name,
    tagline: c.tagline,
    description: c.description,
    image: { src: absUrl(c.imageUrl), alt: c.name },
  };
}
