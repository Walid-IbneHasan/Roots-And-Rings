const SYMBOLS: Record<string, string> = {
  BDT: '৳',
  EUR: '€',
  USD: '$',
  GBP: '£',
  INR: '₹',
};

/**
 * Format a price for display. Whole-unit amounts with a thousands separator and the
 * currency symbol (default BDT → ৳420, ৳1,850).
 */
export function formatPrice(amount: number, currency: string = 'BDT'): string {
  const symbol = SYMBOLS[currency] ?? '';
  const n = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(amount));
  return symbol ? `${symbol}${n}` : `${currency} ${n}`;
}

/** Whole-number percent off, e.g. discountPercent(300, 500) === 40. */
export function discountPercent(price: number, compareAt: number): number {
  if (compareAt <= 0 || price >= compareAt) return 0;
  return Math.round(((compareAt - price) / compareAt) * 100);
}
