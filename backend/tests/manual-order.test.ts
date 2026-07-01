import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createManualOrder } from '../src/modules/checkout/service';

const prisma = new PrismaClient();
let slug = '';
let variantId = '';
const SKU = 'RR-MANUAL-ZZ';
const LINKED_EMAIL = 'manual-linked-zz@test.com';

beforeAll(async () => {
  await prisma.orderItem.deleteMany({ where: { sku: 'RR-MANUAL-ZZ-V' } });
  const product = await prisma.product.create({
    data: {
      name: 'Manual ZZ', slug: 'manual-zz', sku: SKU, shortDescription: 'x', description: 'x',
      basePrice: 500, isActive: true,
      variants: { create: [{ sku: 'RR-MANUAL-ZZ-V', name: 'Standard', stock: 10, isActive: true, position: 0 }] },
    },
    include: { variants: true },
  });
  slug = product.slug;
  variantId = product.variants[0].id;
  await prisma.customer.create({ data: { email: LINKED_EMAIL, name: 'Linked', passwordHash: 'x' } });
});
afterAll(async () => {
  await prisma.order.deleteMany({ where: { guestEmail: { in: [LINKED_EMAIL, 'manual-guest-zz@test.com'] } } });
  await prisma.customer.deleteMany({ where: { email: LINKED_EMAIL } });
  await prisma.product.deleteMany({ where: { sku: SKU } });
  await prisma.$disconnect();
});

const base = (over: Partial<Parameters<typeof createManualOrder>[1]> = {}) => ({
  items: [{ slug, qty: 2 }],
  contact: { name: 'Buyer', email: 'manual-guest-zz@test.com', phone: '01700000000' },
  shipping: { line1: '1 Rd', city: 'Dhaka', district: 'Dhaka' },
  source: 'FACEBOOK' as const,
  paid: false,
  ...over,
});

describe('createManualOrder', () => {
  it('creates a FACEBOOK order, decrements stock, pending payment when not paid', async () => {
    const before = (await prisma.productVariant.findUnique({ where: { id: variantId } }))!.stock;
    const { orderId } = await createManualOrder(prisma, base());
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payments: true, items: true } });
    expect(order!.source).toBe('FACEBOOK');
    expect(order!.status).toBe('PROCESSING');
    expect(order!.paidAt).toBeNull();
    expect(order!.payments[0].provider).toBe('MANUAL');
    expect(order!.payments[0].status).toBe('INITIATED');
    const after = (await prisma.productVariant.findUnique({ where: { id: variantId } }))!.stock;
    expect(after).toBe(before - 2);
  });

  it('marks payment PAID + sets paidAt when paid', async () => {
    const { orderId } = await createManualOrder(prisma, base({ paid: true, source: 'INSTAGRAM' }));
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payments: true } });
    expect(order!.source).toBe('INSTAGRAM');
    expect(order!.paidAt).not.toBeNull();
    expect(order!.payments[0].status).toBe('PAID');
  });

  it('links an existing customer by email', async () => {
    const { orderId } = await createManualOrder(prisma, base({ contact: { name: 'Linked', email: LINKED_EMAIL, phone: '01700000000' } }));
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order!.customerId).not.toBeNull();
  });

  it('rejects an empty item list', async () => {
    await expect(createManualOrder(prisma, base({ items: [] }))).rejects.toThrow();
  });
});
