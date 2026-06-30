import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().default('http://localhost:4000'),
  STOREFRONT_ORIGIN: z.string().default('http://localhost:4321'),
  SESSION_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(8),
  CRON_TOKEN: z.string().min(8).default('dev-cron-token-change-me'),
  // bKash (optional — payments scaffold activates only when all are set)
  BKASH_BASE_URL: z.string().optional(),
  BKASH_APP_KEY: z.string().optional(),
  BKASH_APP_SECRET: z.string().optional(),
  BKASH_USERNAME: z.string().optional(),
  BKASH_PASSWORD: z.string().optional(),
  // Phase 3 — customer auth
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  OTP_TTL_MIN: z.coerce.number().int().positive().default(15),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  // Phase 6 — email + job worker
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.string().optional().transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('Roots & Rings <no-reply@rootsandrings.example>'),
  JOBS_WORKER_ENABLED: z.string().optional().transform((v) => v !== 'false'),
  JOBS_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(10000),
  JOBS_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  JOBS_STALE_LOCK_MS: z.coerce.number().int().positive().default(300000),
  // Phase 9 — Google OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
export type Env = z.infer<typeof schema>;
