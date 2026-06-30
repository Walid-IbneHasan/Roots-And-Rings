import type { Order, Payment, PaymentProviderKind } from '@prisma/client';

export type SessionStatus = 'INITIATED' | 'PENDING' | 'CREDENTIALS_MISSING';

export interface CreateSessionResult {
  status: SessionStatus;
  gatewayPageURL?: string;
}

export interface PaymentProvider {
  kind: PaymentProviderKind;
  createSession(order: Order, payment: Payment): Promise<CreateSessionResult>;
  execute(payment: Payment, ref: string): Promise<{ status: 'PAID' | 'FAILED' | 'CREDENTIALS_MISSING'; trxId?: string }>;
  query(payment: Payment): Promise<{ status: string }>;
  refund(payment: Payment, amount: number): Promise<{ status: 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'CREDENTIALS_MISSING' }>;
}
