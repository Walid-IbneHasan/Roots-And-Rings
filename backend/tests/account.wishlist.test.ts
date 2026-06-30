import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { signCustomerToken } from '../src/lib/jwt';
import { hashPassword } from '../src/lib/password';

let app: FastifyInstance;
let token1 = '';
let token2 = '';
let slug1 = '';
let slug2 = '';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const c1 = await app.prisma.customer.create({ data: { email: 'wl1-zz@test.com', name: 'WL1', passwordHash: await hashPassword('x12345678') } });
  const c2 = await app.prisma.customer.create({ data: { email: 'wl2-zz@test.com', name: 'WL2', passwordHash: await hashPassword('x12345678') } });
  token1 = signCustomerToken(c1);
  token2 = signCustomerToken(c2);
  const ps = await app.prisma.product.findMany({ where: { isActive: true }, take: 2, select: { slug: true } });
  slug1 = ps[0].slug;
  slug2 = ps[1].slug;
});

afterAll(async () => {
  await app.prisma.customer.deleteMany({ where: { email: { in: ['wl1-zz@test.com', 'wl2-zz@test.com'] } } });
  await app.close();
});

const h1 = () => ({ authorization: `Bearer ${token1}` });
const h2 = () => ({ authorization: `Bearer ${token2}` });

describe('account wishlist', () => {
  it('adds, lists, dedupes, 404s unknown, deletes', async () => {
    const add = await app.inject({ method: 'POST', url: '/api/account/wishlist', headers: h1(), payload: { slug: slug1 } });
    expect(add.statusCode).toBe(201);
    let list = await app.inject({ method: 'GET', url: '/api/account/wishlist', headers: h1() });
    expect(list.json()).toEqual([slug1]);

    await app.inject({ method: 'POST', url: '/api/account/wishlist', headers: h1(), payload: { slug: slug1 } });
    list = await app.inject({ method: 'GET', url: '/api/account/wishlist', headers: h1() });
    expect(list.json()).toEqual([slug1]); // idempotent — still one

    const bad = await app.inject({ method: 'POST', url: '/api/account/wishlist', headers: h1(), payload: { slug: 'no-such-slug-xyz' } });
    expect(bad.statusCode).toBe(404);

    const del = await app.inject({ method: 'DELETE', url: `/api/account/wishlist/${slug1}`, headers: h1() });
    expect(del.statusCode).toBe(200);
    list = await app.inject({ method: 'GET', url: '/api/account/wishlist', headers: h1() });
    expect(list.json()).toEqual([]);
  });

  it('merge unions provided slugs, ignores unknown, returns the full list', async () => {
    await app.inject({ method: 'POST', url: '/api/account/wishlist', headers: h1(), payload: { slug: slug1 } });
    const merged = await app.inject({ method: 'POST', url: '/api/account/wishlist/merge', headers: h1(), payload: { slugs: [slug2, 'no-such-slug-xyz'] } });
    expect(merged.statusCode).toBe(200);
    const slugs = merged.json() as string[];
    expect(slugs).toContain(slug1);
    expect(slugs).toContain(slug2);
    expect(slugs).not.toContain('no-such-slug-xyz');
    expect(slugs.length).toBe(2);
  });

  it('is owner-scoped — a second customer sees none of the first customer items', async () => {
    const list2 = await app.inject({ method: 'GET', url: '/api/account/wishlist', headers: h2() });
    expect(list2.json()).toEqual([]);
  });

  it('requires auth', async () => {
    const noauth = await app.inject({ method: 'GET', url: '/api/account/wishlist' });
    expect(noauth.statusCode).toBe(401);
  });
});
