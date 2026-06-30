import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loginAdmin, csrfFrom, formPost } from './helpers';

let app: FastifyInstance;
let cookie: string;
let orderId: string;
let orderNumber: string;
const EMAIL = 'admin-order-zz@test.com';
const VSKU = 'TEST-AO-V-test-ao-zz';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  cookie = await loginAdmin(app);
  const product = await app.prisma.product.create({
    data: { name: 'AO', slug: 'test-ao-zz', sku: 'TEST-AO-test-ao-zz', shortDescription: 'x', description: 'y', basePrice: 300, allowBackorder: false },
  });
  await app.prisma.productVariant.create({ data: { productId: product.id, sku: VSKU, name: 'Standard', stock: 5 } });
  const res = await app.inject({
    method: 'POST',
    url: '/api/checkout',
    payload: {
      items: [{ slug: 'test-ao-zz', qty: 1 }],
      contact: { name: 'AO Buyer', email: EMAIL, phone: '+8801711111111' },
      shipping: { line1: '1 Rd', city: 'Dhaka', district: 'Dhaka' },
      paymentMethod: 'COD',
      idempotencyKey: 'idem-ao-zz',
    },
  });
  orderNumber = res.json().orderNumber;
  orderId = (await app.prisma.order.findUnique({ where: { orderNumber } }))!.id;
});

afterAll(async () => {
  await app.prisma.job.deleteMany({ where: { type: 'email.order_confirmation' } });
  await app.prisma.order.deleteMany({ where: { guestEmail: EMAIL } });
  await app.prisma.product.deleteMany({ where: { sku: { startsWith: 'TEST-AO-' } } });
  await app.close();
});

describe('admin orders', () => {
  it('lists and shows the order', async () => {
    const list = await app.inject({ method: 'GET', url: '/admin/orders', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.body).toContain(orderNumber);
    const detail = await app.inject({ method: 'GET', url: `/admin/orders/${orderId}`, headers: { cookie } });
    expect(detail.statusCode).toBe(200);
  });

  it('rejects an invalid transition', async () => {
    const token = await csrfFrom(app, `/admin/orders/${orderId}`, cookie);
    const res = await formPost(app, `/admin/orders/${orderId}/status`, cookie, token, { status: 'PAID' });
    expect(res.statusCode).toBe(400);
  });

  it('ships, delivers (settles COD), then refunds + restocks', async () => {
    let token = await csrfFrom(app, `/admin/orders/${orderId}`, cookie);
    expect((await formPost(app, `/admin/orders/${orderId}/status`, cookie, token, { status: 'SHIPPED' })).statusCode).toBe(302);

    token = await csrfFrom(app, `/admin/orders/${orderId}`, cookie);
    expect((await formPost(app, `/admin/orders/${orderId}/status`, cookie, token, { status: 'DELIVERED' })).statusCode).toBe(302);
    const pay = await app.prisma.payment.findFirst({ where: { orderId } });
    expect(pay!.status).toBe('PAID');

    const variantBefore = await app.prisma.productVariant.findUnique({ where: { sku: VSKU } });
    expect(variantBefore!.stock).toBe(4); // 5 − 1 committed

    token = await csrfFrom(app, `/admin/orders/${orderId}`, cookie);
    expect((await formPost(app, `/admin/orders/${orderId}/refund`, cookie, token, { amount: '300' })).statusCode).toBe(302);
    const order = await app.prisma.order.findUnique({ where: { id: orderId } });
    expect(order!.status).toBe('REFUNDED');
    const variantAfter = await app.prisma.productVariant.findUnique({ where: { sku: VSKU } });
    expect(variantAfter!.stock).toBe(5); // restocked
  });
});
