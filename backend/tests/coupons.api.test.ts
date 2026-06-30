import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const p = await app.prisma.product.create({
    data: { name: 'coup-zz', slug: 'coup-zz', sku: 'TEST-COUP-ZZ', shortDescription: 'x', description: 'y', basePrice: 1000 },
  });
  await app.prisma.productVariant.create({ data: { productId: p.id, sku: 'TEST-COUP-ZZ-V', name: 'Standard', stock: 9 } });
  await app.prisma.coupon.deleteMany({ where: { code: { in: ['SAVE20', 'WELCOME100'] } } });
  await app.prisma.coupon.createMany({
    data: [
      { code: 'SAVE20', type: 'PERCENT', value: 20 },
      { code: 'WELCOME100', type: 'FIXED', value: 100, minOrderSubtotal: 500 },
    ],
  });
});
afterAll(async () => {
  await app.prisma.product.deleteMany({ where: { sku: 'TEST-COUP-ZZ' } });
  await app.close();
});

const post = (body: object) => app.inject({ method: 'POST', url: '/api/coupons/validate', payload: body });

describe('POST /api/coupons/validate', () => {
  it('previews a valid percent discount', async () => {
    const res = await post({ code: 'save20', items: [{ slug: 'coup-zz', qty: 1 }] });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.valid).toBe(true);
    expect(b.discount).toBe(200);
    expect(b.newTotal).toBe(800);
  });
  it('returns valid:false with a message for an unknown code', async () => {
    const res = await post({ code: 'NOPEZZ', items: [{ slug: 'coup-zz', qty: 1 }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(false);
    expect(res.json().message).toBeTruthy();
  });
  it('applies a fixed discount once the minimum order is met', async () => {
    const res = await post({ code: 'WELCOME100', items: [{ slug: 'coup-zz', qty: 1 }] });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.valid).toBe(true);
    expect(b.discount).toBe(100);
    expect(b.newTotal).toBe(900);
  });
});
