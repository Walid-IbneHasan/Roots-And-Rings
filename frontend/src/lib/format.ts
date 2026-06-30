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
