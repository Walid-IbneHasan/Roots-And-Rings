import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

let app: FastifyInstance;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@rootsandrings.example';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';

function cookieHeader(res: { cookies: { name: string; value: string }[] }): string {
  return res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

async function login(email: string, password: string) {
  return app.inject({
    method: 'POST',
    url: '/admin/login',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ email, password }).toString(),
  });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('admin auth', () => {
  it('redirects unauthenticated /admin to login', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
  });

  it('renders the login page', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/login' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Sign in');
  });

  it('rejects wrong credentials', async () => {
    const res = await login(ADMIN_EMAIL, 'wrong-password');
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain('Invalid credentials');
  });

  it('logs in with correct credentials and reaches the dashboard', async () => {
    const res = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/admin');
    const cookie = cookieHeader(res);
    expect(cookie).toContain('rr_admin_sid');

    const dash = await app.inject({ method: 'GET', url: '/admin', headers: { cookie } });
    expect(dash.statusCode).toBe(200);
    expect(dash.body).toContain('Dashboard');
  });
});
