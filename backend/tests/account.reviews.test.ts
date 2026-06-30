import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { signCustomerToken } from '../src/lib/jwt';
import { hashPassword } from '../src/lib/password';

let app: FastifyInstance;
let buyerToken = '';
let strangerToken = '';

async function deliveredOrder(customerId: string, productId: string) {
  await app.prisma.order.create({
    data: {
      orderNumber: `RR-AREV-${customerId.slice(-4)}`, customerId, guestEmail: 'x@x.com', guestPhone: '0',
      status: 'DELIVERED', currency: 'BDT', subtotal: 100, shippingTotal: 0, discountTotal: 0, taxTotal: 0, grandTotal: 100,
      idempotencyKey: `arev-idem-${customerId}`, orderToken: `arev-tok-${customerId}`,
      shippingSnapshot: { line1: 'x', city: 'Dhaka', district: 'Dhaka' },
      items: { create: [{ productId, variantId: 'v', productName: 'P', variantName: 'Standard', sku: 'S', unitPrice: 100, quantity: 1, lineTotal: 100 }] },
    },
  });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const p = await app.prisma.product.create({ data: { name: 'arev-zz', slug: 'arev-zz', sku: 'TEST-AREV', shortDescription: 'x', description: 'y', basePrice: 100 } });
  const buyer = await app.prisma.customer.create({ data: { email: 'arev-buyer-zz@test.com', name: 'A Buyer', passwordHash: await hashPassword('x12345678') } });
  const stranger = await app.prisma.customer.create({ data: { email: 'arev-stranger-zz@test.com', name: 'A Stranger', passwordHash: await hashPassword('x12345678') } });
  buyerToken = signCustomerToken(buyer);
  strangerToken = signCustomerToken(stranger);
  await deliveredOrder(buyer.id, p.id);
});
afterAll(async () => {
  await app.prisma.review.deleteMany({ where: { product: { sku: 'TEST-AREV' } } });
  await app.prisma.order.deleteMany({ where: { idempotencyKey: { startsWith: 'arev-idem-' } } });
  await app.prisma.product.deleteMany({ where: { sku: 'TEST-AREV' } });
  await app.prisma.customer.deleteMany({ where: { email: { in: ['arev-buyer-zz@test.com', 'arev-stranger-zz@test.com'] } } });
  await app.close();
});

const post = (body: object, token: string) => app.inject({ method: 'POST', url: '/api/account/reviews', headers: { authorization: `Bearer ${token}` }, payload: body });

describe('account reviews', () => {
  it('eligible buyer submits a review', async () => {
    const res = await post({ productSlug: 'arev-zz', rating: 5, title: 'Great', body: 'Loved it' }, buyerToken);
    expect(res.statusCode).toBe(201);
    expect(res.json().review.rating).toBe(5);
    const p = await app.prisma.product.findUnique({ where: { slug: 'arev-zz' } });
    expect(p!.ratingCount).toBe(1);
  });
  it('re-submit edits, not duplicates', async () => {
    await post({ productSlug: 'arev-zz', rating: 3 }, buyerToken);
    const count = await app.prisma.review.count({ where: { product: { slug: 'arev-zz' } } });
    expect(count).toBe(1);
  });
  it('ineligible customer is blocked (403)', async () => {
    const res = await post({ productSlug: 'arev-zz', rating: 5 }, strangerToken);
    expect(res.statusCode).toBe(403);
  });
  it('rejects a bad rating (400)', async () => {
    expect((await post({ productSlug: 'arev-zz', rating: 6 }, buyerToken)).statusCode).toBe(400);
    expect((await post({ productSlug: 'arev-zz', rating: 0 }, buyerToken)).statusCode).toBe(400);
  });
  it('can-review reflects eligibility + the existing review', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/account/reviews/can-review?slug=arev-zz', headers: { authorization: `Bearer ${buyerToken}` } });
    expect(ok.json().eligible).toBe(true);
    expect(ok.json().review.rating).toBe(3);
    const no = await app.inject({ method: 'GET', url: '/api/account/reviews/can-review?slug=arev-zz', headers: { authorization: `Bearer ${strangerToken}` } });
    expect(no.json().eligible).toBe(false);
  });
  it('order-detail items expose a slug for the review link', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/account/orders/RR-AREV-${(await app.prisma.customer.findUnique({ where: { email: 'arev-buyer-zz@test.com' } }))!.id.slice(-4)}`, headers: { authorization: `Bearer ${buyerToken}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0].slug).toBe('arev-zz');
  });
});
