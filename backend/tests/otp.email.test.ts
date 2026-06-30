import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { sentMessages, resetSentMessages } from '../src/modules/notifications/email';

let app: FastifyInstance;
const EMAIL = 'otpmail-zz@test.com';

beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.prisma.customer.deleteMany({ where: { email: EMAIL } }); await app.close(); });
beforeEach(() => resetSentMessages());

describe('OTP email send', () => {
  it('register captures a verify-email message', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Otp Mail', email: EMAIL, password: 'Supersecret1' } });
    expect(res.statusCode).toBe(201);
    expect(sentMessages.some((m) => m.to === EMAIL && m.subject === 'Verify your email')).toBe(true);
  });
});
