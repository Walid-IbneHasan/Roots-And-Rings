import nodemailer, { type Transporter } from 'nodemailer';
import type { OtpType } from '@prisma/client';
import { env } from '../../env';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Real send only when not in tests AND SMTP is configured; otherwise log + capture. */
const live = env.NODE_ENV !== 'test' && !!env.SMTP_HOST;

let transport: Transporter | null = null;
function getTransport(): Transporter {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}

/** In log/test mode, sent messages are captured here for assertions. */
export const sentMessages: MailMessage[] = [];
export function resetSentMessages(): void {
  sentMessages.length = 0;
}

export async function sendMail(msg: MailMessage): Promise<void> {
  if (live) {
    await getTransport().sendMail({ from: env.EMAIL_FROM, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
    return;
  }
  console.log(`[email] → ${msg.to} | ${msg.subject}`);
  sentMessages.push(msg);
}

// --- OTP email (rewritten to use templates + sendMail in Task 3) ---
const PURPOSE: Record<OtpType, string> = {
  EMAIL_VERIFY: 'verify your email',
  PASSWORD_RESET: 'reset your password',
  PASSWORD_CHANGE: 'confirm your password change',
};
export function sendOtpEmail(email: string, type: OtpType, code: string): void {
  console.log(`[email] OTP for ${email} to ${PURPOSE[type]}: ${code} (no-op until SMTP configured)`);
}
