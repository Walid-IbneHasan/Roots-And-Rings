import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Prisma, PrismaClient, OtpType } from '@prisma/client';
import { env } from '../../env';
import { httpError } from '../../lib/errors';

type Db = PrismaClient | Prisma.TransactionClient;

export async function issueOtp(db: Db, customerId: string, type: OtpType): Promise<string> {
  // Invalidate any prior unconsumed codes of this type.
  await db.customerOtp.updateMany({
    where: { customerId, type, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + env.OTP_TTL_MIN * 60_000);
  await db.customerOtp.create({ data: { customerId, type, codeHash, expiresAt } });
  return code;
}

export async function verifyOtp(db: Db, customerId: string, type: OtpType, code: string): Promise<void> {
  const otp = await db.customerOtp.findFirst({
    where: { customerId, type, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp) throw httpError(400, 'Code is invalid or has expired');
  if (otp.attempts >= env.OTP_MAX_ATTEMPTS) throw httpError(400, 'Too many attempts; request a new code');
  const ok = await bcrypt.compare(code, otp.codeHash);
  if (!ok) {
    await db.customerOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw httpError(400, 'Code is invalid or has expired');
  }
  await db.customerOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
}
