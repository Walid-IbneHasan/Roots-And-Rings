import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { reserveForOrder, availableStock } from '../src/modules/inventory/service';
import { OutOfStockError } from '../src/modules/inventory/errors';

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.product.deleteMany({ where: { sku: { startsWith: 'TEST-CONC-' } } });
  await prisma.$disconnect();
});

describe('inventory concurrency', () => {
  it('prevents oversell: exactly one of N parallel reservations wins on stock=1', async () => {
    const slug = `test-conc-${Date.now()}`;
    const product = await prisma.product.create({
      data: { name: 'Conc', slug, sku: `TEST-CONC-${slug}`, shortDescription: 'x', description: 'y', basePrice: 100, allowBackorder: false },
    });
    const variant = await prisma.productVariant.create({ data: { productId: product.id, sku: `TEST-CONC-V-${slug}`, name: 'V', stock: 1 } });

    const N = 8;
    const attempts = Array.from({ length: N }, (_, i) =>
      prisma.$transaction((tx) => reserveForOrder(tx, `conc-${i}`, [{ variantId: variant.id, quantity: 1 }]), {
        isolationLevel: 'ReadCommitted',
      }),
    );
    const results = await Promise.allSettled(attempts);

    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toBe(1);
    expect(rejected.length).toBe(N - 1);
    expect(rejected.every((r) => (r as PromiseRejectedResult).reason instanceof OutOfStockError)).toBe(true);
    expect(await availableStock(prisma, variant.id)).toBe(0);
  });
});
