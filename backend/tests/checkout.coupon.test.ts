import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

let app: FastifyInstance;
const EMAIL = 'coup-co-zz@test.com';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const p = await app.prisma.product.create({
    data: { name: 'coupco-zz', slug: 'coupco-zz', sku: 'TEST-COUPCO', shortDescription: 'x', description: 'y', basePrice: 1000 },
  });
  await app.prisma.productVariant.create({ data: { productId: p.id, sku: 'TEST-COUPCO-V', name: 'Standard', stock: 20 } });
  await app.prisma.coupon.deleteMany({ where: { code: { in: ['CO20ZZ', 'ONCEZZ'] } } });
  await app.prisma.coupon.create({ data: { code: 'CO20ZZ', type: 'PERCENT', value: 20 } });
  await app.prisma.coupon.create({ data: { code: 'ONCEZZ', type: 'FIXED', value: 100, maxRedemptions: 1 } });
});
afterAll(async () => {
  await app.prisma.order.deleteMany({ where: { guestEmail: EMAIL } });
  await app.prisma.coupon.deleteMany({ where: { code: { in: ['CO20ZZ', 'ONCEZZ'] } } });
  await app.prisma.product.deleteMany({ where: { sku: 'TEST-COUPCO' } });
  await app.close();
});

const body = (idem: string, couponCode?: string) => ({
  items: [{ slug: 'coupco-zz', qty: 1 }],
  contact: { name: 'Coup', email: EMAIL, phone: '+8801700000000' },
  shipping: { line1: '1 Rd', city: 'Dhaka', district: 'Dhaka' },
  paymentMethod: 'COD',
  idempotencyKey: idem,
  ...(couponCode ? { couponCode } : {}),
});
const post = (b: object) => app.inject({ method: 'POST', url: '/api/checkout', payload: b });

describe('checkout with coupon', () => {
  it('applies the discount, records a redemption, increments the counter', async () => {
    const res = await post(body('co-ok-zz', 'co20zz'));
    expect(res.statusCode).toBe(200);
    const order = await app.prisma.order.findUnique({ where: { orderNumber: res.json().orderNumber }, include: { payments: true } });
    expect(Number(order!.discountTotal)).toBe(200);
    expect(Number(order!.grandTotal)).toBe(800);
    expect(order!.couponCode).toBe('CO20ZZ');
    expect(Number(order!.payments[0].amount)).toBe(800);
    const c = await app.prisma.coupon.findUnique({ where: { code: 'CO20ZZ' } });
    expect(c!.timesRedeemed).toBeGreaterThanOrEqual(1);
    const reds = await app.prisma.couponRedemption.count({ where: { orderId: order!.id } });
    expect(reds).toBe(1);
  });
  it('replay (same idempotency key) does not double-redeem', async () => {
    const first = (await post(body('co-replay-zz', 'co20zz'))).json();
    const c1 = (await app.prisma.coupon.findUnique({ where: { code: 'CO20ZZ' } }))!.timesRedeemed;
    const second = (await post(body('co-replay-zz', 'co20zz'))).json();
    expect(second.orderNumber).toBe(first.orderNumber);
    const c2 = (await app.prisma.coupon.findUnique({ where: { code: 'CO20ZZ' } }))!.timesRedeemed;
    expect(c2).toBe(c1);
  });
  it('rejects an invalid code at submit (no order created)', async () => {
    const res = await post(body('co-bad-zz', 'NOPEZZ'));
    expect(res.statusCode).toBe(400);
    const order = await app.prisma.order.findFirst({ where: { idempotencyKey: 'co-bad-zz' } });
    expect(order).toBeNull();
  });
  it('enforces a reached cap at submit', async () => {
    await post(body('once-1-zz', 'oncezz')); // consumes the single redemption
    const res = await post(body('once-2-zz', 'oncezz'));
    expect(res.statusCode).toBe(400);
  });
});
