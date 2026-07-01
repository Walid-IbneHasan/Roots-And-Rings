import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getFlashProducts } from '../src/modules/catalog/service';

const prisma = new PrismaClient();
const SKUS = ['RR-FLASH-ON-ZZ', 'RR-FLASH-OFF-ZZ'];

beforeAll(async () => {
  await prisma.product.deleteMany({ where: { sku: { in: SKUS } } });
  const now = Date.now();
  // active flash window, flashPrice < basePrice
  await prisma.product.create({ data: {
    name: 'Flash On ZZ', slug: 'flash-on-zz', sku: SKUS[0], shortDescription: 'x', description: 'x',
    basePrice: 1000, flashPrice: 600, flashStartAt: new Date(now - 3600_000), flashEndAt: new Date(now + 3600_000), isActive: true,
  } });
  // expired flash window
  await prisma.product.create({ data: {
    name: 'Flash Off ZZ', slug: 'flash-off-zz', sku: SKUS[1], shortDescription: 'x', description: 'x',
    basePrice: 1000, flashPrice: 600, flashStartAt: new Date(now - 7200_000), flashEndAt: new Date(now - 3600_000), isActive: true,
  } });
});
afterAll(async () => {
  await prisma.product.deleteMany({ where: { sku: { in: SKUS } } });
  await prisma.$disconnect();
});

describe('getFlashProducts', () => {
  it('returns products with an active flash window and excludes expired ones', async () => {
    const flash = await getFlashProducts(prisma);
    const slugs = flash.map((p) => p.slug);
    expect(slugs).toContain('flash-on-zz');
    expect(slugs).not.toContain('flash-off-zz');
    const on = flash.find((p) => p.slug === 'flash-on-zz')!;
    expect(on.isOnFlash).toBe(true);
    expect(on.price).toBe(600);
    expect(on.compareAt).toBe(1000);
  });
});
