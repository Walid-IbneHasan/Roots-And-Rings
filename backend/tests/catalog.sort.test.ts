import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listProducts } from '../src/modules/catalog/service';

const prisma = new PrismaClient();
const SKUS = ['RR-SORT-A-ZZ', 'RR-SORT-B-ZZ'];

beforeAll(async () => {
  await prisma.product.deleteMany({ where: { sku: { in: SKUS } } });
  await prisma.product.create({ data: { name: 'Sort A ZZ', slug: 'sort-a-zz', sku: SKUS[0], shortDescription: 'x', description: 'x', basePrice: 400, isActive: true } });
  await prisma.product.create({ data: { name: 'Sort B ZZ', slug: 'sort-b-zz', sku: SKUS[1], shortDescription: 'x', description: 'x', basePrice: 500, salePrice: 300, isActive: true } });
});
afterAll(async () => {
  await prisma.product.deleteMany({ where: { sku: { in: SKUS } } });
  await prisma.$disconnect();
});

describe('listProducts price sort uses the effective price', () => {
  it('orders price-asc by resolved price (sale beats a lower base)', async () => {
    const res = await listProducts(prisma, { sort: 'price-asc' } as Parameters<typeof listProducts>[1]);
    const a = res.items.findIndex((p) => p.slug === 'sort-a-zz'); // effective 400
    const b = res.items.findIndex((p) => p.slug === 'sort-b-zz'); // effective 300 (base 500)
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(a); // B (300) before A (400), despite B's higher base
  });
});
