import type { OtpType } from '@prisma/client';

function layout(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#fef9f1;font-family:Georgia,'Times New Roman',serif;color:#1d1c17">
  <div style="max-width:560px;margin:0 auto;padding:32px">
    <div style="font-size:22px;letter-spacing:.04em;padding-bottom:16px;border-bottom:1px solid rgba(140,131,120,.3)">ROOTS &amp; RINGS</div>
    <h1 style="font-weight:400;font-size:24px;margin:24px 0 12px">${title}</h1>
    ${body}
    <p style="color:#8c8378;font-size:12px;margin-top:32px;border-top:1px solid rgba(140,131,120,.3);padding-top:16px">Roots &amp; Rings · Handcrafted ceramics, Dhaka</p>
  </div></body></html>`;
}

const OTP_META: Record<OtpType, { subject: string; line: string }> = {
  EMAIL_VERIFY: { subject: 'Verify your email', line: 'Use this code to verify your email address.' },
  PASSWORD_RESET: { subject: 'Reset your password', line: 'Use this code to reset your password.' },
  PASSWORD_CHANGE: { subject: 'Confirm your password change', line: 'Use this code to confirm your password change.' },
};

export function renderOtpEmail(type: OtpType, code: string): { subject: string; html: string; text: string } {
  const m = OTP_META[type];
  const html = layout(
    m.subject,
    `<p style="font-size:15px">${m.line}</p>
     <p style="font-size:32px;letter-spacing:.3em;font-family:monospace;margin:24px 0">${code}</p>
     <p style="color:#8c8378;font-size:13px">This code expires shortly. If you didn't request it, you can ignore this email.</p>`,
  );
  const text = `${m.line}\n\nCode: ${code}\n\nThis code expires shortly. If you didn't request it, ignore this email.`;
  return { subject: m.subject, html, text };
}

export interface OrderEmailItem {
  productName: string;
  variantName: string | null;
  quantity: number;
  lineTotal: unknown;
}
export interface OrderEmail {
  orderNumber: string;
  guestEmail: string;
  grandTotal: unknown;
  items: OrderEmailItem[];
  cod: boolean;
}

export function renderOrderConfirmation(order: OrderEmail): { subject: string; html: string; text: string } {
  const subject = `Order ${order.orderNumber} confirmed`;
  const rows = order.items
    .map(
      (i) =>
        `<tr><td style="padding:6px 0">${i.productName}${i.variantName ? ' · ' + i.variantName : ''} × ${i.quantity}</td><td style="padding:6px 0;text-align:right">৳${Number(i.lineTotal)}</td></tr>`,
    )
    .join('');
  const codNote = order.cod
    ? `<p style="font-size:14px">Please have <strong>৳${Number(order.grandTotal)}</strong> ready — payment is due on delivery.</p>`
    : '';
  const html = layout(
    'Thank you for your order',
    `<p style="font-size:15px">Your order <strong>${order.orderNumber}</strong> is confirmed.</p>
     <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">${rows}
       <tr><td style="padding-top:12px;border-top:1px solid rgba(140,131,120,.3)"><strong>Total</strong></td>
       <td style="padding-top:12px;border-top:1px solid rgba(140,131,120,.3);text-align:right"><strong>৳${Number(order.grandTotal)}</strong></td></tr>
     </table>${codNote}`,
  );
  const text =
    `Your order ${order.orderNumber} is confirmed.\n\n` +
    order.items.map((i) => `${i.productName} ×${i.quantity} — ৳${Number(i.lineTotal)}`).join('\n') +
    `\n\nTotal: ৳${Number(order.grandTotal)}` +
    (order.cod ? `\n\nPlease have ৳${Number(order.grandTotal)} ready — payment is due on delivery.` : '');
  return { subject, html, text };
}
