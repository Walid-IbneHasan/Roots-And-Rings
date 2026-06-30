import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { resolveGoogleCustomer } from '../src/modules/auth/google';

const prisma = new PrismaClient();
const SUB1 = 'google-sub-zz-1';
const SUB2 = 'google-sub-zz-2';
const EMAIL_NEW = 'gnew-zz@test.com';
const EMAIL_LINK = 'glink-zz@test.com';

afterAll(async () => {
  await prisma.customer.deleteMany({ where: { email: { in: [EMAIL_NEW, EMAIL_LINK] } } });
  await prisma.$disconnect();
});

describe('resolveGoogleCustomer', () => {
  it('creates a new customer with googleId, verified email, and no password', async () => {
    const c = await resolveGoogleCustomer(prisma, { sub: SUB1, email: EMAIL_NEW, name: 'G New' });
    expect(c.googleId).toBe(SUB1);
    expect(c.email).toBe(EMAIL_NEW);
    expect(c.passwordHash).toBeNull();
    expect(c.emailVerifiedAt).not.toBeNull();
  });

  it('returns the same customer on a repeat googleId (no duplicate)', async () => {
    const again = await resolveGoogleCustomer(prisma, { sub: SUB1, email: EMAIL_NEW, name: 'G New' });
    expect(again.googleId).toBe(SUB1);
    const all = await prisma.customer.findMany({ where: { email: EMAIL_NEW } });
    expect(all.length).toBe(1);
  });

  it('links an existing password account by email (sets googleId, keeps password)', async () => {
    const seeded = await prisma.customer.create({ data: { email: EMAIL_LINK, name: 'Has Pw', passwordHash: 'hash' } });
    const linked = await resolveGoogleCustomer(prisma, { sub: SUB2, email: EMAIL_LINK, name: 'Has Pw' });
    expect(linked.id).toBe(seeded.id);
    expect(linked.googleId).toBe(SUB2);
    expect(linked.passwordHash).toBe('hash');
  });
});
