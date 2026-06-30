import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { canReview, recomputeProductRating, upsertReview } from '../src/modules/reviews/service';
import { ReviewError } from '../src/modules/reviews/errors';
import { hashPassword } from '../src/lib/password';

const prisma = new PrismaClient();
let productId = '';
let buyerId = '';
let strangerId = '';

async function makeOrder(customerId: string, status: 'DELIVERED' | 'PROCESSING', pid: string) {
  await prisma.order.create({
    data: {
      orderNumber: `RR-REV-${status}-${customerId.slice(-4)}`, customerId, guestEmail: 'x@x.com', guestPhone: '0',
      status, currency: 'BDT', subtotal: 100, shippingTotal: 0, discountTotal: 0, taxTotal: 0, grandTotal: 100,
      idempotencyKey: `rev-idem-${status}-${customerId}`, orderToken: `rev-tok-${status}-${customerId}`,
      shippingSnapshot: { line1: 'x', city: 'Dhaka', district: 'Dhaka' },
      items: { create: [{ productId: pid, variantId: 'v', productName: 'P', variantName: 'Standard', sku: 'S', unitPrice: 100, quantity: 1, lineTotal: 100 }] },
    },
  });
}

beforeAll(async () => {
  const p = await prisma.product.create({ data: { name: 'rev-zz', slug: 'rev-zz', sku: 'TEST-REV-ZZ', shortDescription: 'x', description: 'y', basePrice: 100 } });
  productId = p.id;
  const buyer = await prisma.customer.create({ data: { email: 'rev-buyer-zz@test.com', name: 'Buyer Zee', passwordHash: await hashPassword('x12345678') } });
  const stranger = await prisma.customer.create({ data: { email: 'rev-stranger-zz@test.com', name: 'Stranger', passwordHash: await hashPassword('x12345678') } });
  buyerId = buyer.id; strangerId = stranger.id;
  await makeOrder(buyerId, 'DELIVERED', productId);
  await makeOrder(strangerId, 'PROCESSING', productId);
});

afterAll(async () => {
  await prisma.review.deleteMany({ where: { productId } });
  await prisma.order.deleteMany({ where: { idempotencyKey: { startsWith: 'rev-idem-' } } });
  await prisma.product.deleteMany({ where: { sku: 'TEST-REV-ZZ' } });
  await prisma.customer.deleteMany({ where: { email: { in: ['rev-buyer-zz@test.com', 'rev-stranger-zz@test.com'] } } });
  await prisma.$disconnect();
});

describe('canReview', () => {
  it('is true for a delivered-order buyer', async () => {
    expect(await canReview(prisma, buyerId, productId)).toBe(true);
  });
  it('is false when the order is not delivered', async () => {
    expect(await canReview(prisma, strangerId, productId)).toBe(false);
  });
  it('is false for a customer with no order', async () => {
    const c = await prisma.customer.create({ data: { email: 'rev-none-zz@test.com', name: 'None', passwordHash: await hashPassword('x12345678') } });
    expect(await canReview(prisma, c.id, productId)).toBe(false);
    await prisma.customer.delete({ where: { id: c.id } });
  });
});

describe('upsertReview + recompute', () => {
  it('creates a review, blocks the ineligible, edits on re-submit, and updates the aggregate', async () => {
    await expect(upsertReview(prisma, strangerId, productId, 'Stranger', { rating: 5 })).rejects.toBeInstanceOf(ReviewError);

    const r1 = await upsertReview(prisma, buyerId, productId, 'Buyer Zee', { rating: 4, title: 'Lovely', body: 'Great bowl' });
    expect(r1.status).toBe('PUBLISHED');
    let p = await prisma.product.findUnique({ where: { id: productId } });
    expect(p!.ratingCount).toBe(1);
    expect(Number(p!.ratingAvg)).toBe(4);

    // re-submit edits (no duplicate)
    await upsertReview(prisma, buyerId, productId, 'Buyer Zee', { rating: 2 });
    const count = await prisma.review.count({ where: { productId, customerId: buyerId } });
    expect(count).toBe(1);
    p = await prisma.product.findUnique({ where: { id: productId } });
    expect(Number(p!.ratingAvg)).toBe(2);

    // hide → aggregate drops
    await prisma.review.updateMany({ where: { productId, customerId: buyerId }, data: { status: 'HIDDEN' } });
    await recomputeProductRating(prisma, productId);
    p = await prisma.product.findUnique({ where: { id: productId } });
    expect(p!.ratingCount).toBe(0);
    expect(p!.ratingAvg).toBeNull();
  });
});
