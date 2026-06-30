import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { signCustomerToken } from '../src/lib/jwt';
import { hashPassword } from '../src/lib/password';

let app: FastifyInstance;
let tokenA = '';
let tokenB = '';
let ownedOrderNumber = '';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const a = await app.prisma.customer.create({ data: { email: 'acc-a-zz@test.com', name: 'A', passwordHash: await hashPassword('x12345678') } });
  const b = await app.prisma.customer.create({ data: { email: 'acc-b-zz@test.com', name: 'B', passwordHash: await hashPassword('x12345678') } });
  tokenA = signCustomerToken(a);
  tokenB = signCustomerToken(b);
  const order = await app.prisma.order.create({
    data: {
      orderNumber: 'RR-ACCTEST-0001', customerId: a.id, guestEmail: a.email, guestPhone: '0',
      status: 'PROCESSING', currency: 'BDT', subtotal: 100, shippingTotal: 0, discountTotal: 0, taxTotal: 0, grandTotal: 100,
      idempotencyKey: 'acc-test-idem-zz', orderToken: 'acc-test-token-zz', shippingSnapshot: { line1: 'x', city: 'Dhaka', district: 'Dhaka' },
      items: { create: [{ productId: 'p', variantId: 'v', productName: 'Bowl', variantName: 'Standard', sku: 'S', unitPrice: 100, quantity: 1, lineTotal: 100 }] },
    },
  });
  ownedOrderNumber = order.orderNumber;
});

afterAll(async () => {
  await app.prisma.order.deleteMany({ where: { idempotencyKey: 'acc-test-idem-zz' } });
  await app.prisma.customer.deleteMany({ where: { email: { in: ['acc-a-zz@test.com', 'acc-b-zz@test.com'] } } });
  await app.close();
});

const get = (url: string, token: string) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

describe('account orders', () => {
  it('dashboard returns the customer and recent orders', async () => {
    const res = await get('/api/account', tokenA);
    expect(res.statusCode).toBe(200);
    expect(res.json().customer.email).toBe('acc-a-zz@test.com');
    expect(res.json().recentOrders.length).toBeGreaterThanOrEqual(1);
  });

  it('lists only the owner\'s orders', async () => {
    expect((await get('/api/account/orders', tokenA)).json().some((o: any) => o.orderNumber === ownedOrderNumber)).toBe(true);
    expect((await get('/api/account/orders', tokenB)).json().some((o: any) => o.orderNumber === ownedOrderNumber)).toBe(false);
  });

  it('owner sees detail; a different customer gets 404', async () => {
    expect((await get(`/api/account/orders/${ownedOrderNumber}`, tokenA)).statusCode).toBe(200);
    expect((await get(`/api/account/orders/${ownedOrderNumber}`, tokenB)).statusCode).toBe(404);
  });
});
