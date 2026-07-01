import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildApp } from '../src/app';
import { loginAdmin } from './helpers';

let app: FastifyInstance;
let cookie: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  cookie = await loginAdmin(app);
});
afterAll(async () => { await app.close(); });

// Build a real 2x2 PNG so processImage's magic-byte sniff accepts it.
async function pngBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 200, g: 180, b: 150 } } }).png().toBuffer();
}

// Encode a single-file multipart/form-data body (mirror tests/uploads.test.ts if it has a helper).
function multipart(field: string, filename: string, contentType: string, data: Buffer) {
  const boundary = '----rrtest' + Math.random().toString(16).slice(2);
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const post = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([pre, data, post]), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('POST /admin/uploads/image', () => {
  it('accepts an image and returns a .webp url', async () => {
    const { body, contentType } = multipart('image', 'photo.png', 'image/png', await pngBuffer());
    const res = await app.inject({
      method: 'POST', url: '/admin/uploads/image?kind=categories',
      headers: { cookie, 'content-type': contentType }, payload: body,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.url).toMatch(/^\/uploads\/categories\/.+\.webp$/);
  });

  it('rejects a non-image (400)', async () => {
    const { body, contentType } = multipart('image', 'note.txt', 'text/plain', Buffer.from('not an image'));
    const res = await app.inject({
      method: 'POST', url: '/admin/uploads/image?kind=categories',
      headers: { cookie, 'content-type': contentType }, payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires an admin session (redirects when unauthenticated)', async () => {
    const { body, contentType } = multipart('image', 'photo.png', 'image/png', await pngBuffer());
    const res = await app.inject({ method: 'POST', url: '/admin/uploads/image', headers: { 'content-type': contentType }, payload: body });
    expect(res.statusCode).toBe(302);
  });
});
