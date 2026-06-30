import type { Coupon, Prisma, PrismaClient } from '@prisma/client';
import { round2 } from '../../lib/money';
import { CouponError } from './errors';

type Db = PrismaClient | Prisma.TransactionClient;

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function computeDiscount(coupon: Pick<Coupon, 'type' | 'value'>, subtotal: number): number {
  const value = Number(coupon.value);
  const raw = coupon.type === 'PERCENT' ? round2((subtotal * value) / 100) : value;
  return round2(Math.min(Math.max(raw, 0), subtotal));
}

export interface CouponContext {
  subtotal: number;
  customerId?: string;
  email?: string;
}

/** Validate a coupon for a given context. No writes. Throws CouponError on any failure. */
export async function validateCoupon(db: Db, code: string, ctx: CouponContext): Promise<{ coupon: Coupon; discount: number }> {
  const coupon = await db.coupon.findUnique({ where: { code: normalizeCode(code) } });
  if (!coupon || !coupon.isActive) throw new CouponError('This code isn\'t valid.');
  const now = new Date();
  if (coupon.startsAt && now < coupon.startsAt) throw new CouponError('This code isn\'t active yet.');
  if (coupon.endsAt && now > coupon.endsAt) throw new CouponError('This code has expired.');
  if (ctx.subtotal < Number(coupon.minOrderSubtotal)) {
    throw new CouponError(`Spend at least ৳${Number(coupon.minOrderSubtotal)} to use this code.`);
  }
  if (coupon.maxRedemptions != null && coupon.timesRedeemed >= coupon.maxRedemptions) {
    throw new CouponError('This code has reached its usage limit.');
  }
  if (coupon.perCustomerLimit != null) {
    const scope = ctx.customerId
      ? { customerId: ctx.customerId }
      : ctx.email
        ? { email: ctx.email.toLowerCase() }
        : null;
    if (scope) {
      const used = await db.couponRedemption.count({ where: { couponId: coupon.id, ...scope } });
      if (used >= coupon.perCustomerLimit) throw new CouponError('You\'ve already used this code.');
    }
  }
  return { coupon, discount: computeDiscount(coupon, ctx.subtotal) };
}
