import type { Product, Collection } from './schema';
import * as api from './api';

/**
 * Catalog data-access layer. Signatures are unchanged from the mock-data version, but
 * the bodies now read live data from the Fastify backend via `api.ts`. Components are
 * untouched. (Storefront filtering on /products stays client-side, so getProducts()
 * returns the full set.)
 */

export type SortKey = 'newest' | 'price-asc' | 'price-desc';

export interface ProductQuery {
  categories?: string[];
  bodyTypes?: string[];
  attributes?: string[];
  onSale?: boolean;
  sort?: SortKey;
}

function sortProducts(list: Product[], sort: SortKey): Product[] {
  const out = [...list];
  switch (sort) {
    case 'price-asc':
      return out.sort((a, b) => a.price - b.price);
    case 'price-desc':
      return out.sort((a, b) => b.price - a.price);
    case 'newest':
    default:
      return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }
}

export async function getProducts(query: ProductQuery = {}): Promise<Product[]> {
  const { categories, bodyTypes, attributes, onSale, sort = 'newest' } = query;
  let list = await api.fetchProducts();

  if (categories?.length) list = list.filter((p) => categories.includes(p.category));
  if (bodyTypes?.length) list = list.filter((p) => bodyTypes.includes(p.bodyType));
  if (attributes?.length) list = list.filter((p) => attributes.some((a) => p.badges.includes(a)));
  if (onSale) list = list.filter((p) => p.isOnSale || p.isOnFlash);

  return sortProducts(list, sort);
}

export async function getProduct(slug: string): Promise<Product | undefined> {
  return api.fetchProduct(slug);
}

export async function getAllSlugs(): Promise<string[]> {
  return (await api.fetchProducts()).map((p) => p.slug);
}

export async function getRelated(slug: string, limit = 4): Promise<Product[]> {
  return (await api.fetchRelated(slug)).slice(0, limit);
}

export async function getFeatured(): Promise<Product[]> {
  return api.fetchFeatured();
}

export async function getFlash(): Promise<Product[]> {
  return api.fetchFlash();
}

export async function getCollections(): Promise<Collection[]> {
  return api.fetchCollections();
}

export async function getCollection(slug: string): Promise<Collection | undefined> {
  return (await api.fetchCollections()).find((c) => c.slug === slug);
}

export async function getCollectionProducts(slug: string): Promise<Product[]> {
  return api.fetchCollectionProducts(slug);
}

export interface Facets {
  categories: string[];
  bodyTypes: string[];
  attributes: string[];
}

export async function getFacets(): Promise<Facets> {
  return api.fetchFacets();
}
