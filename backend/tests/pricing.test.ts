import { describe, it, expect } from 'vitest';
import { resolvePrice, resolveVariantPrice } from '../src/lib/pricing';

const now = new Date('2026-06-29T12:00:00Z');
const base = { basePrice: 420, currency: 'BDT' as const };

describe('resolvePrice', () => {
  it('returns base when no sale/flash', () => {
    const r = resolvePrice({ ...base }, now);
    expect(r).toMatchObject({ price: 420, compareAt: null, isOnSale: false, isOnFlash: false, currency: 'BDT' });
  });

  it('applies sale when salePrice < base', () => {
    const r = resolvePrice({ ...base, salePrice: 360 }, now);
    expect(r).toMatchObject({ price: 360, compareAt: 420, isOnSale: true, isOnFlash: false });
  });

  it('ignores sale when salePrice >= base', () => {
    const r = resolvePrice({ ...base, salePrice: 500 }, now);
    expect(r.price).toBe(420);
    expect(r.isOnSale).toBe(false);
  });

  it('applies flash within the window and below base', () => {
    const r = resolvePrice(
      { ...base, salePrice: 360, flashPrice: 300, flashStartAt: new Date('2026-06-29T00:00:00Z'), flashEndAt: new Date('2026-06-30T00:00:00Z') },
      now,
    );
    expect(r).toMatchObject({ price: 300, compareAt: 420, isOnFlash: true });
  });

  it('ignores flash outside the window (auto-reverts)', () => {
    const r = resolvePrice(
      { ...base, flashPrice: 300, flashStartAt: new Date('2026-06-01T00:00:00Z'), flashEndAt: new Date('2026-06-15T00:00:00Z') },
      now,
    );
    expect(r.price).toBe(420);
    expect(r.isOnFlash).toBe(false);
  });

  it('ignores flash when flashPrice >= base', () => {
    const r = resolvePrice(
      { ...base, flashPrice: 500, flashStartAt: new Date('2026-06-29T00:00:00Z'), flashEndAt: new Date('2026-06-30T00:00:00Z') },
      now,
    );
    expect(r.isOnFlash).toBe(false);
  });
});

describe('resolveVariantPrice', () => {
  it('uses variant price override over product base', () => {
    const r = resolveVariantPrice({ ...base }, { price: 500, salePrice: null }, now);
    expect(r.price).toBe(500);
  });

  it('inherits product price when variant price is null', () => {
    const r = resolveVariantPrice({ ...base, salePrice: 360 }, { price: null, salePrice: null }, now);
    expect(r.price).toBe(360);
  });

  it('applies variant sale override', () => {
    const r = resolveVariantPrice({ ...base }, { price: 500, salePrice: 450 }, now);
    expect(r).toMatchObject({ price: 450, compareAt: 500, isOnSale: true });
  });
});
