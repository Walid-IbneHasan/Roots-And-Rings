import { describe, it, expect } from 'vitest';
import { siteSchema, productSchema, breadcrumbSchema, itemListSchema } from '../src/lib/structured-data';
import type { Product } from '../src/lib/schema';

const baseProduct = {
  slug: 'kura-vessel', name: 'Kura Vessel', subtitle: 'Stoneware', price: 800, currency: 'BDT',
  category: 'vessels', bodyType: 'stoneware', badges: [], shortDescription: 'A quiet vessel.',
  description: 'desc', curatorsNote: 'note', specs: {}, images: [{ src: 'https://cdn.x/kura.webp', alt: 'Kura' }],
  relatedSlugs: [], createdAt: '2026-06-01T00:00:00.000Z', ratingAvg: null, ratingCount: 0,
} as unknown as Product;

describe('siteSchema', () => {
  it('emits an Organization + WebSite graph with @context', () => {
    const s = siteSchema() as any;
    expect(s['@context']).toBe('https://schema.org');
    const types = s['@graph'].map((n: any) => n['@type']);
    expect(types).toContain('Organization');
    expect(types).toContain('WebSite');
  });
});

describe('productSchema', () => {
  it('builds a Product with absolute image + offers, and NO aggregateRating when unrated', () => {
    const s = productSchema(baseProduct, 'https://rootsandrings.net/products/kura-vessel') as any;
    expect(s['@type']).toBe('Product');
    expect(s.image).toEqual(['https://cdn.x/kura.webp']);
    expect(s.offers.price).toBe(800);
    expect(s.offers.priceCurrency).toBe('BDT');
    expect(s.offers.availability).toContain('InStock');
    expect(s.offers.url).toBe('https://rootsandrings.net/products/kura-vessel');
    expect(s.aggregateRating).toBeUndefined();
  });

  it('includes aggregateRating only when ratingCount > 0', () => {
    const rated = { ...baseProduct, ratingAvg: 4.5, ratingCount: 3 } as Product;
    const s = productSchema(rated, 'https://rootsandrings.net/products/kura-vessel') as any;
    expect(s.aggregateRating.ratingValue).toBe(4.5);
    expect(s.aggregateRating.reviewCount).toBe(3);
  });

  it('includes review snippets when provided', () => {
    const s = productSchema(baseProduct, 'https://x/p', [{ authorName: 'Mira', rating: 5, title: 'Lovely', body: 'Great' }]) as any;
    expect(s.review[0]['@type']).toBe('Review');
    expect(s.review[0].author.name).toBe('Mira');
    expect(s.review[0].reviewRating.ratingValue).toBe(5);
  });

  it('maps availability to the matching schema.org URL', () => {
    const oos = productSchema({ ...baseProduct, availability: 'out_of_stock' } as Product, 'https://x/p') as any;
    expect(oos.offers.availability).toBe('https://schema.org/OutOfStock');
    const bo = productSchema({ ...baseProduct, availability: 'backorder' } as Product, 'https://x/p') as any;
    expect(bo.offers.availability).toBe('https://schema.org/BackOrder');
    const ins = productSchema({ ...baseProduct, availability: 'in_stock' } as Product, 'https://x/p') as any;
    expect(ins.offers.availability).toBe('https://schema.org/InStock');
  });
});

describe('breadcrumbSchema / itemListSchema', () => {
  it('positions breadcrumb items from 1 and absolutizes urls', () => {
    const s = breadcrumbSchema([{ name: 'Home', url: '/' }, { name: 'Objects', url: '/products' }]) as any;
    expect(s['@type']).toBe('BreadcrumbList');
    expect(s.itemListElement[0].position).toBe(1);
    expect(s.itemListElement[1].item).toBe('https://rootsandrings.net/products');
  });

  it('itemList positions items from 1', () => {
    const s = itemListSchema([{ name: 'A', url: '/products/a' }, { name: 'B', url: '/products/b' }]) as any;
    expect(s['@type']).toBe('ItemList');
    expect(s.itemListElement.map((e: any) => e.position)).toEqual([1, 2]);
    expect(s.itemListElement[0].url).toBe('https://rootsandrings.net/products/a');
  });
});
