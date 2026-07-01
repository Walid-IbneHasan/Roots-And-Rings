import { randomBytes } from 'node:crypto';
import type { PrismaClient, OrderStatus, OrderSource } from '@prisma/client';
import { computeTotals, round2 } from '../../lib/money';
import { priceItems } from './pricing';
import { generateOrderNumber } from '../../lib/order-number';
import { httpError } from '../../lib/errors';
import { reserveForOrder, commitReservations, checkLowStock } from '../inventory/service';
import { getProvider } from '../payments/service';
import { enqueueJob } from '../notifications/jobs';
import type { CheckoutInput } from './schemas';
import { redeemCoupon } from '../coupons/service';

const rc = { isolationLevel: 'ReadCommitted' as const };

export interface PlaceOrderResult {
  orderNumber: string;
  orderToken: string;
  status: OrderStatus;
  redirectUrl?: string;
  credentialsMissing?: boolean;
}

export async function placeOrder(prisma: PrismaClient, input: CheckoutInput, customerId?: string): Promise<PlaceOrderResult> {
  // Idempotency: replaying the same key returns the existing order.
  const existing = await prisma.order.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { payments: true } });
  if (existing) {
    return {
      orderNumber: existing.orderNumber,
      orderToken: existing.orderToken,
      status: existing.status,
      redirectUrl: existing.payments[0]?.gatewayPageURL ?? undefined,
    };
  }

  // Resolve + re-price server-side (never trust client prices).
  const { lines: resolved, subtotal } = await priceItems(prisma, input.items);
  const totals = computeTotals(
    resolved.map((r) => ({ unitPrice: r.unitPrice, quantity: r.qty })),
    0,
  );
  const orderNumber = generateOrderNumber();
  const orderToken = randomBytes(16).toString('hex');
  const tranId = `${orderNumber}-${randomBytes(3).toString('hex')}`;
  const cod = input.paymentMethod === 'COD';

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        orderNumber,
        customerId: customerId ?? null,
        guestEmail: input.contact.email,
        guestPhone: input.contact.phone,
        status: cod ? 'PROCESSING' : 'AWAITING_PAYMENT',
        source: 'WEBSITE',
        currency: 'BDT',
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        shippingTotal: totals.shippingTotal,
        taxTotal: totals.taxTotal,
        grandTotal: totals.grandTotal,
        idempotencyKey: input.idempotencyKey,
        orderToken,
        shippingSnapshot: { ...input.shipping, name: input.contact.name, phone: input.contact.phone },
        items: {
          create: resolved.map((r) => ({
            productId: r.productId,
            variantId: r.variantId,
            productName: r.productName,
            variantName: r.variantName,
            sku: r.sku,
            unitPrice: r.unitPrice,
            quantity: r.qty,
            lineTotal: round2(r.unitPrice * r.qty),
          })),
        },
      },
    });

    await reserveForOrder(tx, order.id, resolved.map((r) => ({ variantId: r.variantId, quantity: r.qty })));

    let discount = 0;
    let appliedCode: string | null = null;
    if (input.couponCode) {
      const r = await redeemCoupon(tx, input.couponCode, {
        subtotal,
        orderId: order.id,
        customerId: customerId ?? undefined,
        email: input.contact.email,
      });
      discount = r.discount;
      appliedCode = r.coupon.code;
      await tx.order.update({
        where: { id: order.id },
        data: { discountTotal: discount, grandTotal: round2(subtotal - discount), couponCode: appliedCode },
      });
    }
    const grand = round2(subtotal - discount);

    const payment = await tx.payment.create({
      data: { orderId: order.id, provider: input.paymentMethod, amount: grand, currency: 'BDT', tranId, status: 'INITIATED' },
    });
    await tx.paymentEvent.create({ data: { paymentId: payment.id, type: 'INIT', rawPayload: { method: input.paymentMethod }, processed: true } });

    if (cod) {
      await commitReservations(tx, order.id);
      await tx.shipment.create({ data: { orderId: order.id, status: 'PENDING' } });
    }
    return { order, payment };
  }, rc);

  let redirectUrl: string | undefined;
  let credentialsMissing = false;

  if (cod) {
    await enqueueJob(prisma, 'email.order_confirmation', { orderId: result.order.id });
    for (const r of resolved) await checkLowStock(prisma, r.variantId);
  } else {
    const session = await getProvider('BKASH').createSession(result.order, result.payment);
    if (session.status === 'CREDENTIALS_MISSING') {
      credentialsMissing = true;
    } else if (session.gatewayPageURL) {
      await prisma.payment.update({ where: { id: result.payment.id }, data: { status: 'PENDING', gatewayPageURL: session.gatewayPageURL } });
      redirectUrl = session.gatewayPageURL;
    }
  }

  return { orderNumber, orderToken, status: result.order.status, redirectUrl, credentialsMissing };
}

