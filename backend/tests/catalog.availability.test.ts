import { describe, it, expect } from 'vitest';
import { computeAvailability } from '../src/lib/mappers';

describe('computeAvailability', () => {
  it('in_stock when an active variant has stock', () => {
    expect(computeAvailability([{ isActive: true, stock: 3 }], false)).toBe('in_stock');
  });
  it('backorder when no stock but allowBackorder', () => {
    expect(computeAvailability([{ isActive: true, stock: 0 }], true)).toBe('backorder');
  });
  it('out_of_stock when no stock and no backorder', () => {
    expect(computeAvailability([{ isActive: true, stock: 0 }], false)).toBe('out_of_stock');
  });
  it('ignores inactive variants that have stock', () => {
    expect(computeAvailability([{ isActive: false, stock: 5 }], false)).toBe('out_of_stock');
  });
  it('out_of_stock for a product with no variants and no backorder', () => {
    expect(computeAvailability([], false)).toBe('out_of_stock');
  });
});
