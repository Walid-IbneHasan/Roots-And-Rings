import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { computeDiscount, validateCoupon } from '../src/modules/coupons/service';
import { CouponError } from '../src/modules/coupons/errors';

const prisma = new PrismaClient();
const codes = ['PCT10ZZ', 'FIX50ZZ', 'MIN500ZZ', 'OFFZZ', 'CAPZZ'];

beforeAll(async () => {
  await prisma.couponRedemption.deleteMany({ where: { coupon: { code: { in: codes } } } });
  await prisma.coupon.deleteMany({ where: { code: { in: codes } } });
  await prisma.coupon.createMany({
    data: [
      { code: 'PCT10ZZ', type: 'PERCENT', value: 10 },
      { code: 'FIX50ZZ', type: 'FIXED', value: 50 },
      { code: 'MIN500ZZ', type: 'PERCENT', value: 10, minOrderSubtotal: 500 },
      { code: 'OFFZZ', type: 'PERCENT', value: 10, isActive: false },
      { code: 'CAPZZ', type: 'FIXED', value: 10, maxRedemptions: 1, timesRedeemed: 1 },
    ],
  });
});

afterAll(async () => {
  await prisma.coupon.deleteMany({ where: { code: { in: codes } } });
  await prisma.$disconnect();
});

describe('computeDiscount', () => {
  it('percent rounds to 2dp', () => {
    expect(computeDiscount({ type: 'PERCENT', value: 10 as any }, 199)).toBe(19.9);
  });
  it('fixed is the value, clamped to subtotal', () => {
    expect(computeDiscount({ type: 'FIXED', value: 50 as any }, 200)).toBe(50);
    expect(computeDiscount({ type: 'FIXED', value: 500 as any }, 200)).toBe(200);
  });
});

describe('validateCoupon', () => {
  it('accepts a valid percent code and returns the discount', async () => {
    const { discount } = await validateCoupon(prisma, 'pct10zz', { subtotal: 1000 });
    expect(discount).toBe(100);
  });
  it('is case/space-insensitive on the code', async () => {
    const { coupon } = await validateCoupon(prisma, '  fix50zz  ', { subtotal: 1000 });
    expect(coupon.code).toBe('FIX50ZZ');
  });
  it('rejects an unknown or inactive code', async () => {
    await expect(validateCoupon(prisma, 'NOPEZZ', { subtotal: 1000 })).rejects.toBeInstanceOf(CouponError);
    await expect(validateCoupon(prisma, 'OFFZZ', { subtotal: 1000 })).rejects.toBeInstanceOf(CouponError);
  });
  it('rejects below the minimum order', async () => {
    await expect(validateCoupon(prisma, 'MIN500ZZ', { subtotal: 200 })).rejects.toBeInstanceOf(CouponError);
  });
  it('rejects when the global cap is reached', async () => {
    await expect(validateCoupon(prisma, 'CAPZZ', { subtotal: 1000 })).rejects.toBeInstanceOf(CouponError);
  });
});
