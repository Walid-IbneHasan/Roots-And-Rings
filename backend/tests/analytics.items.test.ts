import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getTopProducts, getTopCategories, getTopCollections } from '../src/modules/analytics/service';

const prisma = new PrismaClient();
const TAG = 'an-item';
let productId = '', categoryName = '', collectionName = '', orderId = '';

const findByName = (arr: { name: string; revenue: number; units: number }[], name: string) => arr.find((x) => x.name === name);

beforeAll(async () => {
  await prisma.orderItem.deleteMany({ where: { sku: `${TAG}-SKU` } });
  await prisma.order.deleteMany({ where: { guestEmail: `${TAG}@test.com` } });
  await prisma.product.deleteMany({ where: { sku: `${TAG}-PSKU` } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });

  const cat = await prisma.category.create({ data: { kind: 'PRODUCT_TYPE', name: `${TAG} Vases`, slug: `${TAG}-vases` } });
  const coll = await prisma.category.create({ data: { kind: 'COLLECTION', name: `${TAG} Spring`, slug: `${TAG}-spring` } });
  categoryName = cat.name; collectionName = coll.name;
  const product = await prisma.product.create({
    data: {
      name: `${TAG} Bowl`, slug: `${TAG}-bowl`, sku: `${TAG}-PSKU`, shortDescription: 'x', description: 'x',
      basePrice: 250, isActive: true, categoryId: cat.id, collections: { connect: [{ id: coll.id }] },
    },
  });
  productId = product.id;
  const order = await prisma.order.create({
    data: {
      orderNumber: `RR-${TAG}-1`, guestEmail: `${TAG}@test.com`, guestPhone: '0', currency: 'BDT',
      subtotal: 500, grandTotal: 500, idempotencyKey: `${TAG}-1`, orderToken: `${TAG}tok-1`,
      shippingSnapshot: { line1: 'x', city: 'Dhaka', district: 'Dhaka' }, status: 'PROCESSING', source: 'WEBSITE',
      items: { create: [{ productId, productName: `${TAG} Bowl`, sku: `${TAG}-SKU`, unitPrice: 250, quantity: 2, lineTotal: 500 }] },
    },
  });
  orderId = order.id;
});
afterAll(async () => {
  await prisma.orderItem.deleteMany({ where: { sku: `${TAG}-SKU` } });
  await prisma.order.deleteMany({ where: { guestEmail: `${TAG}@test.com` } });
  await prisma.product.deleteMany({ where: { sku: `${TAG}-PSKU` } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
  await prisma.$disconnect();
});

describe('analytics item-level aggregations', () => {
  it('getTopProducts includes the seeded product with 2 units / ৳500', async () => {
    const rows = await getTopProducts(prisma, 'daily', 100);
    const p = findByName(rows, `${TAG} Bowl`);
    expect(p).toBeTruthy();
    expect(p!.units).toBe(2);
    expect(p!.revenue).toBeCloseTo(500, 2);
  });

  it('getTopCategories attributes the line to the product primary category', async () => {
    const rows = await getTopCategories(prisma, 'daily');
    const c = findByName(rows, categoryName);
    expect(c).toBeTruthy();
    expect(c!.revenue).toBeCloseTo(500, 2);
  });

  it('getTopCollections attributes the line to the product collection', async () => {
    const rows = await getTopCollections(prisma, 'daily');
    const c = findByName(rows, collectionName);
    expect(c).toBeTruthy();
    expect(c!.revenue).toBeCloseTo(500, 2);
  });

  it('respects the limit on top products', async () => {
    const rows = await getTopProducts(prisma, 'daily', 1);
    expect(rows.length).toBeLessThanOrEqual(1);
  });
});
