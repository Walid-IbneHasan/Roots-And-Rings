import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loginAdmin, csrfFrom, formPost } from './helpers';

let app: FastifyInstance;
let cookie: string;
let slug = '';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  cookie = await loginAdmin(app);
  const ps = await app.prisma.product.findMany({ where: { isActive: true }, take: 1, select: { slug: true } });
  slug = ps[0].slug;
});
afterAll(async () => {
  await app.prisma.order.deleteMany({ where: { guestEmail: 'fb-buyer-zz@test.com' } });
  await app.close();
});

describe('admin manual order create', () => {
  it('creates a Facebook order and redirects to its detail', async () => {
    const token = await csrfFrom(app, '/admin/orders/new', cookie);
    const res = await formPost(app, '/admin/orders/new', cookie, token, {
      source: 'FACEBOOK', paid: 'on', [`qty_${slug}`]: '1',
      name: 'FB Buyer', email: 'fb-buyer-zz@test.com', phone: '01711111111',
      line1: '10 Gulshan', city: 'Dhaka', district: 'Dhaka',
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^\/admin\/orders\/.+/);

    const order = await app.prisma.order.findFirst({ where: { guestEmail: 'fb-buyer-zz@test.com' }, include: { payments: true } });
    expect(order).toBeTruthy();
    expect(order!.source).toBe('FACEBOOK');
    expect(order!.payments[0].provider).toBe('MANUAL');
    expect(order!.payments[0].status).toBe('PAID');
  });

  it('rejects a submission with no products', async () => {
    const token = await csrfFrom(app, '/admin/orders/new', cookie);
    const res = await formPost(app, '/admin/orders/new', cookie, token, {
      source: 'OTHER', name: 'X', email: 'noitems-zz@test.com', phone: '01700000000', line1: 'a', city: 'Dhaka', district: 'Dhaka',
    });
    expect(res.statusCode).toBe(400);
  });
});
