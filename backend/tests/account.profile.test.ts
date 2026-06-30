import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { signCustomerToken } from '../src/lib/jwt';
import { hashPassword, verifyPassword } from '../src/lib/password';
import { issueOtp } from '../src/modules/auth/otp';

let app: FastifyInstance;
let token = '';
let customerId = '';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const c = await app.prisma.customer.create({ data: { email: 'prof-zz@test.com', name: 'Old Name', passwordHash: await hashPassword('OldPass123') } });
  customerId = c.id;
  token = signCustomerToken(c);
});

afterAll(async () => {
  await app.prisma.customer.deleteMany({ where: { email: 'prof-zz@test.com' } });
  await app.close();
});

const auth = { authorization: '' };
function h() { return { authorization: `Bearer ${token}` }; }

describe('account profile', () => {
  it('updates name + phone', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/account/profile', headers: h(), payload: { name: 'New Name', phone: '+8801711111111' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().customer.name).toBe('New Name');
    expect(res.json().customer.phone).toBe('+8801711111111');
  });

  it('changes password with current password + OTP', async () => {
    const code = await issueOtp(app.prisma, customerId, 'PASSWORD_CHANGE');
    const res = await app.inject({
      method: 'POST', url: '/api/account/password/change', headers: h(),
      payload: { code, currentPassword: 'OldPass123', newPassword: 'FreshPass456' },
    });
    expect(res.statusCode).toBe(200);
    const after = await app.prisma.customer.findUnique({ where: { id: customerId } });
    expect(await verifyPassword('FreshPass456', after!.passwordHash!)).toBe(true);
  });

  it('rejects password change with a wrong current password', async () => {
    const code = await issueOtp(app.prisma, customerId, 'PASSWORD_CHANGE');
    const res = await app.inject({
      method: 'POST', url: '/api/account/password/change', headers: h(),
      payload: { code, currentPassword: 'WrongNow', newPassword: 'Whatever789' },
    });
    expect(res.statusCode).toBe(400);
  });
});
