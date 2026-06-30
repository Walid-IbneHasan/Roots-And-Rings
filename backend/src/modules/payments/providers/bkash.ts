import type { PaymentProvider } from '../provider';
import { env } from '../../../env';

/**
 * bKash hosted checkout (Create → Execute → Query → Refund). Fully scaffolded against the
 * bKash Tokenized Checkout REST API; activates only when all BKASH_* env vars are set,
 * otherwise every method returns CREDENTIALS_MISSING and performs no network calls.
 */
function credsPresent(): boolean {
  return Boolean(
    env.BKASH_BASE_URL && env.BKASH_APP_KEY && env.BKASH_APP_SECRET && env.BKASH_USERNAME && env.BKASH_PASSWORD,
  );
}

async function grantToken(): Promise<string> {
  const res = await fetch(`${env.BKASH_BASE_URL}/tokenized/checkout/token/grant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      username: env.BKASH_USERNAME!,
      password: env.BKASH_PASSWORD!,
    },
    body: JSON.stringify({ app_key: env.BKASH_APP_KEY, app_secret: env.BKASH_APP_SECRET }),
  });
  const json = (await res.json()) as { id_token: string };
  return json.id_token;
}

async function authedHeaders(token: string) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: token,
    'X-APP-Key': env.BKASH_APP_KEY!,
  };
}

export const bkashProvider: PaymentProvider = {
  kind: 'BKASH',

  async createSession(order, payment) {
    if (!credsPresent()) {
      console.warn('[bkash] credentials missing — payment scaffold inactive (set BKASH_* env to enable)');
      return { status: 'CREDENTIALS_MISSING' };
    }
    const token = await grantToken();
    const res = await fetch(`${env.BKASH_BASE_URL}/tokenized/checkout/create`, {
      method: 'POST',
      headers: await authedHeaders(token),
      body: JSON.stringify({
        mode: '0011',
        payerReference: order.guestPhone ?? order.guestEmail,
        callbackURL: `${env.APP_URL}/api/payments/bkash/callback`,
        amount: Number(payment.amount).toFixed(2),
        currency: 'BDT',
        intent: 'sale',
        merchantInvoiceNumber: payment.tranId,
      }),
    });
    const json = (await res.json()) as { bkashURL?: string; paymentID?: string };
    return { status: 'PENDING', gatewayPageURL: json.bkashURL };
  },

  async execute(_payment, ref) {
    if (!credsPresent()) return { status: 'CREDENTIALS_MISSING' };
    const token = await grantToken();
    const res = await fetch(`${env.BKASH_BASE_URL}/tokenized/checkout/execute`, {
      method: 'POST',
      headers: await authedHeaders(token),
      body: JSON.stringify({ paymentID: ref }),
    });
    const json = (await res.json()) as { transactionStatus?: string; trxID?: string };
    return { status: json.transactionStatus === 'Completed' ? 'PAID' : 'FAILED', trxId: json.trxID };
  },

  async query(payment) {
    if (!credsPresent()) return { status: 'CREDENTIALS_MISSING' };
    const token = await grantToken();
    const res = await fetch(`${env.BKASH_BASE_URL}/tokenized/checkout/payment/status`, {
      method: 'POST',
      headers: await authedHeaders(token),
      body: JSON.stringify({ paymentID: payment.bkashPaymentID }),
    });
    const json = (await res.json()) as { transactionStatus?: string };
    return { status: json.transactionStatus ?? 'UNKNOWN' };
  },

  async refund(payment, amount) {
    if (!credsPresent()) return { status: 'CREDENTIALS_MISSING' };
    const token = await grantToken();
    await fetch(`${env.BKASH_BASE_URL}/tokenized/checkout/payment/refund`, {
      method: 'POST',
      headers: await authedHeaders(token),
      body: JSON.stringify({ paymentID: payment.bkashPaymentID, amount: amount.toFixed(2), trxID: payment.bkashTrxID }),
    });
    return { status: amount >= Number(payment.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED' };
  },
};
