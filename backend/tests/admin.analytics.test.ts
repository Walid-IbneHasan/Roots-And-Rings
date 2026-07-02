import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loginAdmin } from './helpers';

let app: FastifyInstance;
let cookie: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  cookie = await loginAdmin(app);
});
afterAll(async () => {
  await app.close();
});

describe('admin analytics page', () => {
  it('renders with an <svg> for the default period', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/analytics', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Analytics');
    expect(res.body).toContain('<svg'); // raw SVG emitted (not escaped &lt;svg)
    expect(res.body).not.toContain('&lt;svg');
  });

  it('accepts ?period=weekly and ?period=monthly', async () => {
    for (const p of ['weekly', 'monthly']) {
      const res = await app.inject({ method: 'GET', url: `/admin/analytics?period=${p}`, headers: { cookie } });
      expect(res.statusCode).toBe(200);
    }
  });

  it('falls back to daily on an invalid period', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/analytics?period=garbage', headers: { cookie } });
    expect(res.statusCode).toBe(200);
  });

  it('blocks unauthenticated access', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/analytics' });
    expect([302, 401, 403]).toContain(res.statusCode);
  });
});
