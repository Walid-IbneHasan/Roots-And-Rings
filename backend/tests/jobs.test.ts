import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { enqueueJob, processJobs } from '../src/modules/notifications/jobs';
import { sentMessages, resetSentMessages } from '../src/modules/notifications/email';

const prisma = new PrismaClient();
let orderId = '';

beforeAll(async () => {
  const order = await prisma.order.create({
    data: {
      orderNumber: 'RR-JOB-ZZ', guestEmail: 'jobs-zz@test.com', guestPhone: '0', status: 'PROCESSING', currency: 'BDT',
      subtotal: 800, shippingTotal: 0, discountTotal: 0, taxTotal: 0, grandTotal: 800,
      idempotencyKey: 'job-idem-zz', orderToken: 'job-tok-zz', shippingSnapshot: { line1: 'x', city: 'Dhaka', district: 'Dhaka' },
      items: { create: [{ productId: 'p', variantId: 'v', productName: 'Kura Vessel', variantName: 'Standard', sku: 'S', unitPrice: 800, quantity: 1, lineTotal: 800 }] },
      payments: { create: [{ provider: 'COD', amount: 800, currency: 'BDT', tranId: 'job-tran-zz', status: 'INITIATED' }] },
    },
  });
  orderId = order.id;
});
afterAll(async () => {
  await prisma.job.deleteMany({ where: { type: { in: ['email.order_confirmation', 'test.boom'] } } });
  await prisma.order.deleteMany({ where: { idempotencyKey: 'job-idem-zz' } });
  await prisma.$disconnect();
});
beforeEach(() => resetSentMessages());

describe('processJobs', () => {
  it('delivers an order-confirmation job and marks it DONE', async () => {
    const job = await enqueueJob(prisma, 'email.order_confirmation', { orderId });
    const res = await processJobs(prisma, 10);
    expect(res.processed).toBe(1);
    const done = await prisma.job.findUnique({ where: { id: job.id } });
    expect(done!.status).toBe('DONE');
    expect(sentMessages.some((m) => m.to === 'jobs-zz@test.com' && m.subject === 'Order RR-JOB-ZZ confirmed')).toBe(true);
  });

  it('retries a failing job (PENDING + future runAt), then FAILS at maxAttempts', async () => {
    const boom = async () => { throw new Error('boom'); };
    const job = await enqueueJob(prisma, 'test.boom', {});
    await processJobs(prisma, 10, boom);
    let j = await prisma.job.findUnique({ where: { id: job.id } });
    expect(j!.status).toBe('PENDING');
    expect(j!.attempts).toBe(1);
    expect(j!.lastError).toContain('boom');
    expect(j!.runAt.getTime()).toBeGreaterThan(Date.now());

    // jump to the last attempt
    await prisma.job.update({ where: { id: job.id }, data: { attempts: 4, runAt: new Date(Date.now() - 1000) } });
    await processJobs(prisma, 10, boom);
    j = await prisma.job.findUnique({ where: { id: job.id } });
    expect(j!.status).toBe('FAILED');
    expect(j!.attempts).toBe(5);
  });
});
