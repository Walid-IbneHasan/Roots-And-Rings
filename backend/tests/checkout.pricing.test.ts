import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { priceItems } from '../src/modules/checkout/pricing';

const prisma = new PrismaClient();

beforeAll(async () => {
  const p = await prisma.product.create({
    data: { name: 'price-zz', slug: 'price-zz', sku: 'TEST-PRICE-ZZ', shortDescription: 'x', description: 'y', basePrice: 150 },
  });
  await prisma.productVariant.create({ data: { productId: p.id, sku: 'TEST-PRICE-ZZ-V', name: 'Standard', stock: 5 } });
});
afterAll(async () => {
  await prisma.product.deleteMany({ where: { sku: 'TEST-PRICE-ZZ' } });
  await prisma.$disconnect();
});

describe('priceItems', () => {
  it('resolves slugs to priced lines and a subtotal', async () => {
    const { lines, subtotal } = await priceItems(prisma, [{ slug: 'price-zz', qty: 2 }]);
    expect(lines.length).toBe(1);
    expect(lines[0].unitPrice).toBe(150);
    expect(subtotal).toBe(300);
  });
  it('throws on an unknown product', async () => {
    await expect(priceItems(prisma, [{ slug: 'no-such-zz', qty: 1 }])).rejects.toMatchObject({ statusCode: 400 });
  });
});
