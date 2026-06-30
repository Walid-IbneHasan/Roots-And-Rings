import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { redeemCoupon } from '../src/modules/coupons/service';
import { CouponError } from '../src/modules/coupons/errors';

const prisma = new PrismaClient();
const code = 'CONCURZZ';

beforeAll(async () => {
  await prisma.couponRedemption.deleteMany({ where: { coupon: { code } } });
  await prisma.coupon.deleteMany({ where: { code } });
  await prisma.coupon.create({ data: { code, type: 'FIXED', value: 50, maxRedemptions: 1 } });
});
afterAll(async () => {
  await prisma.couponRedemption.deleteMany({ where: { coupon: { code } } });
  await prisma.coupon.deleteMany({ where: { code } });
  await prisma.$disconnect();
});

describe('redeemCoupon concurrency', () => {
  it('enforces the global cap (exactly one of N wins on cap=1)', async () => {
    const attempts = Array.from({ length: 8 }, (_, i) =>
      prisma
        .$transaction((tx) => redeemCoupon(tx, code, { subtotal: 1000, orderId: `concur-${i}`, email: `c${i}@test.com` }), {
          isolationLevel: 'ReadCommitted',
        })
        .then(() => 'ok')
        .catch((e) => (e instanceof CouponError ? 'rejected' : Promise.reject(e))),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === 'ok').length).toBe(1);
    const c = await prisma.coupon.findUnique({ where: { code } });
    expect(c!.timesRedeemed).toBe(1);
    const reds = await prisma.couponRedemption.count({ where: { couponId: c!.id } });
    expect(reds).toBe(1);
  });
});
