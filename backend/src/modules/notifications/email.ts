import nodemailer, { type Transporter } from 'nodemailer';
import type { OtpType } from '@prisma/client';
import { env } from '../../env';
import { renderOtpEmail } from './templates';

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

export async function sendOtpEmail(email: string, type: OtpType, code: string): Promise<void> {
  const { subject, html, text } = renderOtpEmail(type, code);
  try {
    await sendMail({ to: email, subject, html, text });
  } catch (e) {
    console.error('[email] OTP send failed', e);
  }
}
