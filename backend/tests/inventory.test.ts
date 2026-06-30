import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  availableStock,
  reserveForOrder,
  commitReservations,
  releaseReservations,
  restockOrder,
  adjustStock,
} from '../src/modules/inventory/service';
import { OutOfStockError } from '../src/modules/inventory/errors';

const prisma = new PrismaClient();
let counter = 0;

async function makeVariant(stock: number, allowBackorder: boolean): Promise<string> {
  counter += 1;
  const slug = `test-inv-${Date.now()}-${counter}`;
  const product = await prisma.product.create({
    data: { name: 'TestInv', slug, sku: `TEST-INV-${slug}`, shortDescription: 'x', description: 'y', basePrice: 100, allowBackorder },
  });
  const variant = await prisma.productVariant.create({ data: { productId: product.id, sku: `TEST-INV-V-${slug}`, name: 'V', stock } });
  return variant.id;
}

const rc = { isolationLevel: 'ReadCommitted' as const };

afterAll(async () => {
  await prisma.product.deleteMany({ where: { sku: { startsWith: 'TEST-INV-' } } });
  await prisma.$disconnect();
});

describe('inventory service', () => {
  it('reserve reduces availability; commit decrements stock + SALE movement', async () => {
    const v = await makeVariant(5, false);
    await prisma.$transaction((tx) => reserveForOrder(tx, 'o1', [{ variantId: v, quantity: 2 }]), rc);
    expect(await availableStock(prisma, v)).toBe(3);
    await prisma.$transaction((tx) => commitReservations(tx, 'o1'), rc);
    expect((await prisma.productVariant.findUnique({ where: { id: v } }))!.stock).toBe(3);
    expect(await prisma.inventoryMovement.findFirst({ where: { variantId: v, type: 'SALE' } })).toBeTruthy();
  });

  it('release restores availability', async () => {
    const v = await makeVariant(4, false);
    await prisma.$transaction((tx) => reserveForOrder(tx, 'o2', [{ variantId: v, quantity: 1 }]), rc);
    expect(await availableStock(prisma, v)).toBe(3);
    await prisma.$transaction((tx) => releaseReservations(tx, 'o2'), rc);
    expect(await availableStock(prisma, v)).toBe(4);
  });

  it('restock after commit increments stock back', async () => {
    const v = await makeVariant(2, false);
    await prisma.$transaction((tx) => reserveForOrder(tx, 'o3', [{ variantId: v, quantity: 1 }]), rc);
    await prisma.$transaction((tx) => commitReservations(tx, 'o3'), rc);
    expect((await prisma.productVariant.findUnique({ where: { id: v } }))!.stock).toBe(1);
    await prisma.$transaction((tx) => restockOrder(tx, 'o3', 'REFUND_RESTOCK'), rc);
    expect((await prisma.productVariant.findUnique({ where: { id: v } }))!.stock).toBe(2);
  });

  it('adjustStock changes stock + MANUAL movement', async () => {
    const v = await makeVariant(3, false);
    await adjustStock(prisma, v, 5, 'restock');
    expect((await prisma.productVariant.findUnique({ where: { id: v } }))!.stock).toBe(8);
    expect(await prisma.inventoryMovement.findFirst({ where: { variantId: v, type: 'MANUAL_ADJUSTMENT' } })).toBeTruthy();
  });

  it('throws OutOfStock beyond available without backorder', async () => {
    const v = await makeVariant(1, false);
    await expect(prisma.$transaction((tx) => reserveForOrder(tx, 'o4', [{ variantId: v, quantity: 2 }]), rc)).rejects.toBeInstanceOf(
      OutOfStockError,
    );
  });

  it('allows backorder beyond stock', async () => {
    const v = await makeVariant(0, true);
    await expect(prisma.$transaction((tx) => reserveForOrder(tx, 'o5', [{ variantId: v, quantity: 3 }]), rc)).resolves.toBeUndefined();
  });
});
