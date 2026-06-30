# Roots & Rings Phase 6 — Email delivery + job worker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the logged-no-op emails (order confirmation + OTPs) into real SMTP delivery via nodemailer, with OTPs sent synchronously and order confirmations delivered by an in-process worker that drains the `Job` queue with retries.

**Architecture:** A new `EmailService` (`sendMail`) with a no-credentials/test log-capture fallback; pure HTML+text template functions; a `processJobs` queue drainer using `SELECT … FOR UPDATE SKIP LOCKED`; an in-process `setInterval` worker started in `server.ts`. OTPs send in-request; checkout just enqueues.

**Tech Stack:** Fastify 5, Prisma + MySQL 8, zod, **nodemailer**, Vitest + Fastify `.inject()`.

## Global Constraints

- **Git:** work on branch `phase-6-email` (already created). Each task ends with a real commit (Conventional Commit; end the body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).
- **Ampersand-path gotcha:** project is in `D:\Roots & Rings`; `&` breaks npm scripts. Call node entrypoints directly. Never `npm run`. (npm install itself is fine from a no-`&` cwd; the project path has `&` so prefer `node node_modules/...` for scripts.)
- **Backend tests need the DB:** `docker compose up -d db` (repo root) must be healthy.
- **TDD, DRY, YAGNI.** Failing test → watch fail → implement → watch pass.
- **Tests NEVER send real email.** The EmailService is in log/capture mode whenever `NODE_ENV === 'test'` (regardless of `SMTP_*` being set). Real Gmail creds are already in `backend/.env` — the test gate MUST be `NODE_ENV`-based so the suite can't hit Gmail.
- **OTP send failures are swallowed** (logged, never thrown) so account flows never break on email.
- **Decimals/money** rendered via `Number(...)`, currency ৳ (BDT).
- Backend single-file test: `cd backend; node node_modules/vitest/vitest.mjs run tests/<file>`. Full: `cd backend; node node_modules/vitest/vitest.mjs run`.
- A known occasionally-flaky `uploads` timeout test is unrelated; if only that times out, re-run once.

---

### Task 1: nodemailer + env vars + EmailService.sendMail

**Files:**
- Modify: `backend/src/env.ts` (SMTP + worker vars)
- Modify: `backend/src/modules/notifications/email.ts` (add `sendMail` + capture; keep existing `sendOtpEmail` for now)
- Test: `backend/tests/email.test.ts`
- Add dep: `nodemailer` + `@types/nodemailer`

**Interfaces:**
- Produces: `interface MailMessage { to: string; subject: string; html: string; text: string }`; `sendMail(msg): Promise<void>`; `sentMessages: MailMessage[]`; `resetSentMessages(): void`. Env: `SMTP_HOST?`, `SMTP_PORT`(587), `SMTP_SECURE`(bool), `SMTP_USER?`, `SMTP_PASS?`, `EMAIL_FROM`, `JOBS_WORKER_ENABLED`(bool), `JOBS_POLL_INTERVAL_MS`(10000), `JOBS_BATCH_SIZE`(10).

- [ ] **Step 1: Install nodemailer**

