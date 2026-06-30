import type { PrismaClient, PaymentProviderKind } from '@prisma/client';
import type { PaymentProvider } from './provider';
import { codProvider } from './providers/cod';
import { bkashProvider } from './providers/bkash';
import { restockOrder } from '../inventory/service';

export function getProvider(kind: PaymentProviderKind): PaymentProvider {
  return kind === 'BKASH' ? bkashProvider : codProvider;
}

export async function appendEvent(
  prisma: PrismaClient,
  paymentId: string,
  type: string,
  rawPayload: object,
  processed = true,
): Promise<void> {
  await prisma.paymentEvent.create({ data: { paymentId, type, rawPayload, processed } });
}

/** Mark an order's payment as PAID (used by bKash success + COD settle-on-delivery). */
export async function markPaymentPaid(prisma: PrismaClient, orderId: string): Promise<void> {
  const payment = await prisma.payment.findFirst({ where: { orderId } });
  if (!payment) return;
  await prisma.payment.update({ where: { id: payment.id }, data: { status: 'PAID', validatedAt: new Date() } });
  await prisma.order.update({ where: { id: orderId }, data: { paidAt: new Date() } });
  await appendEvent(prisma, payment.id, 'PAID', { orderId });
}

const rc = { isolationLevel: 'ReadCommitted' as const };

/** Refund (full or partial) → payment + order status + restock. */
export async function refundPayment(prisma: PrismaClient, paymentId: string, amount: number): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return;
  const full = amount >= Number(payment.amount);
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: paymentId }, data: { status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
    await tx.order.update({ where: { id: payment.orderId }, data: { status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
    await restockOrder(tx, payment.orderId, 'REFUND_RESTOCK');
  }, rc);
  await appendEvent(prisma, paymentId, 'REFUND', { amount, full });
}
