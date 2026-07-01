import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loginAdmin, csrfFrom, formPost } from './helpers';

let app: FastifyInstance;
let cookie: string;

// The test's category slug — cleared before AND after so the suite is order-independent.
// (A leftover 'test-collection-zz' makes the create's uniqueSlug shift the new slug to
// 'test-collection-zz-2', so the exact-slug lookup in the public-API assertion would miss.)
const TEST_SLUG_PREFIX = 'test-collection-zz';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await app.prisma.category.deleteMany({ where: { slug: { startsWith: TEST_SLUG_PREFIX } } });
  cookie = await loginAdmin(app);
});
afterAll(async () => {
  await app.prisma.category.deleteMany({ where: { slug: { startsWith: TEST_SLUG_PREFIX } } });
  await app.close();
});

describe('admin categories CRUD', () => {
  it('requires auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/categories' });
    expect(res.statusCode).toBe(302);
  });

  it('creates, lists, and deletes a category (and reflects in public API)', async () => {
    const token = await csrfFrom(app, '/admin/categories/new', cookie);
    const create = await formPost(app, '/admin/categories/new', cookie, token, {
      kind: 'COLLECTION',
      name: 'Test Collection ZZ',
      tagline: 'A temporary test collection',
      isActive: 'on',
      sortOrder: '99',
    });
    expect(create.statusCode).toBe(302);

    // appears in public collections API
    const cols = (await app.inject({ method: 'GET', url: '/api/collections' })).json();
    const made = cols.find((c: any) => c.slug === 'test-collection-zz');
    expect(made).toBeTruthy();

    // appears in admin list
    const list = await app.inject({ method: 'GET', url: '/admin/categories', headers: { cookie } });
    expect(list.body).toContain('Test Collection ZZ');

    // find its id, delete it
    const cat = await app.prisma.category.findUnique({ where: { slug: 'test-collection-zz' } });
    expect(cat).toBeTruthy();
    const delToken = await csrfFrom(app, '/admin/categories', cookie);
    const del = await formPost(app, `/admin/categories/${cat!.id}/delete`, cookie, delToken, {});
    expect(del.statusCode).toBe(302);
    expect(await app.prisma.category.findUnique({ where: { slug: 'test-collection-zz' } })).toBeNull();
  });
});
