import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

let app: FastifyInstance;
const get = (url: string) => app.inject({ method: 'GET', url });

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('GET /api/products', () => {
  it('returns the seeded catalogue', async () => {
    const res = await get('/api/products');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThanOrEqual(16);
    expect(body.items.length).toBeGreaterThanOrEqual(16);
    expect(body.facets.categories).toContain('Vessels');
    expect(body.facets.clayBodies).toContain('Porcelain');
    expect(body.facets.attributes).toContain('Limited Edition');
  });

  it('filters by category slug', async () => {
    const res = await get('/api/products?category=bowls');
    const items = res.json().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((p: any) => p.category?.name === 'Bowls')).toBe(true);
  });

  it('sorts by price ascending', async () => {
    const items = (await get('/api/products?sort=price-asc')).json().items;
    const prices = items.map((p: any) => p.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('full-text searches by q', async () => {
    const items = (await get('/api/products?q=kura')).json().items;
    expect(items.some((p: any) => p.slug === 'the-kura-vessel')).toBe(true);
  });

  it('filters by attribute badge', async () => {
    const items = (await get('/api/products?attribute=Limited%20Edition')).json().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((p: any) => p.badges.includes('Limited Edition'))).toBe(true);
  });
});

describe('GET /api/products/:slug', () => {
  it('returns full product detail with resolved price and images', async () => {
    const res = await get('/api/products/the-kura-vessel');
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.name).toBe('The Kura Vessel');
    expect(p.price).toBeGreaterThan(0);
    expect(p.currency).toBe('BDT');
    expect(p.images.length).toBeGreaterThan(0);
    expect(p.images[0].src).toMatch(/^https?:\/\//);
    expect(p.specs).toBeTruthy();
  });

  it('404s on unknown slug', async () => {
    expect((await get('/api/products/does-not-exist')).statusCode).toBe(404);
  });
});

describe('related / featured / collections / categories', () => {
  it('related excludes the product itself', async () => {
    const items = (await get('/api/products/the-kura-vessel/related')).json();
    expect(Array.isArray(items)).toBe(true);
    expect(items.some((p: any) => p.slug === 'the-kura-vessel')).toBe(false);
  });

  it('featured returns only featured', async () => {
    const items = (await get('/api/featured')).json();
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((p: any) => p.isFeatured)).toBe(true);
  });

  it('collections includes the-first-firing', async () => {
    const cols = (await get('/api/collections')).json();
    expect(cols.some((c: any) => c.slug === 'the-first-firing')).toBe(true);
  });

  it('categories returns the menu tree', async () => {
    const cats = (await get('/api/categories?kind=PRODUCT_TYPE')).json();
    expect(cats.some((c: any) => c.slug === 'vessels')).toBe(true);
  });
});
