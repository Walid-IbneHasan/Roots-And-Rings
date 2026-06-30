import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getProvider, markPaymentPaid } from '../src/modules/payments/service';

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.order.deleteMany({ where: { orderNumber: { startsWith: 'TEST-PAY-' } } });
  await prisma.$disconnect();
});

describe('payment providers', () => {
  it('COD createSession returns INITIATED', async () => {
    const r = await getProvider('COD').createSession({} as never, {} as never);
    expect(r.status).toBe('INITIATED');
  });

  it('bKash createSession without credentials returns CREDENTIALS_MISSING', async () => {
    const r = await getProvider('BKASH').createSession({} as never, {} as never);
    expect(r.status).toBe('CREDENTIALS_MISSING');
  });
});

describe('markPaymentPaid', () => {
  it('sets payment PAID, order paidAt, and appends a PAID event', async () => {
    const order = await prisma.order.create({
      data: {
        orderNumber: `TEST-PAY-${Date.now()}`,
        guestEmail: 'pay@test.com',
        status: 'AWAITING_PAYMENT',
        subtotal: 100,
        grandTotal: 100,
        idempotencyKey: `idem-${Date.now()}`,
        orderToken: `tok-${Date.now()}`,
        shippingSnapshot: { line1: 'x', city: 'Dhaka' },
        payments: { create: { provider: 'COD', amount: 100, tranId: `tran-${Date.now()}` } },
      },
      include: { payments: true },
    });

    await markPaymentPaid(prisma, order.id);

    const payment = await prisma.payment.findUnique({ where: { id: order.payments[0].id } });
    expect(payment?.status).toBe('PAID');
    const refreshed = await prisma.order.findUnique({ where: { id: order.id } });
    expect(refreshed?.paidAt).toBeTruthy();
    const event = await prisma.paymentEvent.findFirst({ where: { paymentId: order.payments[0].id, type: 'PAID' } });
    expect(event).toBeTruthy();
  });
});