```
cd "D:/Roots & Rings/backend"
node node_modules/npm/bin/npm-cli.js install nodemailer 2>/dev/null || npm install nodemailer
node node_modules/npm/bin/npm-cli.js install -D @types/nodemailer 2>/dev/null || npm install -D @types/nodemailer
```
(If the vendored npm path doesn't exist, the `|| npm install ...` fallback runs the system npm from the `backend` dir.)

- [ ] **Step 2: Add env vars to `backend/src/env.ts`**

Inside the `z.object({ ... })`, after the Phase 3 JWT/OTP block, add:

```ts
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
```

- [ ] **Step 3: Write the failing test**

`backend/tests/email.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { sendMail, sentMessages, resetSentMessages } from '../src/modules/notifications/email';

beforeEach(() => resetSentMessages());

describe('sendMail (test/log capture mode)', () => {
  it('captures the message and never throws without real SMTP', async () => {
    await sendMail({ to: 'a@b.com', subject: 'Hello', html: '<p>hi</p>', text: 'hi' });
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].to).toBe('a@b.com');
    expect(sentMessages[0].subject).toBe('Hello');
  });
  it('reset clears the capture', async () => {
    await sendMail({ to: 'x@y.com', subject: 'A', html: '<p>a</p>', text: 'a' });
    resetSentMessages();
    expect(sentMessages.length).toBe(0);
  });
});
```

- [ ] **Step 4: Run it — verify it fails**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/email.test.ts
```
Expected: FAIL (`sendMail`/`sentMessages` not exported).

- [ ] **Step 5: Rewrite `backend/src/modules/notifications/email.ts`**

```ts
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
```

- [ ] **Step 6: Run it — verify it passes**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/email.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 7: Checkpoint + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/src/env.ts backend/src/modules/notifications/email.ts backend/tests/email.test.ts backend/package.json backend/package-lock.json
git commit -m "feat(email): EmailService sendMail + env + nodemailer (TDD)"
```
Expected: full suite green (the kept sync `sendOtpEmail` keeps auth routes compiling).

---

### Task 2: Email templates

**Files:**
- Create: `backend/src/modules/notifications/templates.ts`
- Test: `backend/tests/templates.test.ts`

**Interfaces:**
- Produces: `renderOtpEmail(type: OtpType, code: string): { subject; html; text }`; `interface OrderEmailItem { productName; variantName: string|null; quantity: number; lineTotal: unknown }`; `interface OrderEmail { orderNumber; guestEmail; grandTotal: unknown; items: OrderEmailItem[]; cod: boolean }`; `renderOrderConfirmation(order: OrderEmail): { subject; html; text }`.

- [ ] **Step 1: Write the failing test**

`backend/tests/templates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderOtpEmail, renderOrderConfirmation } from '../src/modules/notifications/templates';

describe('renderOtpEmail', () => {
  it('puts the code + a subject per type into html and text', () => {
    const r = renderOtpEmail('EMAIL_VERIFY', '123456');
    expect(r.subject).toBe('Verify your email');
    expect(r.html).toContain('123456');
    expect(r.text).toContain('123456');
    expect(renderOtpEmail('PASSWORD_RESET', '000111').subject).toBe('Reset your password');
  });
});

describe('renderOrderConfirmation', () => {
  it('renders the order number, items, and total', () => {
    const r = renderOrderConfirmation({
      orderNumber: 'RR-X', guestEmail: 'a@b.com', grandTotal: 800,
      items: [{ productName: 'Kura Vessel', variantName: 'Standard', quantity: 1, lineTotal: 800 }], cod: true,
    });
    expect(r.subject).toBe('Order RR-X confirmed');
    expect(r.html).toContain('RR-X');
    expect(r.html).toContain('Kura Vessel');
    expect(r.html).toContain('800');
    expect(r.text).toContain('RR-X');
    expect(r.html).toContain('delivery'); // COD note
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/templates.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `backend/src/modules/notifications/templates.ts`**

```ts
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
     <p style="color:#8c8378;font-size:13px">This code expires shortly. If you didn’t request it, you can ignore this email.</p>`,
  );
  const text = `${m.line}\n\nCode: ${code}\n\nThis code expires shortly. If you didn’t request it, ignore this email.`;
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
```

- [ ] **Step 4: Run it — verify it passes**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/templates.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```
git add backend/src/modules/notifications/templates.ts backend/tests/templates.test.ts
git commit -m "feat(email): OTP + order-confirmation templates (TDD)"
```

---

### Task 3: Synchronous OTP send

**Files:**
- Modify: `backend/src/modules/notifications/email.ts` (rewrite `sendOtpEmail` → async, uses template + sendMail)
- Modify: `backend/src/modules/auth/routes.ts` (await the two `sendOtpEmail` calls)
- Modify: `backend/src/modules/account/routes.ts` (await the one `sendOtpEmail` call)
- Test: `backend/tests/otp.email.test.ts`

**Interfaces:**
- Consumes: `sendMail`, `sentMessages` (Task 1), `renderOtpEmail` (Task 2).
- Produces: `sendOtpEmail(email: string, type: OtpType, code: string): Promise<void>` (sends synchronously; swallows send errors).

- [ ] **Step 1: Write the failing test**

`backend/tests/otp.email.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { sentMessages, resetSentMessages } from '../src/modules/notifications/email';

let app: FastifyInstance;
const EMAIL = 'otpmail-zz@test.com';

beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.prisma.customer.deleteMany({ where: { email: EMAIL } }); await app.close(); });
beforeEach(() => resetSentMessages());

describe('OTP email send', () => {
  it('register captures a verify-email message', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Otp Mail', email: EMAIL, password: 'Supersecret1' } });
    expect(res.statusCode).toBe(201);
    expect(sentMessages.some((m) => m.to === EMAIL && m.subject === 'Verify your email')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/otp.email.test.ts
```
Expected: FAIL (the current `sendOtpEmail` only console.logs — no captured message).

- [ ] **Step 3: Rewrite `sendOtpEmail` in `backend/src/modules/notifications/email.ts`**

Replace the `PURPOSE` const + the existing `sendOtpEmail` function (the last block of the file) with:

```ts
import { renderOtpEmail } from './templates';

export async function sendOtpEmail(email: string, type: OtpType, code: string): Promise<void> {
  const { subject, html, text } = renderOtpEmail(type, code);
  try {
    await sendMail({ to: email, subject, html, text });
  } catch (e) {
    console.error('[email] OTP send failed', e);
  }
}
```
(Move the `import { renderOtpEmail } from './templates';` to the top with the other imports. Remove the now-unused `PURPOSE` map and the `OtpType` import only if it's no longer referenced — `OtpType` is still used in `sendOtpEmail`'s signature, so keep that import.)

- [ ] **Step 4: Await the call sites**

In `backend/src/modules/auth/routes.ts`, change both calls (register's EMAIL_VERIFY, forgot-password's PASSWORD_RESET):
```ts
    await sendOtpEmail(customer.email, 'EMAIL_VERIFY', code);
```
```ts
      await sendOtpEmail(customer.email, 'PASSWORD_RESET', code);
```
In `backend/src/modules/account/routes.ts`, change the PASSWORD_CHANGE call:
```ts
    await sendOtpEmail(request.customer!.email, 'PASSWORD_CHANGE', code);
```
(These handlers are already `async`, so `await` is valid.)

- [ ] **Step 5: Run the new test + the auth regression**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/otp.email.test.ts tests/auth.api.test.ts tests/account.profile.test.ts
```
Expected: PASS (the OTP email is captured; auth/account flows unchanged).

- [ ] **Step 6: Checkpoint + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/notifications/email.ts backend/src/modules/auth/routes.ts backend/src/modules/account/routes.ts backend/tests/otp.email.test.ts
git commit -m "feat(email): synchronous OTP send via EmailService"
```

---

### Task 4: Job processor + order-confirmation delivery

**Files:**
- Modify: `backend/src/modules/notifications/jobs.ts` (handle → render+send; add `processJobs`; remove `runJobInline`)
- Modify: `backend/src/modules/checkout/service.ts` (enqueue only — drop the inline drain)
- Test: `backend/tests/jobs.test.ts`

**Interfaces:**
- Consumes: `sendMail` (Task 1), `renderOrderConfirmation` (Task 2).
- Produces: `enqueueJob(prisma, type, payload)` (unchanged); `type HandlerFn = (prisma, type, payload) => Promise<void>`; `processJobs(prisma: PrismaClient, batchSize: number, handler?: HandlerFn): Promise<{ processed: number; failed: number }>` (claims due PENDING jobs with `FOR UPDATE SKIP LOCKED`, runs the handler, DONE / retry-backoff / FAILED). `runJobInline` is removed.

- [ ] **Step 1: Write the failing test**

`backend/tests/jobs.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { enqueueJob, processJobs } from '../src/modules/notifications/jobs';
import { sentMessages, resetSentMessages } from '../src/modules/notifications/email';

const prisma = new PrismaClient();
let orderId = '';

beforeAll(async () => {
  const order = await prisma.order.create({
    data: {
      orderNumber: 'RR-JOB-ZZ', guestEmail: 'jobs-zz@test.com', guestPhone: '0', status: 'PROCESSING', currency: 'BDT',
      subtotal: 800, shippingTotal: 0, discountTotal: 0, taxTotal: 0, grandTotal: 800,
      idempotencyKey: 'job-idem-zz', orderToken: 'job-tok-zz', shippingSnapshot: { line1: 'x', city: 'Dhaka', district: 'Dhaka' },
      items: { create: [{ productId: 'p', variantId: 'v', productName: 'Kura Vessel', variantName: 'Standard', sku: 'S', unitPrice: 800, quantity: 1, lineTotal: 800 }] },
      payments: { create: [{ provider: 'COD', amount: 800, currency: 'BDT', tranId: 'job-tran-zz', status: 'INITIATED' }] },
    },
  });
  orderId = order.id;
});
afterAll(async () => {
  await prisma.job.deleteMany({ where: { type: { in: ['email.order_confirmation', 'test.boom'] } } });
  await prisma.order.deleteMany({ where: { idempotencyKey: 'job-idem-zz' } });
  await prisma.$disconnect();
});
beforeEach(() => resetSentMessages());

describe('processJobs', () => {
  it('delivers an order-confirmation job and marks it DONE', async () => {
    const job = await enqueueJob(prisma, 'email.order_confirmation', { orderId });
    const res = await processJobs(prisma, 10);
    expect(res.processed).toBe(1);
    const done = await prisma.job.findUnique({ where: { id: job.id } });
    expect(done!.status).toBe('DONE');
    expect(sentMessages.some((m) => m.to === 'jobs-zz@test.com' && m.subject === 'Order RR-JOB-ZZ confirmed')).toBe(true);
  });

  it('retries a failing job (PENDING + future runAt), then FAILS at maxAttempts', async () => {
    const boom = async () => { throw new Error('boom'); };
    const job = await enqueueJob(prisma, 'test.boom', {});
    await processJobs(prisma, 10, boom);
    let j = await prisma.job.findUnique({ where: { id: job.id } });
    expect(j!.status).toBe('PENDING');
    expect(j!.attempts).toBe(1);
    expect(j!.lastError).toContain('boom');
    expect(j!.runAt.getTime()).toBeGreaterThan(Date.now());

    // jump to the last attempt
    await prisma.job.update({ where: { id: job.id }, data: { attempts: 4, runAt: new Date(Date.now() - 1000) } });
    await processJobs(prisma, 10, boom);
    j = await prisma.job.findUnique({ where: { id: job.id } });
    expect(j!.status).toBe('FAILED');
    expect(j!.attempts).toBe(5);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/jobs.test.ts
```
Expected: FAIL (`processJobs` not exported).

- [ ] **Step 3: Rewrite `backend/src/modules/notifications/jobs.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import { sendMail } from './email';
import { renderOrderConfirmation } from './templates';

export async function enqueueJob(prisma: PrismaClient, type: string, payload: object) {
  return prisma.job.create({ data: { type, payload } });
}

export type HandlerFn = (prisma: PrismaClient, type: string, payload: Record<string, unknown>) => Promise<void>;

async function defaultHandle(prisma: PrismaClient, type: string, payload: Record<string, unknown>): Promise<void> {
  if (type === 'email.order_confirmation') {
    const order = await prisma.order.findUnique({ where: { id: String(payload.orderId) }, include: { items: true, payments: true } });
    if (!order) return;
    const { subject, html, text } = renderOrderConfirmation({
      orderNumber: order.orderNumber,
      guestEmail: order.guestEmail,
      grandTotal: order.grandTotal,
      items: order.items.map((i) => ({ productName: i.productName, variantName: i.variantName, quantity: i.quantity, lineTotal: i.lineTotal })),
      cod: order.payments[0]?.provider === 'COD',
    });
    await sendMail({ to: order.guestEmail, subject, html, text });
  }
  // unknown types: no-op
}

/**
 * Drain up to `batchSize` due PENDING jobs. Claims with SELECT … FOR UPDATE SKIP LOCKED so
 * concurrent workers never grab the same job (no double-send). On failure, retries with backoff
 * (runAt += attempts·60s) until maxAttempts, then marks FAILED.
 */
export async function processJobs(
  prisma: PrismaClient,
  batchSize: number,
  handler: HandlerFn = defaultHandle,
): Promise<{ processed: number; failed: number }> {
  const limit = Math.max(1, Math.floor(batchSize));
  const now = new Date();
  const claimedIds = await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM Job WHERE status = 'PENDING' AND runAt <= ? ORDER BY runAt ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED`,
        now,
      );
      const ids = rows.map((r) => r.id);
      if (ids.length) await tx.job.updateMany({ where: { id: { in: ids } }, data: { status: 'PROCESSING', lockedAt: now } });
      return ids;
    },
    { isolationLevel: 'ReadCommitted' },
  );

  let processed = 0;
  let failed = 0;
  for (const id of claimedIds) {
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) continue;
    try {
      await handler(prisma, job.type, job.payload as Record<string, unknown>);
      await prisma.job.update({ where: { id }, data: { status: 'DONE', attempts: { increment: 1 }, lockedAt: null } });
      processed++;
    } catch (e) {
      const attempts = job.attempts + 1;
      const willRetry = attempts < job.maxAttempts;
      await prisma.job.update({
        where: { id },
        data: {
          status: willRetry ? 'PENDING' : 'FAILED',
          attempts,
          lastError: String(e),
          lockedAt: null,
          ...(willRetry ? { runAt: new Date(Date.now() + attempts * 60_000) } : {}),
        },
      });
      failed++;
    }
  }
  return { processed, failed };
}
```

- [ ] **Step 4: Make checkout enqueue-only in `backend/src/modules/checkout/service.ts`**

Change the import (line ~9) from:
```ts
import { enqueueJob, runJobInline } from '../notifications/jobs';
```
to:
```ts
import { enqueueJob } from '../notifications/jobs';
```
And replace the two lines in the COD branch:
```ts
    const job = await enqueueJob(prisma, 'email.order_confirmation', { orderId: result.order.id });
    await runJobInline(prisma, job.id);
