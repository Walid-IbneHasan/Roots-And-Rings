import { describe, it, expect } from 'vitest';
import { renderOtpEmail, renderOrderConfirmation } from '../src/modules/notifications/templates';

describe('renderOtpEmail', () => {
  it('puts the code + a subject per type into html and text', () => {
    const r = renderOtpEmail('EMAIL_VERIFY', '123456');
    expect(r.subject).toBe('Verify your email');
    expect(r.html).toContain('123456');
    expect(r.text).toContain('123456');
    expect(renderOtpEmail('PASSWORD_RESET', '000111').subject).toBe('Reset your password');
  });
});

describe('renderOrderConfirmation', () => {
  it('renders the order number, items, and total', () => {
    const r = renderOrderConfirmation({
      orderNumber: 'RR-X', guestEmail: 'a@b.com', grandTotal: 800,
      items: [{ productName: 'Kura Vessel', variantName: 'Standard', quantity: 1, lineTotal: 800 }], cod: true,
    });
    expect(r.subject).toBe('Order RR-X confirmed');
    expect(r.html).toContain('RR-X');
    expect(r.html).toContain('Kura Vessel');
    expect(r.html).toContain('800');
    expect(r.text).toContain('RR-X');
    expect(r.html).toContain('delivery'); // COD note
  });
});
