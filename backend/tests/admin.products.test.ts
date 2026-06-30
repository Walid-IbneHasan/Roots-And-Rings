import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildApp } from '../src/app';
import { loginAdmin, csrfFrom, formPost } from './helpers';

let app: FastifyInstance;
let cookie: string;
let createdId: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  cookie = await loginAdmin(app);
});
afterAll(async () => {
  if (createdId) await app.prisma.product.deleteMany({ where: { id: createdId } });
  await app.close();
});

describe('admin products CRUD + upload', () => {
  it('requires auth', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/products' })).statusCode).toBe(302);
  });

  it('creates a product visible in the public API', async () => {
    const vessels = await app.prisma.category.findUnique({ where: { slug: 'vessels' } });
    const token = await csrfFrom(app, '/admin/products/new', cookie);
    const res = await formPost(app, '/admin/products/new', cookie, token, {
      name: 'Test Product ZZ',
      sku: 'RR-TEST-ZZ',
      shortDescription: 'A temporary test product',
      description: '<p>Body <script>bad()</script></p>',
      basePrice: '999',
      categoryId: vessels!.id,
      isActive: 'on',
      isFeatured: 'on',
      minPerOrder: '1',
      currency: 'BDT',
    });
    expect(res.statusCode).toBe(302);

    const made = await app.prisma.product.findUnique({ where: { slug: 'test-product-zz' } });
    expect(made).toBeTruthy();
    createdId = made!.id;
    // description sanitized
    expect(made!.description).not.toContain('<script>');

    const detail = (await app.inject({ method: 'GET', url: '/api/products/test-product-zz' })).json();
    expect(detail.price).toBe(999);
    const featured = (await app.inject({ method: 'GET', url: '/api/featured' })).json();
    expect(featured.some((p: any) => p.slug === 'test-product-zz')).toBe(true);
  });

  it('uploads an image (multipart) that appears on the product', async () => {
    const png = await sharp({ create: { width: 30, height: 40, channels: 3, background: '#875134' } }).png().toBuffer();
    const boundary = '----rrtestboundary';
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="t.png"\r\nContent-Type: image/png\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const payload = Buffer.concat([head, png, tail]);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/products/${createdId}/images`,
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(res.statusCode).toBe(302);

    const detail = (await app.inject({ method: 'GET', url: '/api/products/test-product-zz' })).json();
    expect(detail.images.length).toBe(1);
    expect(detail.images[0].src).toMatch(/\/uploads\/products\/.+\.webp$/);
  });

  it('edits the price (reflected in the API)', async () => {
    const token = await csrfFrom(app, `/admin/products/${createdId}/edit`, cookie);
    const res = await formPost(app, `/admin/products/${createdId}/edit`, cookie, token, {
      name: 'Test Product ZZ',
      sku: 'RR-TEST-ZZ',
      shortDescription: 'A temporary test product',
      basePrice: '555',
      isActive: 'on',
      minPerOrder: '1',
      currency: 'BDT',
    });
    expect(res.statusCode).toBe(302);
    const detail = (await app.inject({ method: 'GET', url: '/api/products/test-product-zz' })).json();
    expect(detail.price).toBe(555);
  });

  it('deletes the product', async () => {
    const token = await csrfFrom(app, '/admin/products', cookie);
    const res = await formPost(app, `/admin/products/${createdId}/delete`, cookie, token, {});
    expect(res.statusCode).toBe(302);
    expect(await app.prisma.product.findUnique({ where: { id: createdId } })).toBeNull();
    createdId = '';
  });
});
