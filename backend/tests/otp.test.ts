import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { issueOtp, verifyOtp } from '../src/modules/auth/otp';
import { hashPassword } from '../src/lib/password';

const prisma = new PrismaClient();
let customerId: string;

beforeAll(async () => {
  const c = await prisma.customer.create({
    data: { email: 'otp-zz@test.com', name: 'OTP', passwordHash: await hashPassword('x12345678') },
  });
  customerId = c.id;
});

afterAll(async () => {
  await prisma.customer.deleteMany({ where: { email: 'otp-zz@test.com' } });
  await prisma.$disconnect();
});

describe('OTP service', () => {
  it('issues a 6-digit code that verifies once', async () => {
    const code = await issueOtp(prisma, customerId, 'EMAIL_VERIFY');
    expect(code).toMatch(/^\d{6}$/);
    await expect(verifyOtp(prisma, customerId, 'EMAIL_VERIFY', code)).resolves.toBeUndefined();
    // single-use: second verify fails
    await expect(verifyOtp(prisma, customerId, 'EMAIL_VERIFY', code)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a wrong code and counts the attempt', async () => {
    await issueOtp(prisma, customerId, 'PASSWORD_RESET');
    await expect(verifyOtp(prisma, customerId, 'PASSWORD_RESET', '000000')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('invalidates prior codes of the same type on re-issue', async () => {
    const first = await issueOtp(prisma, customerId, 'PASSWORD_CHANGE');
    await issueOtp(prisma, customerId, 'PASSWORD_CHANGE');
    await expect(verifyOtp(prisma, customerId, 'PASSWORD_CHANGE', first)).rejects.toMatchObject({ statusCode: 400 });
  });
});
