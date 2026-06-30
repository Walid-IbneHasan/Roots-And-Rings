import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loginAdmin, csrfFrom, formPost } from './helpers';
import { hashPassword } from '../src/lib/password';

let app: FastifyInstance;
let cookie: string;
let csrf: string;
let reviewId = '';
let productId = '';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  cookie = await loginAdmin(app);
  csrf = await csrfFrom(app, '/admin/reviews', cookie);
  const p = await app.prisma.product.create({ data: { name: 'mrev-zz', slug: 'mrev-zz', sku: 'TEST-MREV', shortDescription: 'x', description: 'y', basePrice: 100, ratingAvg: 5, ratingCount: 1 } });
  productId = p.id;
  const c = await app.prisma.customer.create({ data: { email: 'mrev-zz@test.com', name: 'M Rev', passwordHash: await hashPassword('x12345678') } });
  const r = await app.prisma.review.create({ data: { productId, customerId: c.id, rating: 5, title: 'Mod me', authorName: 'M Rev', status: 'PUBLISHED' } });
  reviewId = r.id;
});
afterAll(async () => {
  await app.prisma.review.deleteMany({ where: { productId } });
  await app.prisma.product.deleteMany({ where: { sku: 'TEST-MREV' } });
  await app.prisma.customer.deleteMany({ where: { email: 'mrev-zz@test.com' } });
  await app.close();
});

describe('admin reviews', () => {
  it('lists reviews', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/reviews', headers: { cookie } });
    expect(res.body).toContain('Mod me');
  });
  it('hides a review and recomputes the aggregate', async () => {
    const res = await formPost(app, `/admin/reviews/${reviewId}/hide`, cookie, csrf, {});
    expect([302, 303]).toContain(res.statusCode);
    const r = await app.prisma.review.findUnique({ where: { id: reviewId } });
    expect(r!.status).toBe('HIDDEN');
    const p = await app.prisma.product.findUnique({ where: { id: productId } });
    expect(p!.ratingCount).toBe(0);
  });
  it('unhides it', async () => {
    await formPost(app, `/admin/reviews/${reviewId}/unhide`, cookie, csrf, {});
    const p = await app.prisma.product.findUnique({ where: { id: productId } });
    expect(p!.ratingCount).toBe(1);
  });
  it('deletes it and recomputes', async () => {
    const res = await formPost(app, `/admin/reviews/${reviewId}/delete`, cookie, csrf, {});
    expect([302, 303]).toContain(res.statusCode);
    expect(await app.prisma.review.findUnique({ where: { id: reviewId } })).toBeNull();
    const p = await app.prisma.product.findUnique({ where: { id: productId } });
    expect(p!.ratingCount).toBe(0);
  });
});
