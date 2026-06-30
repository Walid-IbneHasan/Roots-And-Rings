export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface LineLike {
  unitPrice: number;
  quantity: number;
}

export function computeTotals(
  items: LineLike[],
  shipping = 0,
  discount = 0,
  tax = 0,
): { subtotal: number; shippingTotal: number; discountTotal: number; taxTotal: number; grandTotal: number } {
  const subtotal = round2(items.reduce((s, i) => s + round2(i.unitPrice * i.quantity), 0));
  const shippingTotal = round2(shipping);
  const discountTotal = round2(discount);
  const taxTotal = round2(tax);
  const grandTotal = round2(subtotal - discountTotal + shippingTotal + taxTotal);
  return { subtotal, shippingTotal, discountTotal, taxTotal, grandTotal };
}