export interface ManualOrderInput {
  items: { slug: string; qty: number }[];
  contact: { name: string; email: string; phone: string };
  shipping: { line1: string; line2?: string; city: string; district: string; postalCode?: string; country?: string };
  source: OrderSource;
  paid: boolean;
}

/** Admin-recorded order (FB/IG/other): re-prices + decrements stock like a site order; no email/bKash. */
export async function createManualOrder(
  prisma: PrismaClient,
  input: ManualOrderInput,
): Promise<{ orderNumber: string; orderId: string }> {
  if (!input.items.length) throw httpError(400, 'Add at least one product');
  const { lines: resolved } = await priceItems(prisma, input.items);
  if (!resolved.length) throw httpError(400, 'No valid products in the order');
  const totals = computeTotals(resolved.map((r) => ({ unitPrice: r.unitPrice, quantity: r.qty })), 0);

  const email = input.contact.email.toLowerCase();
  const linked = await prisma.customer.findUnique({ where: { email }, select: { id: true } });

  const orderNumber = generateOrderNumber();
  const orderToken = randomBytes(16).toString('hex');
  const idempotencyKey = `manual-${randomBytes(12).toString('hex')}`;
  const tranId = `${orderNumber}-${randomBytes(3).toString('hex')}`;

  const order = await prisma.$transaction(async (tx) => {
    const o = await tx.order.create({
      data: {
        orderNumber,
        customerId: linked?.id ?? null,
        guestEmail: email,
        guestPhone: input.contact.phone,
        status: 'PROCESSING',
        source: input.source,
        currency: 'BDT',
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        shippingTotal: totals.shippingTotal,
        taxTotal: totals.taxTotal,
        grandTotal: totals.grandTotal,
        idempotencyKey,
        orderToken,
        paidAt: input.paid ? new Date() : null,
        shippingSnapshot: { ...input.shipping, name: input.contact.name, phone: input.contact.phone },
        items: {
          create: resolved.map((r) => ({
            productId: r.productId,
            variantId: r.variantId,
            productName: r.productName,
            variantName: r.variantName,
            sku: r.sku,
            unitPrice: r.unitPrice,
            quantity: r.qty,
            lineTotal: round2(r.unitPrice * r.qty),
          })),
        },
      },
    });
    await reserveForOrder(tx, o.id, resolved.map((r) => ({ variantId: r.variantId, quantity: r.qty })));
    await commitReservations(tx, o.id);
    await tx.payment.create({
      data: { orderId: o.id, provider: 'MANUAL', amount: totals.grandTotal, currency: 'BDT', tranId, status: input.paid ? 'PAID' : 'INITIATED' },
    });
    await tx.shipment.create({ data: { orderId: o.id, status: 'PENDING' } });
    return o;
  }, rc);

  for (const r of resolved) await checkLowStock(prisma, r.variantId);
  return { orderNumber: order.orderNumber, orderId: order.id };
}