```
with:
```ts
    await enqueueJob(prisma, 'email.order_confirmation', { orderId: result.order.id });
```

- [ ] **Step 5: Run the new test + the checkout regression**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/jobs.test.ts tests/checkout.api.test.ts tests/checkout.coupon.test.ts
```
Expected: PASS (jobs DONE/retry/FAILED; checkout still creates orders — it now just enqueues).

- [ ] **Step 6: Checkpoint + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/notifications/jobs.ts backend/src/modules/checkout/service.ts backend/tests/jobs.test.ts
git commit -m "feat(email): job processor + order-confirmation delivery; checkout enqueues only"
```

---

### Task 5: Worker concurrency proof (no double-send)

**Files:**
- Test: `backend/tests/jobs.concurrency.test.ts`

**Interfaces:**
- Consumes: `enqueueJob`, `processJobs` (Task 4), `sentMessages` (Task 1).

- [ ] **Step 1: Write the failing-then-passing concurrency test**

`backend/tests/jobs.concurrency.test.ts` (this exercises the `SKIP LOCKED` claim added in Task 4; it should pass once Task 4 is in):

```ts
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { enqueueJob, processJobs } from '../src/modules/notifications/jobs';
import { sentMessages, resetSentMessages } from '../src/modules/notifications/email';

