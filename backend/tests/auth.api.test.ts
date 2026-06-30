import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { issueOtp } from '../src/modules/auth/otp';

let app: FastifyInstance;
const EMAIL = 'auth-zz@test.com';
const PASS = 'Supersecret1';

const post = (url: string, payload: object, token?: string) =>
  app.inject({ method: 'POST', url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.prisma.customer.deleteMany({ where: { email: { in: [EMAIL, EMAIL.toUpperCase().toLowerCase()] } } });
  await app.close();
});

describe('auth', () => {
  it('registers, logs in, and returns me', async () => {
    const reg = await post('/api/auth/register', { name: 'Zoe', email: EMAIL, password: PASS });
    expect(reg.statusCode).toBe(201);
    const token = reg.json().token;
    expect(token).toBeTruthy();
    expect(reg.json().customer.email).toBe(EMAIL);
    expect(reg.json().customer.passwordHash).toBeUndefined();

    const dup = await post('/api/auth/register', { name: 'Zoe', email: EMAIL, password: PASS });
    expect(dup.statusCode).toBe(409);

    const bad = await post('/api/auth/login', { email: EMAIL, password: 'wrong' });
    expect(bad.statusCode).toBe(401);

    const ok = await post('/api/auth/login', { email: EMAIL, password: PASS });
    expect(ok.statusCode).toBe(200);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${ok.json().token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().customer.email).toBe(EMAIL);

    const noauth = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(noauth.statusCode).toBe(401);
  });

  it('verifies email with an issued code', async () => {
    const login = await post('/api/auth/login', { email: EMAIL, password: PASS });
    const token = login.json().token;
    const customer = await app.prisma.customer.findUnique({ where: { email: EMAIL } });
    const code = await issueOtp(app.prisma, customer!.id, 'EMAIL_VERIFY');
    const res = await post('/api/auth/verify-email', { code }, token);
    expect(res.statusCode).toBe(200);
    const after = await app.prisma.customer.findUnique({ where: { email: EMAIL } });
    expect(after!.emailVerifiedAt).not.toBeNull();
  });

  it('resets password via an issued code (and forgot is enumeration-safe)', async () => {
    const forgotUnknown = await post('/api/auth/forgot-password', { email: 'nobody-zz@test.com' });
    expect(forgotUnknown.statusCode).toBe(200);

    const customer = await app.prisma.customer.findUnique({ where: { email: EMAIL } });
    const code = await issueOtp(app.prisma, customer!.id, 'PASSWORD_RESET');
    const reset = await post('/api/auth/reset-password', { email: EMAIL, code, newPassword: 'BrandNew123' });
    expect(reset.statusCode).toBe(200);

    const relog = await post('/api/auth/login', { email: EMAIL, password: 'BrandNew123' });
    expect(relog.statusCode).toBe(200);
  });
});
