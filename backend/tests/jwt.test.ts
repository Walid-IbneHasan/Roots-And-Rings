import { describe, it, expect } from 'vitest';
import { signCustomerToken, verifyCustomerToken } from '../src/lib/jwt';

const c = { id: 'cust_1', email: 'a@b.com', name: 'Aya' };

describe('customer JWT', () => {
  it('round-trips claims', () => {
    const token = signCustomerToken(c);
    const claims = verifyCustomerToken(token);
    expect(claims.sub).toBe('cust_1');
    expect(claims.email).toBe('a@b.com');
    expect(claims.name).toBe('Aya');
  });

  it('rejects a tampered token', () => {
    const token = signCustomerToken(c);
    expect(() => verifyCustomerToken(token + 'x')).toThrow();
  });

  it('rejects garbage', () => {
    expect(() => verifyCustomerToken('not.a.jwt')).toThrow();
  });
});
