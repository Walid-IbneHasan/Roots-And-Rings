import type { PaymentProvider } from '../provider';

/** Cash on Delivery — no gateway. Payment is settled when the order is delivered. */
export const codProvider: PaymentProvider = {
  kind: 'COD',
  async createSession() {
    return { status: 'INITIATED' };
  },
  async execute() {
    return { status: 'PAID' };
  },
  async query() {
    return { status: 'INITIATED' };
  },
  async refund() {
    return { status: 'REFUNDED' };
  },
};
