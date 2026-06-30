import type { FastifyInstance } from 'fastify';
import { round2 } from '../../lib/money';
import { customerContext } from '../auth/guards';
import { priceItems } from '../checkout/pricing';
import { validateBody } from './schemas';
import { validateCoupon } from './service';
import { CouponError } from './errors';

export default async function couponRoutes(app: FastifyInstance) {
  app.post(
    '/api/coupons/validate',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, preHandler: customerContext },
    async (request) => {
      const { code, items } = validateBody.parse(request.body);
      const { subtotal } = await priceItems(app.prisma, items);
      try {
        const { coupon, discount } = await validateCoupon(app.prisma, code, {
          subtotal,
          customerId: request.customerClaims?.sub,
        });
        return {
          valid: true as const,
          code: coupon.code,
          type: coupon.type,
          discount,
          subtotal,
          newTotal: round2(subtotal - discount),
          message: 'Code applied.',
        };
      } catch (e) {
        if (e instanceof CouponError) return { valid: false as const, message: e.message };
        throw e;
      }
    },
  );
}
