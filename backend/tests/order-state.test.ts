import { describe, it, expect } from 'vitest';
import { canTransition } from '../src/lib/order-state';
import { generateOrderNumber } from '../src/lib/order-number';
import { round2, computeTotals } from '../src/lib/money';

describe('order-state', () => {
  it('allows valid transitions', () => {
    expect(canTransition('PROCESSING', 'SHIPPED')).toBe(true);
    expect(canTransition('SHIPPED', 'DELIVERED')).toBe(true);
    expect(canTransition('AWAITING_PAYMENT', 'PAID')).toBe(true);
    expect(canTransition('DELIVERED', 'REFUNDED')).toBe(true);
  });
  it('rejects invalid transitions', () => {
    expect(canTransition('DELIVERED', 'AWAITING_PAYMENT')).toBe(false);
    expect(canTransition('CANCELLED', 'SHIPPED')).toBe(false);
    expect(canTransition('PROCESSING', 'PAID')).toBe(false);
  });
});

describe('order-number', () => {
  it('matches RR-YYYYMMDD-XXXX', () => {
    expect(generateOrderNumber(new Date('2026-06-29T10:00:00Z'))).toMatch(/^RR-20260629-[A-Z2-7]{4}$/);
  });
  it('is reasonably unique', () => {
    const set = new Set(Array.from({ length: 200 }, () => generateOrderNumber()));
    expect(set.size).toBeGreaterThan(190);
  });
});

describe('money', () => {
  it('rounds to 2 decimals', () => {
    expect(round2(199.999)).toBe(200);
    expect(round2(10.005)).toBe(10.01);
  });
  it('computes totals', () => {
    expect(computeTotals([{ unitPrice: 100, quantity: 2 }, { unitPrice: 50, quantity: 1 }], 60)).toEqual({
      subtotal: 250,
      shippingTotal: 60,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: 310,
    });
  });
});