const prisma = new PrismaClient();
let orderId = '';

beforeAll(async () => {
  const order = await prisma.order.create({
    data: {
      orderNumber: 'RR-JOBC-ZZ', guestEmail: 'jobc-zz@test.com', guestPhone: '0', status: 'PROCESSING', currency: 'BDT',
      subtotal: 100, shippingTotal: 0, discountTotal: 0, taxTotal: 0, grandTotal: 100,
      idempotencyKey: 'jobc-idem-zz', orderToken: 'jobc-tok-zz', shippingSnapshot: { line1: 'x', city: 'Dhaka', district: 'Dhaka' },
      items: { create: [{ productId: 'p', variantId: 'v', productName: 'P', variantName: 'Standard', sku: 'S', unitPrice: 100, quantity: 1, lineTotal: 100 }] },
      payments: { create: [{ provider: 'COD', amount: 100, currency: 'BDT', tranId: 'jobc-tran-zz', status: 'INITIATED' }] },
    },
  });
  orderId = order.id;
});
afterAll(async () => {
  await prisma.job.deleteMany({ where: { type: 'email.order_confirmation', payload: { path: '$.orderId', equals: orderId } } });
  await prisma.order.deleteMany({ where: { idempotencyKey: 'jobc-idem-zz' } });
  await prisma.$disconnect();
});
beforeEach(() => resetSentMessages());

