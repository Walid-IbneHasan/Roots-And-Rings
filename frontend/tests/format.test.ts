import { describe, it, expect } from 'vitest';
import { formatPrice, discountPercent } from '../src/lib/format';

describe('formatPrice', () => {
  it('formats a whole BDT amount with the ৳ symbol and no decimals', () => {
    expect(formatPrice(420)).toBe('৳420');
  });

  it('uses a thousands separator', () => {
    expect(formatPrice(1850)).toBe('৳1,850');
  });

  it('rounds to whole units', () => {
    expect(formatPrice(199.99)).toBe('৳200');
  });

  it('honors an explicit currency', () => {
    expect(formatPrice(420, 'EUR')).toBe('€420');
  });
});

describe('discountPercent', () => {
  it('computes the rounded percent off', () => {
    expect(discountPercent(300, 500)).toBe(40);
    expect(discountPercent(600, 1000)).toBe(40);
    expect(discountPercent(950, 1000)).toBe(5);
  });
});
