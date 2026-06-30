import type { OrderStatus } from '@prisma/client';

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  AWAITING_PAYMENT: ['PAID', 'PROCESSING', 'PAYMENT_REVIEW', 'CANCELLED', 'EXPIRED', 'FAILED'],
  PAYMENT_REVIEW: ['PAID', 'PROCESSING', 'CANCELLED', 'FAILED'],
  PAID: ['PROCESSING', 'CANCELLED', 'REFUNDED'],
  PROCESSING: ['SHIPPED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'],
  SHIPPED: ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['REFUNDED', 'PARTIALLY_REFUNDED'],
  CANCELLED: [],
  FAILED: [],
  EXPIRED: [],
  REFUNDED: [],
  PARTIALLY_REFUNDED: ['REFUNDED'],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}
