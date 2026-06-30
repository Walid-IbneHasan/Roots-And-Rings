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

describe('public API smoke — every endpoint responds', () => {
  it('health', async () => expect((await get('/api/health')).statusCode).toBe(200));
  it('categories', async () => expect((await get('/api/categories')).statusCode).toBe(200));
  it('categories?kind=COLLECTION', async () => expect((await get('/api/categories?kind=COLLECTION')).statusCode).toBe(200));
  it('categories/:slug', async () => expect((await get('/api/categories/vessels')).statusCode).toBe(200));
  it('categories/:slug 404', async () => expect((await get('/api/categories/nope')).statusCode).toBe(404));
  it('collections', async () => expect((await get('/api/collections')).statusCode).toBe(200));
  it('collections/:slug', async () => expect((await get('/api/collections/the-first-firing')).statusCode).toBe(200));
  it('products', async () => expect((await get('/api/products')).statusCode).toBe(200));
  it('products?filters', async () => expect((await get('/api/products?category=bowls&sort=price-asc&onSale=true')).statusCode).toBe(200));
  it('products/:slug', async () => expect((await get('/api/products/the-kura-vessel')).statusCode).toBe(200));
  it('products/:slug 404', async () => expect((await get('/api/products/nope')).statusCode).toBe(404));
  it('products/:slug/related', async () => expect((await get('/api/products/the-kura-vessel/related')).statusCode).toBe(200));
  it('featured', async () => expect((await get('/api/featured')).statusCode).toBe(200));
  it('facets', async () => expect((await get('/api/facets')).statusCode).toBe(200));
  it('admin requires auth', async () => expect((await get('/admin')).statusCode).toBe(302));
});
