import type { Product, Collection } from './schema';

const API_BASE = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';

async function getJson<T>(path: string): Promise<T | undefined> {
  const res = await fetch(`${API_BASE}${path}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return (await res.json()) as T;
}

interface ApiImage {
  src: string;
  alt: string;
}
interface ApiProduct {
  slug: string;
  name: string;
  subtitle: string | null;
  price: number;
  currency: string;
  category: { slug: string; name: string } | null;
  categoryName: string | null;
  clayBody: string | null;
  badges: string[];
  shortDescription: string;
  description: string;
  curatorsNote: string | null;
  specs: Record<string, unknown>;
  edition: unknown;
  seenInInteriors: unknown;
  images: ApiImage[];
  isFeatured: boolean;
  createdAt: string;
  ratingAvg?: number | null;
  ratingCount?: number;
  availability?: 'in_stock' | 'out_of_stock' | 'backorder';
  compareAt?: number | null;
  isOnSale?: boolean;
  isOnFlash?: boolean;
}
interface ApiCollection {
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  image: { src: string | null; alt: string };
}

function toProduct(p: ApiProduct): Product {
  return {
    slug: p.slug,
    name: p.name,
    subtitle: p.subtitle ?? '',
    price: p.price,
    currency: p.currency,
    category: p.categoryName ?? p.category?.name ?? '',
    clayBody: p.clayBody ?? '',
    badges: p.badges ?? [],
    shortDescription: p.shortDescription,
    description: p.description,
    curatorsNote: p.curatorsNote ?? '',
    specs: p.specs as Product['specs'],
    edition: (p.edition ?? undefined) as Product['edition'],
    images: (p.images ?? []).map((i) => ({ src: i.src, alt: i.alt })),
    relatedSlugs: [],
    seenInInteriors: (p.seenInInteriors ?? undefined) as Product['seenInInteriors'],
    featured: p.isFeatured,
    createdAt: p.createdAt,
    ratingAvg: p.ratingAvg ?? null,
    ratingCount: p.ratingCount ?? 0,
    availability: p.availability ?? 'in_stock',
    compareAt: p.compareAt ?? null,
    isOnSale: p.isOnSale ?? false,
    isOnFlash: p.isOnFlash ?? false,
  };
}

function toCollection(c: ApiCollection): Collection {
  return {
    slug: c.slug,
    name: c.name,
    tagline: c.tagline ?? '',
    description: c.description ?? '',
    image: { src: c.image?.src ?? '', alt: c.image?.alt ?? c.name },
  };
}

export async function fetchProducts(): Promise<Product[]> {
  const data = await getJson<{ items: ApiProduct[] }>('/api/products');
  return (data?.items ?? []).map(toProduct);
}
export async function fetchProduct(slug: string): Promise<Product | undefined> {
  const p = await getJson<ApiProduct>(`/api/products/${encodeURIComponent(slug)}`);
  return p ? toProduct(p) : undefined;
}
export async function fetchFeatured(): Promise<Product[]> {
  return ((await getJson<ApiProduct[]>('/api/featured')) ?? []).map(toProduct);
}
export async function fetchFlash(): Promise<Product[]> {
  const res = await fetch(`${API_BASE}/api/products/flash`);
  if (!res.ok) return [];
  return (await res.json()).map(toProduct);
}
export async function fetchRelated(slug: string): Promise<Product[]> {
  return ((await getJson<ApiProduct[]>(`/api/products/${encodeURIComponent(slug)}/related`)) ?? []).map(toProduct);
}
export async function fetchCollections(): Promise<Collection[]> {
  return ((await getJson<ApiCollection[]>('/api/collections')) ?? []).map(toCollection);
}
export async function fetchFacets(): Promise<{ categories: string[]; clayBodies: string[]; attributes: string[] }> {
  return (
    (await getJson<{ categories: string[]; clayBodies: string[]; attributes: string[] }>('/api/facets')) ?? {
      categories: [],
      clayBodies: [],
      attributes: [],
    }
  );
}
