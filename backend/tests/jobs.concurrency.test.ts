import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { enqueueJob, processJobs } from '../src/modules/notifications/jobs';
import { sentMessages, resetSentMessages } from '../src/modules/notifications/email';

const prisma = new PrismaClient();
let orderId = '';

beforeAll(async () => {
  await prisma.job.deleteMany({ where: { status: { in: ['PENDING', 'PROCESSING'] } } });
  const order = await prisma.order.create({
    data: {
      orderNumber: 'RR-JOBC-ZZ', guestEmail: 'jobc-zz@test.com', guestPhone: '0', status: 'PROCESSING', currency: 'BDT',
      subtotal: 100, shippingTotal: 0, discountTotal: 0, taxTotal: 0, grandTotal: 100,
      idempotencyKey: 'jobc-idem-zz', orderToken: 'jobc-tok-zz', shippingSnapshot: { line1: 'x', city: 'Dhaka', district: 'Dhaka' },
      items: { create: [{ productId: 'p', variantId: 'v', productName: 'P', variantName: 'Standard', sku: 'S', unitPrice: 100, quantity: 1, lineTotal: 100 }] },
      payments: { create: [{ provider: 'COD', amount: 100, currency: 'BDT', tranId: 'jobc-tran-zz', status: 'INITIATED' }] },
    },
  });
  orderId = order.id;
});
afterAll(async () => {
  await prisma.job.deleteMany({ where: { type: 'email.order_confirmation', payload: { path: '$.orderId', equals: orderId } } });
  await prisma.order.deleteMany({ where: { idempotencyKey: 'jobc-idem-zz' } });
  await prisma.$disconnect();
});
beforeEach(() => resetSentMessages());

describe('processJobs concurrency (SKIP LOCKED)', () => {
  it('processes 8 jobs exactly once across two concurrent workers (no double-send)', async () => {
    for (let i = 0; i < 8; i++) await enqueueJob(prisma, 'email.order_confirmation', { orderId });
    // two workers, each batch 5 → claims are disjoint (the second skips the first's locked rows)
    const [a, b] = await Promise.all([processJobs(prisma, 5), processJobs(prisma, 5)]);
    expect(a.processed + b.processed).toBe(8);
    expect(sentMessages.length).toBe(8); // each job sent once, not twice
  });
});
