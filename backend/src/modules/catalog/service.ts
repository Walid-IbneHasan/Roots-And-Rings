import type { PrismaClient, Prisma } from '@prisma/client';
import { mapProduct, mapCollection, type ProductDTO, type CollectionDTO } from '../../lib/mappers';
import type { ProductsQuery } from './schemas';

const include = { category: true, images: true, collections: true, variants: true } satisfies Prisma.ProductInclude;

const PRODUCT_TYPE_ORDER = ['Vessels', 'Bowls', 'Plates', 'Sculptural', 'Tableware'];
const BODY_TYPE_ORDER = ['Stoneware', 'Porcelain', 'Earthenware'];
const BADGE_ORDER = ['Limited Edition', 'Made to Order'];

function sortToOrderBy(sort: ProductsQuery['sort']): Prisma.ProductOrderByWithRelationInput {
  switch (sort) {
    case 'price-asc':
      return { basePrice: 'asc' };
    case 'price-desc':
      return { basePrice: 'desc' };
    case 'name':
      return { name: 'asc' };
    case 'newest':
    default:
      return { createdAt: 'desc' };
  }
}

async function fulltextIds(prisma: PrismaClient, q: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM Product
    WHERE isActive = 1
      AND MATCH(name, shortDescription) AGAINST (${q} IN NATURAL LANGUAGE MODE)
  `;
  return rows.map((r) => r.id);
}

export interface ProductListResult {
  items: ProductDTO[];
  total: number;
  page: number;
  pageSize: number;
  facets: Facets;
}

export interface Facets {
  categories: string[];
  bodyTypes: string[];
  attributes: string[];
}

export async function getFacets(prisma: PrismaClient): Promise<Facets> {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { bodyType: true, badges: true, category: { select: { name: true } } },
  });
  const cats = new Set<string>();
  const clays = new Set<string>();
  const attrs = new Set<string>();
  for (const p of products) {
    if (p.category?.name) cats.add(p.category.name);
    if (p.bodyType) clays.add(p.bodyType);
    if (Array.isArray(p.badges)) for (const b of p.badges as string[]) attrs.add(b);
  }
  const order = (set: Set<string>, ref: string[]) => ref.filter((x) => set.has(x)).concat([...set].filter((x) => !ref.includes(x)));
  return {
    categories: order(cats, PRODUCT_TYPE_ORDER),
    bodyTypes: order(clays, BODY_TYPE_ORDER),
    attributes: order(attrs, BADGE_ORDER),
  };
}

export async function listProducts(prisma: PrismaClient, q: ProductsQuery): Promise<ProductListResult> {
  const now = new Date();
  const where: Prisma.ProductWhereInput = { isActive: true };
  if (q.category) where.category = { slug: q.category };
  if (q.bodyType) where.bodyType = q.bodyType;
  if (q.minPrice != null || q.maxPrice != null) {
    where.basePrice = {};
    if (q.minPrice != null) (where.basePrice as Prisma.DecimalFilter).gte = q.minPrice;
    if (q.maxPrice != null) (where.basePrice as Prisma.DecimalFilter).lte = q.maxPrice;
  }
  if (q.q) {
    const ids = await fulltextIds(prisma, q.q);
    where.id = { in: ids.length ? ids : ['__none__'] };
  }

  const rows = await prisma.product.findMany({ where, include, orderBy: sortToOrderBy(q.sort) });
  let items = rows.map((r) => mapProduct(r, now));

  if (q.attribute) items = items.filter((i) => i.badges.includes(q.attribute!));
  if (q.onSale) items = items.filter((i) => i.isOnSale || i.isOnFlash);

  // Sort by the EFFECTIVE (resolved) price so ordering matches the prices shoppers see (sales applied).
  if (q.sort === 'price-asc') items.sort((a, b) => a.price - b.price);
  else if (q.sort === 'price-desc') items.sort((a, b) => b.price - a.price);

  const total = items.length;
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? (total || 1);
  if (q.page || q.pageSize) items = items.slice((page - 1) * pageSize, page * pageSize);

  const facets = await getFacets(prisma);
  return { items, total, page, pageSize, facets };
}

export async function getProductBySlug(prisma: PrismaClient, slug: string): Promise<ProductDTO | null> {
  const row = await prisma.product.findFirst({ where: { slug, isActive: true }, include });
  return row ? mapProduct(row) : null;
}

export async function getRelated(prisma: PrismaClient, slug: string, limit = 4): Promise<ProductDTO[]> {
  const product = await prisma.product.findUnique({ where: { slug }, select: { id: true, categoryId: true } });
  if (!product) return [];
  const rows = await prisma.product.findMany({
    where: { isActive: true, id: { not: product.id }, ...(product.categoryId ? { categoryId: product.categoryId } : {}) },
    include,
    take: limit,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => mapProduct(r));
}

export async function getFeatured(prisma: PrismaClient): Promise<ProductDTO[]> {
  const rows = await prisma.product.findMany({
    where: { isActive: true, isFeatured: true },
    include,
    orderBy: [{ featuredOrder: 'asc' }, { createdAt: 'desc' }],
  });
  return rows.map((r) => mapProduct(r));
}

export async function getFlashProducts(prisma: PrismaClient, limit = 8): Promise<ProductDTO[]> {
  const now = new Date();
  const rows = await prisma.product.findMany({
    where: {
      isActive: true,
      flashPrice: { not: null },
      flashStartAt: { lte: now },
      flashEndAt: { gte: now },
    },
    orderBy: { flashEndAt: 'asc' },
    include,
  });
  return rows.map((r) => mapProduct(r, now)).filter((p) => p.isOnFlash).slice(0, limit);
}

export async function getCollections(prisma: PrismaClient): Promise<CollectionDTO[]> {
  const rows = await prisma.category.findMany({
    where: { kind: 'COLLECTION', isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return rows.map(mapCollection);
}

export async function getCollectionBySlug(prisma: PrismaClient, slug: string) {
  const row = await prisma.category.findFirst({ where: { slug, kind: 'COLLECTION' } });
  return row ? mapCollection(row) : null;
}

export async function getProductsByCollection(prisma: PrismaClient, slug: string): Promise<ProductDTO[]> {
  const now = new Date();
  const rows = await prisma.product.findMany({
    where: { isActive: true, collections: { some: { slug, kind: 'COLLECTION' } } },
    include,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => mapProduct(r, now));
}
