import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { signCustomerToken } from '../src/lib/jwt';
import { hashPassword } from '../src/lib/password';

let app: FastifyInstance;
let token = '';
let customerId = '';
const EMAIL = 'co-cust-zz@test.com';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const c = await app.prisma.customer.create({ data: { email: EMAIL, name: 'CO', passwordHash: await hashPassword('x12345678') } });
  customerId = c.id;
  token = signCustomerToken(c);
  const p = await app.prisma.product.create({ data: { name: 'co-cust', slug: 'co-cust-zz', sku: 'TEST-COCUST', shortDescription: 'x', description: 'y', basePrice: 200 } });
  await app.prisma.productVariant.create({ data: { productId: p.id, sku: 'TEST-COCUST-V', name: 'Standard', stock: 5 } });
});

afterAll(async () => {
  await app.prisma.order.deleteMany({ where: { guestEmail: EMAIL } });
  await app.prisma.product.deleteMany({ where: { sku: 'TEST-COCUST' } });
  await app.prisma.customer.deleteMany({ where: { email: EMAIL } });
  await app.close();
});

const body = (idem: string) => ({
  items: [{ slug: 'co-cust-zz', qty: 1 }],
  contact: { name: 'CO', email: EMAIL, phone: '+8801700000000' },
  shipping: { line1: '1 Rd', city: 'Dhaka', district: 'Dhaka' },
  paymentMethod: 'COD', idempotencyKey: idem,
});

describe('checkout customer attribution', () => {
  it('attaches customerId when authenticated', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/checkout', headers: { authorization: `Bearer ${token}` }, payload: body('co-auth-zz') });
    expect(res.statusCode).toBe(200);
    const order = await app.prisma.order.findUnique({ where: { orderNumber: res.json().orderNumber } });
    expect(order!.customerId).toBe(customerId);
  });

  it('stays guest (null customerId) without a token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/checkout', payload: body('co-guest-zz') });
    const order = await app.prisma.order.findUnique({ where: { orderNumber: res.json().orderNumber } });
    expect(order!.customerId).toBeNull();
  });
});
