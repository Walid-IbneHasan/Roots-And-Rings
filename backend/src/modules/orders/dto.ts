import type { Order, OrderItem, Payment, Shipment } from '@prisma/client';

export type FullOrder = Order & {
  items: OrderItem[];
  payments: Payment[];
  shipment: Shipment | null;
};

export function orderToDto(order: FullOrder) {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    couponCode: order.couponCode,
    currency: order.currency,
    email: order.guestEmail,
    placedAt: order.placedAt.toISOString(),
    totals: {
      subtotal: Number(order.subtotal),
      shipping: Number(order.shippingTotal),
      discount: Number(order.discountTotal),
      grand: Number(order.grandTotal),
    },
    items: order.items.map((i) => ({
      name: i.productName,
      variant: i.variantName,
      sku: i.sku,
      unitPrice: Number(i.unitPrice),
      quantity: i.quantity,
      lineTotal: Number(i.lineTotal),
    })),
    payment: order.payments[0]
      ? { provider: order.payments[0].provider, status: order.payments[0].status }
      : null,
    shipping: order.shippingSnapshot,
  };
}
