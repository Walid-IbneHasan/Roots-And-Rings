# Roots & Rings — Phase 6 Design Spec (Email delivery + job worker)

**Date:** 2026-06-30
**Status:** Approved
**Builds on:** Phases 1–5. This phase turns the logged-no-op emails (order confirmation + OTPs) into
real SMTP delivery and adds an in-process worker that drains the existing `Job` queue.

## 0. Decisions (confirmed)

- **Hybrid delivery:** OTP emails (verify / reset / OTP-guarded password-change) send **synchronously**
  in-request; the **order-confirmation** email is **enqueued** to the `Job` table and delivered by a
  worker with retry/backoff.
- **Real SMTP via Gmail** — credentials already in `backend/.env` (`SMTP_*`, gitignored). nodemailer.
- **In-process interval worker** — a `setInterval` loop in the server process (started in `server.ts`,
  gated by `JOBS_WORKER_ENABLED`), NOT in `buildApp` (so the test suite never spawns it).
- **Scope:** wire the 4 existing emails only (order confirmation + 3 OTP). No status/marketing emails.
- **Tests never send real email** — the EmailService is in capture/log mode whenever `NODE_ENV==='test'`
  (regardless of `SMTP_*` being set), so the suite can't hit Gmail.

## 1. Goals & non-goals

**Goals**
- A real `EmailService` (nodemailer) with a clean `sendMail` interface + a no-credentials/test
  log-capture fallback.
- Templated HTML+text emails for order confirmation and the three OTP types.
- A DB-backed job worker: `processJobs` claims due jobs with `SELECT … FOR UPDATE SKIP LOCKED`
  (no double-send under concurrency), runs the handler, retries with backoff up to `maxAttempts`.
- An in-process interval worker started by the server; OTPs send synchronously.
- Tests (incl. a concurrent-`processJobs` no-double-send proof) + a live-send check once creds are live.

**Non-goals (later)**
- Order status emails (shipped/delivered), marketing/newsletters, an admin outbox/email-log UI,
  bounce/complaint handling, Redis/BullMQ (the `Job` table suffices at this scale).

## 2. Architecture

All in `backend/src/modules/notifications/`:
- **`email.ts` (EmailService):** lazily builds a nodemailer transport from `SMTP_*`; `sendMail(msg)`.
  **Live mode** = `NODE_ENV !== 'test' && SMTP_HOST` set → real send. Otherwise **log/capture mode**
  → logs a one-line summary and pushes the message to an in-memory `sentMessages` array (test hook).
  `sendOtpEmail(email, type, code)` becomes async: renders the OTP template and sends, **catching its
  own errors** (logs, never throws) so an SMTP failure can't break register/reset.
- **`templates.ts`:** pure functions `renderOtpEmail(type, code)` and `renderOrderConfirmation(order)`
  → `{ subject, html, text }`, sharing a small branded HTML layout. No file IO (easy to unit-test).
- **`jobs.ts`:** keep `enqueueJob`; the `email.order_confirmation` handler now loads the order, renders
  `renderOrderConfirmation`, and calls `EmailService.sendMail`. Add **`processJobs(prisma, batchSize)`**
  (claim → handle → DONE / retry-backoff / FAILED). Remove `runJobInline`.
- **`worker.ts`:** `startJobWorker(prisma, { intervalMs, batchSize })` (setInterval → `processJobs`,
  `.unref()` so it never blocks exit) + `stopJobWorker()`.

Touched outside the module: `env.ts` (new vars), `server.ts` (start the worker), `checkout/service.ts`
(enqueue only — drop the inline drain), `auth/routes.ts` + `account/routes.ts` (`await sendOtpEmail`).

## 3. EmailService (`notifications/email.ts`)

- `interface MailMessage { to: string; subject: string; html: string; text: string }`.
- `sendMail(msg): Promise<void>` — live mode: `transport.sendMail({ from: env.EMAIL_FROM, ...msg })`;
  log mode: `console.log('[email] → to | subject')` + `sentMessages.push(msg)`.
- Transport is built once (module singleton) only when live. Gmail: host `smtp.gmail.com`, port 465,
  `secure: true`, `auth: { user: SMTP_USER, pass: SMTP_PASS }`.
- Test hook: `export const sentMessages: MailMessage[]` + `export function resetSentMessages()`.
- `sendOtpEmail(email, type, code): Promise<void>` — `const { subject, html, text } =
  renderOtpEmail(type, code); try { await sendMail({ to: email, subject, html, text }) } catch (e) {
  console.error('[email] OTP send failed', e) }`.

## 4. Templates (`notifications/templates.ts`)

- `layout(title, bodyHtml): string` — a minimal branded HTML shell (Roots & Rings wordmark header,
  inline styles, footer). `text` versions are plain strings.
- `renderOtpEmail(type: OtpType, code: string)` → subject per type ("Verify your email" /
  "Reset your password" / "Confirm your password change"), HTML showing the 6-digit code + a short
  line, and a text fallback.
- `renderOrderConfirmation(order)` where `order` includes its items → subject
  `Order <orderNumber> confirmed`, an HTML receipt (items, quantities, line totals, grand total in ৳,
  COD/“pay on delivery” note when the payment is COD), and a text fallback. Amounts via `Number(...)`.

## 5. Job worker (`notifications/jobs.ts` + `worker.ts`)

