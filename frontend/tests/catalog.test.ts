import { describe, it, expect } from 'vitest';
import {
  getProducts,
  getProduct,
  getRelated,
  getFeatured,
  getCollections,
  getFacets,
} from '../src/lib/catalog';

describe('getProducts', () => {
  it('returns all products with no options', async () => {
    const all = await getProducts();
    expect(all.length).toBeGreaterThanOrEqual(12);
  });

  it('filters by a single category', async () => {
    const vessels = await getProducts({ categories: ['Vessels'] });
    expect(vessels.length).toBeGreaterThan(0);
    expect(vessels.every((p) => p.category === 'Vessels')).toBe(true);
  });

  it('filters by clay body', async () => {
    const porcelain = await getProducts({ bodyTypes: ['Porcelain'] });
    expect(porcelain.every((p) => p.bodyType === 'Porcelain')).toBe(true);
  });

  it('filters by attribute badge', async () => {
    const limited = await getProducts({ attributes: ['Limited Edition'] });
    expect(limited.length).toBeGreaterThan(0);
    expect(limited.every((p) => p.badges.includes('Limited Edition'))).toBe(true);
  });

  it('sorts by price ascending', async () => {
    const sorted = await getProducts({ sort: 'price-asc' });
    const prices = sorted.map((p) => p.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('sorts by price descending', async () => {
    const sorted = await getProducts({ sort: 'price-desc' });
    const prices = sorted.map((p) => p.price);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
  });

  it('sorts by newest by default', async () => {
    const sorted = await getProducts({ sort: 'newest' });
    const dates = sorted.map((p) => p.createdAt);
    expect(dates).toEqual([...dates].sort((a, b) => (a < b ? 1 : -1)));
  });

  it('combines category and clay body filters', async () => {
    const r = await getProducts({ categories: ['Bowls'], bodyTypes: ['Earthenware'] });
    expect(r.every((p) => p.category === 'Bowls' && p.bodyType === 'Earthenware')).toBe(true);
  });
});

describe('getProduct', () => {
  it('returns a product by slug', async () => {
    const p = await getProduct('the-kura-vessel');
    expect(p?.name).toBe('The Kura Vessel');
  });

  it('returns undefined for an unknown slug', async () => {
    expect(await getProduct('does-not-exist')).toBeUndefined();
  });
});

describe('getRelated', () => {
  it('returns related products excluding the product itself', async () => {
    const related = await getRelated('the-kura-vessel');
    expect(related.length).toBeGreaterThan(0);
    expect(related.some((p) => p.slug === 'the-kura-vessel')).toBe(false);
  });

  it('limits the number of related products', async () => {
    const related = await getRelated('the-kura-vessel', 3);
    expect(related.length).toBeLessThanOrEqual(3);
  });
});

describe('getFeatured', () => {
  it('returns only featured products', async () => {
    const f = await getFeatured();
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((p) => p.featured)).toBe(true);
  });
});

describe('getCollections', () => {
  it('returns collections', async () => {
    const c = await getCollections();
    expect(c.some((x) => x.slug === 'the-first-firing')).toBe(true);
  });
});

describe('getFacets', () => {
  it('returns the facet values present in the catalogue', async () => {
    const facets = await getFacets();
    expect(facets.categories).toContain('Vessels');
    expect(facets.bodyTypes).toContain('Porcelain');
    expect(facets.attributes).toContain('Limited Edition');
  });
});
