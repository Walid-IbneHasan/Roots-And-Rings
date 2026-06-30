import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

let app: FastifyInstance;
const EMAIL = 'checkout-zz@test.com';

async function makeProduct(slug: string, stock: number, allowBackorder: boolean) {
  const product = await app.prisma.product.create({
    data: { name: slug, slug, sku: `TEST-CO-${slug}`, shortDescription: 'x', description: 'y', basePrice: 200, allowBackorder },
  });
  await app.prisma.productVariant.create({ data: { productId: product.id, sku: `TEST-CO-V-${slug}`, name: 'Standard', stock } });
  return product.id;
}

const baseBody = (slug: string, idempotencyKey: string) => ({
  items: [{ slug, qty: 1 }],
  contact: { name: 'Test Buyer', email: EMAIL, phone: '+8801700000000' },
  shipping: { line1: '12 Test Rd', city: 'Dhaka', district: 'Dhaka', postalCode: '1200' },
  paymentMethod: 'COD',
  idempotencyKey,
});

const post = (body: object) => app.inject({ method: 'POST', url: '/api/checkout', payload: body });

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await makeProduct('test-checkout-zz', 3, false);
  await makeProduct('test-oos-zz', 0, false);
});

afterAll(async () => {
  await app.prisma.order.deleteMany({ where: { guestEmail: EMAIL } });
  await app.prisma.product.deleteMany({ where: { sku: { startsWith: 'TEST-CO-' } } });
  await app.close();
});

describe('POST /api/checkout (COD)', () => {
  it('creates a PROCESSING order, decrements stock', async () => {
    const res = await post(baseBody('test-checkout-zz', 'idem-cod-1-zz'));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('PROCESSING');
    expect(body.orderNumber).toMatch(/^RR-\d{8}-/);
    expect(body.orderToken).toBeTruthy();

    const order = await app.prisma.order.findUnique({ where: { orderNumber: body.orderNumber }, include: { items: true, payments: true } });
    expect(order!.items.length).toBe(1);
    expect(order!.payments[0].provider).toBe('COD');
    const variant = await app.prisma.productVariant.findFirst({ where: { sku: 'TEST-CO-V-test-checkout-zz' } });
    expect(variant!.stock).toBe(2);
  });

  it('is idempotent on replay (no double order / decrement)', async () => {
    const first = (await post(baseBody('test-checkout-zz', 'idem-replay-zz'))).json();
    const second = (await post(baseBody('test-checkout-zz', 'idem-replay-zz'))).json();
    expect(second.orderNumber).toBe(first.orderNumber);
    const variant = await app.prisma.productVariant.findFirst({ where: { sku: 'TEST-CO-V-test-checkout-zz' } });
    expect(variant!.stock).toBe(1); // decremented once more (from 2→1), not twice
  });

  it('rejects out-of-stock with 409', async () => {
    const res = await post(baseBody('test-oos-zz', 'idem-oos-zz'));
    expect(res.statusCode).toBe(409);
  });
});

describe('GET /api/orders/:orderNumber', () => {
  it('returns the order with a valid token, 404 otherwise', async () => {
    const placed = (await post(baseBody('test-checkout-zz', 'idem-get-zz'))).json();
    const ok = await app.inject({ method: 'GET', url: `/api/orders/${placed.orderNumber}?token=${placed.orderToken}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().orderNumber).toBe(placed.orderNumber);

    const bad = await app.inject({ method: 'GET', url: `/api/orders/${placed.orderNumber}?token=wrong` });
    expect(bad.statusCode).toBe(404);
  });
});

describe('POST /cron/expire-orders', () => {
  it('requires the cron token', async () => {
    expect((await app.inject({ method: 'POST', url: '/cron/expire-orders' })).statusCode).toBe(401);
  });
  it('runs with the token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/cron/expire-orders',
      headers: { 'x-cron-token': process.env.CRON_TOKEN ?? 'dev-cron-token-change-me' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('releasedReservations');
  });
});
