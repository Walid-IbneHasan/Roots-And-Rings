import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/lib/password';

let app: FastifyInstance;
let productId = '';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const p = await app.prisma.product.create({ data: { name: 'revapi-zz', slug: 'revapi-zz', sku: 'TEST-REVAPI', shortDescription: 'x', description: 'y', basePrice: 100, ratingAvg: 5, ratingCount: 1 } });
  productId = p.id;
  const c = await app.prisma.customer.create({ data: { email: 'revapi-zz@test.com', name: 'Rev Api', passwordHash: await hashPassword('x12345678') } });
  await app.prisma.review.create({ data: { productId, customerId: c.id, rating: 5, title: 'Shown', body: 'Visible review', authorName: 'Rev Api', status: 'PUBLISHED' } });
  const c2 = await app.prisma.customer.create({ data: { email: 'revapi2-zz@test.com', name: 'Hidden Guy', passwordHash: await hashPassword('x12345678') } });
  await app.prisma.review.create({ data: { productId, customerId: c2.id, rating: 1, title: 'Hidden', body: 'Hidden review', authorName: 'Hidden Guy', status: 'HIDDEN' } });
});
afterAll(async () => {
  await app.prisma.review.deleteMany({ where: { productId } });
  await app.prisma.product.deleteMany({ where: { sku: 'TEST-REVAPI' } });
  await app.prisma.customer.deleteMany({ where: { email: { in: ['revapi-zz@test.com', 'revapi2-zz@test.com'] } } });
  await app.close();
});

describe('public reviews', () => {
  it('lists only PUBLISHED reviews with the aggregate', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/products/revapi-zz/reviews' });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.items.length).toBe(1);
    expect(b.items[0].title).toBe('Shown');
    expect(b.total).toBe(1);
    expect(b.ratingCount).toBe(1);
    expect(b.ratingAvg).toBe(5);
  });
  it('exposes ratingAvg/ratingCount on the product DTO', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/products/revapi-zz' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ratingCount).toBe(1);
    expect(res.json().ratingAvg).toBe(5);
  });
});
