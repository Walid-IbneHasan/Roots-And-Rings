import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const KEY = 'src-zz-idem';

afterAll(async () => {
  await prisma.order.deleteMany({ where: { idempotencyKey: KEY } });
  await prisma.$disconnect();
});

describe('Order.source', () => {
  it('defaults to WEBSITE when not specified', async () => {
    const o = await prisma.order.create({
      data: {
        orderNumber: 'RR-SRC-ZZ', guestEmail: 'src-zz@test.com', guestPhone: '0', currency: 'BDT',
        subtotal: 100, grandTotal: 100, idempotencyKey: KEY, orderToken: 'src-zz-tok',
        shippingSnapshot: { line1: 'x', city: 'Dhaka', district: 'Dhaka' },
      },
    });
    expect(o.source).toBe('WEBSITE');
  });
});
