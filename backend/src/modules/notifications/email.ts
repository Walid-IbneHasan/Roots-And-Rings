import type { OtpType } from '@prisma/client';

const PURPOSE: Record<OtpType, string> = {
  EMAIL_VERIFY: 'verify your email',
  PASSWORD_RESET: 'reset your password',
  PASSWORD_CHANGE: 'confirm your password change',
};

/** No-op "email" (logs) until SMTP is configured (Phase 4). */
export function sendOtpEmail(email: string, type: OtpType, code: string): void {
  console.log(`[email] OTP for ${email} to ${PURPOSE[type]}: ${code} (no-op until SMTP configured)`);
}
