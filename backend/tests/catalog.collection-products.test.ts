import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { getProductsByCollection } from '../src/modules/catalog/service';

let app: FastifyInstance;
const TAG = 'colp-zz';
let collSlug = '';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await app.prisma.product.deleteMany({ where: { sku: { startsWith: TAG } } });
  await app.prisma.category.deleteMany({ where: { slug: { startsWith: TAG } } });
  const coll = await app.prisma.category.create({ data: { kind: 'COLLECTION', name: 'ZZ ColP', slug: `${TAG}-coll`, isActive: true } });
  collSlug = coll.slug;
  await app.prisma.product.create({ data: { name: 'ZZ In Active', slug: `${TAG}-in-active`, sku: `${TAG}-1`, shortDescription: 'x', description: 'x', basePrice: 100, isActive: true, collections: { connect: [{ id: coll.id }] }, variants: { create: [{ sku: `${TAG}-1v`, name: 'Std', stock: 5, isActive: true, position: 0 }] } } });
  await app.prisma.product.create({ data: { name: 'ZZ In Inactive', slug: `${TAG}-in-inactive`, sku: `${TAG}-2`, shortDescription: 'x', description: 'x', basePrice: 100, isActive: false, collections: { connect: [{ id: coll.id }] } } });
  await app.prisma.product.create({ data: { name: 'ZZ Out Active', slug: `${TAG}-out-active`, sku: `${TAG}-3`, shortDescription: 'x', description: 'x', basePrice: 100, isActive: true } });
});
afterAll(async () => {
  await app.prisma.product.deleteMany({ where: { sku: { startsWith: TAG } } });
  await app.prisma.category.deleteMany({ where: { slug: { startsWith: TAG } } });
  await app.close();
});

describe('getProductsByCollection', () => {
  it('returns only active products in the collection', async () => {
    const slugs = (await getProductsByCollection(app.prisma, collSlug)).map((p) => p.slug);
    expect(slugs).toContain(`${TAG}-in-active`);
    expect(slugs).not.toContain(`${TAG}-in-inactive`);
    expect(slugs).not.toContain(`${TAG}-out-active`);
  });
  it('returns [] for an unknown collection', async () => {
    expect(await getProductsByCollection(app.prisma, 'no-such-collection-zz')).toEqual([]);
  });
  it('route GET /api/collections/:slug/products returns the array', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/collections/${collSlug}/products` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.map((p: { slug: string }) => p.slug)).toContain(`${TAG}-in-active`);
  });
  it('route returns [] for an unknown slug', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/collections/no-such-zz/products' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
