import { describe, it, expect } from 'vitest';
import { products } from '../src/data/products';
import { collections } from '../src/data/collections';
import { productSchema, collectionSchema } from '../src/lib/schema';

describe('product data', () => {
  it('has at least 12 products', () => {
    expect(products.length).toBeGreaterThanOrEqual(12);
  });

  it('every product satisfies the schema', () => {
    for (const p of products) {
      expect(() => productSchema.parse(p)).not.toThrow();
    }
  });

  it('has unique slugs', () => {
    const slugs = products.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every relatedSlug references an existing product', () => {
    const slugs = new Set(products.map((p) => p.slug));
    for (const p of products) {
      for (const rel of p.relatedSlugs) {
        expect(slugs.has(rel)).toBe(true);
      }
    }
  });

  it('covers every category at least once', () => {
    const cats = new Set(products.map((p) => p.category));
    for (const c of ['Vessels', 'Bowls', 'Plates', 'Sculptural', 'Tableware']) {
      expect(cats.has(c as never)).toBe(true);
    }
  });

  it('has at least one featured product', () => {
    expect(products.some((p) => p.featured)).toBe(true);
  });
});

describe('collection data', () => {
  it('every collection satisfies the schema', () => {
    for (const c of collections) {
      expect(() => collectionSchema.parse(c)).not.toThrow();
    }
  });
});
