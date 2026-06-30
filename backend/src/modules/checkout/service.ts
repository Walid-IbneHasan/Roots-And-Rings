import { randomBytes } from 'node:crypto';
import type { PrismaClient, OrderStatus } from '@prisma/client';
import { resolvePrice } from '../../lib/pricing';
import { computeTotals, round2 } from '../../lib/money';
import { generateOrderNumber } from '../../lib/order-number';
import { httpError } from '../../lib/errors';
import { reserveForOrder, commitReservations, checkLowStock } from '../inventory/service';
import { getProvider } from '../payments/service';
import { enqueueJob, runJobInline } from '../notifications/jobs';
import type { CheckoutInput } from './schemas';

const num = (d: { toString(): string } | number | null | undefined): number | null =>
  d == null ? null : Number(d);
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
  const resolved = [] as { productId: string; variantId: string; productName: string; variantName: string; sku: string; unitPrice: number; qty: number }[];
  for (const it of input.items) {
    const product = await prisma.product.findFirst({
      where: { slug: it.slug, isActive: true },
      include: { variants: { where: { isActive: true }, orderBy: { position: 'asc' } } },
    });
    if (!product) throw httpError(400, `Unknown or unavailable product: ${it.slug}`);
    const variant = product.variants[0];
    if (!variant) throw httpError(400, `No purchasable variant for ${product.name}`);
    if (it.qty < product.minPerOrder) throw httpError(400, `Minimum ${product.minPerOrder} for ${product.name}`);
    if (product.maxPerOrder && it.qty > product.maxPerOrder) throw httpError(400, `Maximum ${product.maxPerOrder} for ${product.name}`);

    const priced = resolvePrice(
      {
        basePrice: num(product.basePrice)!,
        salePrice: num(product.salePrice),
        flashPrice: num(product.flashPrice),
        flashStartAt: product.flashStartAt,
        flashEndAt: product.flashEndAt,
        currency: product.currency,
      },
      new Date(),
    );
    resolved.push({
      productId: product.id,
      variantId: variant.id,
      productName: product.name,
      variantName: variant.name,
      sku: variant.sku,
      unitPrice: priced.price,
      qty: it.qty,
    });
  }

  const totals = computeTotals(resolved.map((r) => ({ unitPrice: r.unitPrice, quantity: r.qty })), 0);
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

    const payment = await tx.payment.create({
      data: { orderId: order.id, provider: input.paymentMethod, amount: totals.grandTotal, currency: 'BDT', tranId, status: 'INITIATED' },
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
    const job = await enqueueJob(prisma, 'email.order_confirmation', { orderId: result.order.id });
    await runJobInline(prisma, job.id);
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
