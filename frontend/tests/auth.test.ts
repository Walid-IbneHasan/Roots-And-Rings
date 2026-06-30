import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';

beforeAll(() => {
  process.env.JWT_SECRET = 'dev-jwt-secret-change-me-0123456789abcdef';
});

describe('verifySession', () => {
  it('verifies a valid token and rejects a bad one', async () => {
    const { verifySession } = await import('../src/lib/auth');
    const token = jwt.sign({ email: 'a@b.com', name: 'Aya' }, process.env.JWT_SECRET!, { subject: 'cust_1', expiresIn: '7d' });
    const s = verifySession(token);
    expect(s?.sub).toBe('cust_1');
    expect(s?.email).toBe('a@b.com');
    expect(verifySession('garbage')).toBeNull();
  });

  it('rejects an expired token', async () => {
    const { verifySession } = await import('../src/lib/auth');
    const token = jwt.sign({ email: 'a@b.com', name: 'Aya' }, process.env.JWT_SECRET!, { subject: 'cust_1', expiresIn: -10 });
    expect(verifySession(token)).toBeNull();
  });
});