describe('processJobs concurrency (SKIP LOCKED)', () => {
  it('processes 8 jobs exactly once across two concurrent workers (no double-send)', async () => {
    for (let i = 0; i < 8; i++) await enqueueJob(prisma, 'email.order_confirmation', { orderId });
    // two workers, each batch 5 → claims are disjoint (the second skips the first's locked rows)
    const [a, b] = await Promise.all([processJobs(prisma, 5), processJobs(prisma, 5)]);
    expect(a.processed + b.processed).toBe(8);
    expect(sentMessages.length).toBe(8); // each job sent once, not twice
  });
});
```

- [ ] **Step 2: Run it — verify it passes**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/jobs.concurrency.test.ts
```
Expected: PASS (exactly 8 sends — no job double-processed). If it reports more than 8, `SKIP LOCKED` is not taking effect; STOP and report.

- [ ] **Step 3: Commit**

```
git add backend/tests/jobs.concurrency.test.ts
git commit -m "test(email): processJobs concurrency — no double-send"
```

---

### Task 6: In-process worker + server wiring

**Files:**
- Create: `backend/src/modules/notifications/worker.ts`
- Modify: `backend/src/server.ts` (start the worker when enabled)
- Test: none automated (timer-based; `processJobs` is already proven). Verified by the live check in Task 7.