- `processJobs(prisma, batchSize): Promise<{ processed: number; failed: number }>`:
  1. **Claim** in a ReadCommitted transaction:
     `SELECT id FROM Job WHERE status='PENDING' AND runAt <= ? ORDER BY runAt ASC
      LIMIT <batchSize> FOR UPDATE SKIP LOCKED` (batchSize is a validated integer interpolated into the
     SQL; `?` binds `now`), then `updateMany` those ids to `status='PROCESSING', lockedAt=now`.
  2. For each claimed id: load the job, run `handle(prisma, job.type, job.payload)`; on success →
     `status='DONE', attempts+1, lockedAt=null`; on error → `attempts+1`, and if `attempts < maxAttempts`
     reschedule `status='PENDING', runAt = now + attempts·60s, lastError`, else `status='FAILED', lastError`.
  `SKIP LOCKED` guarantees two concurrent workers claim disjoint jobs → no double-send.
- `handle` dispatches `email.order_confirmation` → load order (+items) → `renderOrderConfirmation` →
  `EmailService.sendMail`. Unknown types are a no-op (logged).
- `worker.ts`: `startJobWorker` stores a single `setInterval` handle (idempotent; `unref()`), each tick
  runs `processJobs(...).catch(log)`; `stopJobWorker` clears it.
- `server.ts`: after `app.listen`, `if (env.JOBS_WORKER_ENABLED) startJobWorker(app.prisma,
  { intervalMs: env.JOBS_POLL_INTERVAL_MS, batchSize: env.JOBS_BATCH_SIZE })`.

## 6. Wiring changes

- `checkout/service.ts`: keep `enqueueJob('email.order_confirmation', { orderId })`; **remove the
  `runJobInline` import + call**. The worker delivers within one poll interval.
- `auth/routes.ts` (register → EMAIL_VERIFY; forgot-password → PASSWORD_RESET) and `account/routes.ts`
  (password/request-code → PASSWORD_CHANGE): change the three calls to `await sendOtpEmail(...)`.

## 7. Env (additive; all optional → safe defaults; see `src/env.ts`)

| Var | Default | Purpose |
|---|---|---|
| `SMTP_HOST` | — | SMTP server (live send only when set) |
| `SMTP_PORT` | 587 | port (Gmail uses 465) |
| `SMTP_SECURE` | false | TLS-on-connect (`true` for 465) — parsed as `v==='true'` |
| `SMTP_USER` / `SMTP_PASS` | — | SMTP auth |
| `EMAIL_FROM` | `Roots & Rings <no-reply@rootsandrings.example>` | From header |
| `JOBS_WORKER_ENABLED` | true | start the interval worker (parsed `v!=='false'`) |
| `JOBS_POLL_INTERVAL_MS` | 10000 | worker poll cadence |
| `JOBS_BATCH_SIZE` | 10 | jobs claimed per tick |

(`backend/.env` already holds the live Gmail values; they're gitignored.)

## 8. Security & correctness

- Tests + no-credentials environments never send real mail (gated on `NODE_ENV` + `SMTP_HOST`).
- OTP send failures are swallowed (logged) so account flows never break on email problems.
- `SKIP LOCKED` claim + per-job `attempts`/`maxAttempts` prevent double-send and infinite retry loops.
- SMTP credentials live only in the gitignored `.env`; nothing is logged in full (sender logs a
  one-line `to | subject` summary, never the body or the password).
- `EMAIL_FROM`/recipient come from server-side data (the order/customer), never client input.

## 9. Testing

- **Unit:** EmailService log/capture (no throw without SMTP; `sentMessages` captures);
  `renderOtpEmail`/`renderOrderConfirmation` produce subject + non-empty html/text with the code/total.
- **Integration (`.inject()` / direct):** enqueue a job → `processJobs` → job `DONE` + one captured
  message; a handler that throws → `attempts` increments + reschedules (`PENDING`, future `runAt`), and
  after `maxAttempts` → `FAILED` with `lastError`.
- **Concurrency:** seed N jobs, run two `processJobs` concurrently → each job processed exactly once
  (captured messages == N, no duplicates).
- **Regression:** the auth/checkout suites stay green with the async `sendOtpEmail` + enqueue-only
  checkout (worker not running in tests; the order job stays `PENDING`, which the tests don't assert on).
- **Live check (after creds confirmed live):** register a real account → the verify email arrives in the
  Gmail inbox; place an order → the confirmation arrives within the poll interval. (Then rotate the app
  password, since it was shared in chat.)
- Existing 181 tests stay green.

## 10. File structure

**New:** `modules/notifications/{templates,worker}.ts`, `tests/{email,jobs.worker,jobs.concurrency}.test.ts`.
**Modified:** `modules/notifications/{email,jobs}.ts`, `modules/checkout/service.ts`,
`modules/auth/routes.ts`, `modules/account/routes.ts`, `src/env.ts`, `src/server.ts`.
**Deps:** add `nodemailer` (+ `@types/nodemailer`).

## 11. Rollout

No schema change (the `Job` model already exists). Additive env. The worker only runs in
`server.ts` when enabled. With `.env` creds in place, delivery is live immediately; with creds absent
(CI/other devs), it logs. After Phase 6: order status emails, wishlist, SEO, enhancements.
