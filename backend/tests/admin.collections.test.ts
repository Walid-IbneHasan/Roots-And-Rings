import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loginAdmin, csrfFrom, formPost } from './helpers';

let app: FastifyInstance;
let cookie: string;
const TAG = 'colladmin-zz';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  cookie = await loginAdmin(app);
  await app.prisma.category.deleteMany({ where: { OR: [{ slug: { startsWith: TAG } }, { name: 'ZZ New Collection Admin' }] } });
  await app.prisma.category.create({ data: { kind: 'PRODUCT_TYPE', name: 'ZZ Type Marker Admin', slug: `${TAG}-type` } });
  await app.prisma.category.create({ data: { kind: 'COLLECTION', name: 'ZZ Collection Marker Admin', slug: `${TAG}-coll` } });
});
afterAll(async () => {
  await app.prisma.category.deleteMany({ where: { OR: [{ slug: { startsWith: TAG } }, { name: 'ZZ New Collection Admin' }] } });
  await app.close();
});

describe('admin collections section', () => {
  it('GET /admin/collections lists collections but not product-types', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/collections', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('ZZ Collection Marker Admin');
    expect(res.body).not.toContain('ZZ Type Marker Admin');
  });
  it('GET /admin/categories lists product-types but not collections', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/categories', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('ZZ Type Marker Admin');
    expect(res.body).not.toContain('ZZ Collection Marker Admin');
  });
  it('POST /admin/collections/new creates a COLLECTION and redirects to /admin/collections', async () => {
    const token = await csrfFrom(app, '/admin/collections/new', cookie);
    const res = await formPost(app, '/admin/collections/new', cookie, token, { name: 'ZZ New Collection Admin', isActive: 'on', sortOrder: '0' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/admin/collections');
    const row = await app.prisma.category.findFirst({ where: { name: 'ZZ New Collection Admin' } });
    expect(row?.kind).toBe('COLLECTION');
  });
});