**Interfaces:**
- Consumes: `processJobs` (Task 4), `env` (Task 1 vars).
- Produces: `startJobWorker(prisma, { intervalMs, batchSize })`; `stopJobWorker()`.

- [ ] **Step 1: Implement `backend/src/modules/notifications/worker.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import { processJobs } from './jobs';

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the in-process job worker (idempotent). Polls every intervalMs and drains a batch. */
export function startJobWorker(prisma: PrismaClient, opts: { intervalMs: number; batchSize: number }): void {
  if (timer) return;
  timer = setInterval(() => {
    processJobs(prisma, opts.batchSize).catch((e) => console.error('[jobs] worker tick failed', e));
  }, opts.intervalMs);
  // Don't keep the process alive just for the worker.
  timer.unref();
}

export function stopJobWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
```

- [ ] **Step 2: Start the worker in `backend/src/server.ts`**

Add the import and start it after `app.listen` succeeds. The file becomes:

```ts
import { buildApp } from './app';
import { env } from './env';
import { startJobWorker } from './modules/notifications/worker';

const app = await buildApp();

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`Roots & Rings API listening on ${env.APP_URL} (docs at /docs)`);
  if (env.JOBS_WORKER_ENABLED) {
    startJobWorker(app.prisma, { intervalMs: env.JOBS_POLL_INTERVAL_MS, batchSize: env.JOBS_BATCH_SIZE });
    app.log.info(`Job worker started (every ${env.JOBS_POLL_INTERVAL_MS}ms, batch ${env.JOBS_BATCH_SIZE})`);
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
```

- [ ] **Step 3: Checkpoint (typecheck via the suite) + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/notifications/worker.ts backend/src/server.ts
git commit -m "feat(email): in-process job worker started by the server"
```
Expected: full suite green (the worker isn't started by `buildApp`, so tests don't spawn it).

---

### Task 7: Full sweep + README + live send + memory

**Files:**
- Modify: `backend/README.md`
- Test: full backend suite; a real Gmail send check

- [ ] **Step 1: Full backend suite**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
```
Expected: green (138 prior + email 2 + templates 2 + otp.email 1 + jobs 2 + jobs.concurrency 1 = ~146). Frontend suite is unaffected this phase (still 43).

- [ ] **Step 2: Live send check** (real SMTP creds are in `backend/.env`)

