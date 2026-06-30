import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loginAdmin, csrfFrom, formPost, cookieHeader } from './helpers';

let app: FastifyInstance;
let cookie: string;
let csrf: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  cookie = await loginAdmin(app);
  csrf = await csrfFrom(app, '/admin/coupons/new', cookie);
});
afterAll(async () => {
  await app.prisma.coupon.deleteMany({ where: { code: { in: ['ADMINPCTZZ', 'ADMINFIXZZ'] } } });
  await app.close();
});

describe('admin coupons', () => {
  it('creates a percent coupon and lists it', async () => {
    const res = await formPost(app, '/admin/coupons', cookie, csrf, { code: 'adminpctzz', type: 'PERCENT', value: '15', description: '15% off' });
    expect([302, 303]).toContain(res.statusCode);
    const c = await app.prisma.coupon.findUnique({ where: { code: 'ADMINPCTZZ' } });
    expect(c).not.toBeNull();
    expect(c!.type).toBe('PERCENT');
    const list = await app.inject({ method: 'GET', url: '/admin/coupons', headers: { cookie } });
    expect(list.body).toContain('ADMINPCTZZ');
  });
  it('deactivates a coupon', async () => {
    await app.prisma.coupon.create({ data: { code: 'ADMINFIXZZ', type: 'FIXED', value: 50 } });
    const c = await app.prisma.coupon.findUnique({ where: { code: 'ADMINFIXZZ' } });
    const res = await formPost(app, `/admin/coupons/${c!.id}/deactivate`, cookie, csrf, {});
    expect([302, 303]).toContain(res.statusCode);
    const after = await app.prisma.coupon.findUnique({ where: { id: c!.id } });
    expect(after!.isActive).toBe(false);
  });
  it('rejects a duplicate code', async () => {
    const res = await formPost(app, '/admin/coupons', cookie, csrf, { code: 'adminpctzz', type: 'PERCENT', value: '10' });
    expect(res.statusCode).toBe(400);
  });
});
