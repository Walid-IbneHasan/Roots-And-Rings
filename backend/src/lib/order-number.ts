import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // RFC 4648 base32 (no 0/1/8/9)

/** Human-readable order number: RR-YYYYMMDD-XXXX (4 random base32 chars). */
export function generateOrderNumber(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const bytes = randomBytes(4);
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += ALPHABET[bytes[i] % 32];
  return `RR-${y}${m}${d}-${suffix}`;
}