Start the server (worker enabled): `cd "D:/Roots & Rings/backend"; node --env-file=.env --import tsx src/server.ts`. Then:
1. Register a new account at the storefront (or `POST /api/auth/register`) using a **real inbox you control** → the "Verify your email" message should arrive (synchronous).
2. Place a COD order → within `JOBS_POLL_INTERVAL_MS` the "Order … confirmed" message should arrive (worker-delivered); the server log shows the worker tick.
3. If a send errors, check `SMTP_*` in `.env` (Gmail needs port 465 + `SMTP_SECURE=true` + an app password). On success, the controller confirms with the user that the emails arrived.

- [ ] **Step 3: Add a Phase 6 section to `backend/README.md`**

Add the new env vars to the env table (`SMTP_*`, `EMAIL_FROM`, `JOBS_WORKER_ENABLED`, `JOBS_POLL_INTERVAL_MS`, `JOBS_BATCH_SIZE`), and insert (before "## Phase 1 — implemented vs. deferred"):

```markdown
## Phase 6 — implemented vs. deferred

**Implemented (this phase)**
- Real email via nodemailer (`EmailService.sendMail`); no-credentials/test runs log + capture
  (`sentMessages`) instead of sending, gated on `NODE_ENV` so the suite never hits the live mailbox.
- HTML+text templates for the order confirmation + the 3 OTP emails.
- **Hybrid delivery:** OTP emails send synchronously (errors swallowed so flows never break); the
  order-confirmation email is enqueued and delivered by an **in-process worker** that drains the `Job`
  table with `SELECT … FOR UPDATE SKIP LOCKED` (no double-send — proven by a concurrency test) and
  retries with backoff up to `maxAttempts`. The worker starts in `server.ts` when `JOBS_WORKER_ENABLED`.
- Tests: ~146 backend. Live Gmail delivery verified.

**Deferred to later phases**
- Order status emails (shipped/delivered), marketing/newsletters, an admin email-log/outbox UI,
  bounce/complaint handling, Redis/BullMQ.
```

- [ ] **Step 4: Update memory**

Create `C:\Users\PC\.claude\projects\D--Roots---Rings\memory\roots-rings-phase6-email.md` (real SMTP + job worker built: nodemailer EmailService with `NODE_ENV`-gated capture mode; templates; `processJobs` SKIP LOCKED + retry; in-process worker in server.ts; OTP sync, order confirmation queued; Gmail creds in gitignored `.env`) and add a one-line pointer in `MEMORY.md`.

- [ ] **Step 5: Final checkpoint + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/README.md
git commit -m "docs(email): Phase 6 README + verification"
```

---

## Self-Review

**1. Spec coverage** (spec §2–§9 → tasks):
- §3 EmailService (sendMail, live/log gate, sentMessages) → Task 1. ✅
- §4 templates (otp + order) → Task 2. ✅
- §5 processJobs (SKIP LOCKED, retry/backoff/FAILED) + handle(order_confirmation) → Task 4; worker + server → Task 6; concurrency proof → Task 5. ✅
- §6 wiring (checkout enqueue-only; await sendOtpEmail ×3) → Tasks 3, 4. ✅
- §7 env vars → Task 1. ✅
- §8 security (NODE_ENV gate, swallowed OTP errors, SKIP LOCKED, no secret logging) → Tasks 1, 3, 4. ✅
- §9 testing (capture/templates/process/retry/concurrency/regression/live) → Tasks 1–5, 7. ✅

**2. Placeholder scan:** Every code step has complete code; every test step has real assertions. No TBD/"handle errors". The Task 1 npm-install step has a fallback form (vendored-or-system npm) — both are concrete commands.

**3. Type consistency:** `MailMessage`/`sendMail`/`sentMessages` (Task 1) are consumed identically in Tasks 3–5; `renderOtpEmail`/`renderOrderConfirmation` + `OrderEmail` (Task 2) match their callers (Task 3 sendOtpEmail, Task 4 handle); `processJobs(prisma, batchSize, handler?)` signature matches its callers (worker in Task 6, tests in Tasks 4–5); `HandlerFn` matches `defaultHandle`. The env vars added in Task 1 (`SMTP_*`, `JOBS_*`, `EMAIL_FROM`) are the exact names read by EmailService (Task 1), the worker (Task 6), and `server.ts` (Task 6). `runJobInline` is removed in Task 4 and its only caller (checkout) is updated in the same task — no dangling reference. ✅
