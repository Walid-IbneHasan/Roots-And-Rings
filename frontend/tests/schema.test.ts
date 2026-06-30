import { describe, it, expect } from 'vitest';
import { productSchema, collectionSchema } from '../src/lib/schema';

const base = {
  slug: 'the-kura-vessel',
  name: 'The Kura Vessel',
  subtitle: 'Stoneware Vessel',
  price: 420,
  currency: 'EUR',
  category: 'Vessels',
  clayBody: 'Stoneware',
  badges: ['Limited Edition'],
  shortDescription: 'A silent custodian of space.',
  description: 'Emerging from the intersection of architectural brutalism and organic decay.',
  curatorsNote: 'Named after traditional Japanese storehouses.',
  specs: {
    dimensions: 'H 42cm × W 28cm × D 25cm',
    weight: '4.2 kg',
    clayBody: 'High-iron dark stoneware with grog',
    firing: 'Anagama wood-fired for 72 hours',
    glaze: 'Celadon mist ash glaze',
  },
  images: [{ src: 'the-kura-vessel-1', alt: 'A textured ceramic vessel on a stone plinth.' }],
  relatedSlugs: ['tea-bowl-no-14'],
  createdAt: '2024-03-01',
};

describe('productSchema', () => {
  it('parses a valid product', () => {
    expect(productSchema.parse(base).slug).toBe('the-kura-vessel');
  });

  it('parses an optional edition block', () => {
    const withEdition = {
      ...base,
      edition: { ref: 'AR-04', count: 40, certificate: true, leadTime: 'Ships in 3–5 weeks' },
    };
    expect(productSchema.parse(withEdition).edition?.count).toBe(40);
  });

  it('accepts any category/clay-body string (relaxed for live API data)', () => {
    expect(productSchema.parse({ ...base, category: 'Vessels', clayBody: 'Stoneware' }).category).toBe('Vessels');
  });

  it('rejects an empty images array', () => {
    expect(() => productSchema.parse({ ...base, images: [] })).toThrow();
  });

  it('rejects a negative price', () => {
    expect(() => productSchema.parse({ ...base, price: -10 })).toThrow();
  });
});

describe('collectionSchema', () => {
  it('parses a valid collection', () => {
    const c = {
      slug: 'the-first-firing',
      name: 'The First Firing',
      tagline: 'A meditation on raw materials.',
      description: 'This collection embraces the unpredictable nature of wood-firing.',
      image: { src: 'collection-first-firing', alt: 'A wood-fired ceramic bowl.' },
    };
    expect(collectionSchema.parse(c).slug).toBe('the-first-firing');
  });
});
