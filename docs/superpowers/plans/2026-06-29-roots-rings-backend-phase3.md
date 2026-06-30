# Roots & Rings Phase 3 — Customer Accounts + Order History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add customer accounts (register/login, OTP email-verify + password-reset, profile, saved addresses) and owner-scoped order history on top of the existing guest checkout, without changing the storefront's visual language.

**Architecture:** Backend gains `auth/` + `account/` modules, JWT (HS256) signed by the API and verified on every authed request; the storefront acts as a thin **BFF** that owns an httpOnly `rr_session` cookie and forwards the JWT to the API as a Bearer token. Guest checkout and the public catalog are untouched; orders placed while authenticated are tagged with `customerId`.

**Tech Stack:** Fastify 5, Prisma + MySQL 8, zod, bcryptjs, `jsonwebtoken`, sharp (existing uploads pipeline), Vitest + Fastify `.inject()` (backend); Astro 5 SSR (`@astrojs/node`), `jsonwebtoken`, Vitest (frontend).

## Global Constraints

- **No git repo** (`Is a git repository: false`). Each task's final step is a **Checkpoint**: run the listed test command(s) and confirm green. Do not run `git` commands. (If the user initializes git later, checkpoints become commits.)
- **Ampersand-path gotcha:** the project lives in `D:\Roots & Rings`; `&` breaks npm scripts. Always call node entrypoints directly (e.g. `node node_modules/vitest/vitest.mjs run`, `node node_modules/prisma/build/index.js ...`). Never `npm run`.
- **Backend tests need the DB.** Ensure `docker compose up -d db` (from repo root `D:\Roots & Rings`) is healthy before running backend tests.
- **TDD, DRY, YAGNI.** Write the failing test first, watch it fail, implement minimally, watch it pass.
- **Money** stays `Number(decimal)` in DTOs; currency BDT (৳). **Email** is always stored lowercased.
- **Do not change the storefront's visual design.** Reuse existing tokens/classes (`.input-minimal`, `.btn-solid`, `.btn-editorial`, `BaseLayout`, `font-display`, `wrap`, `fade-up`). New account pages compose existing primitives only.
- **Never return `passwordHash` or `codeHash`** in any API response. The customer DTO is exactly `{ id, name, email, phone, imageUrl, emailVerifiedAt }`.
- **Owner-scoping:** every account query filters by `customerId = me.id`. A non-owned `orderNumber` returns **404**, never another customer's data.
- Backend test command (single file): `cd backend; node node_modules/vitest/vitest.mjs run tests/<file>`. Full backend suite: `cd backend; node node_modules/vitest/vitest.mjs run`. Frontend: `cd frontend; node node_modules/vitest/vitest.mjs run`.

---

### Task 1: Schema, env, migration, seed, uploads sizing

**Files:**
- Modify: `backend/prisma/schema.prisma` (add enums + 3 models + Customer relations)
- Modify: `backend/src/env.ts` (JWT/OTP vars)
- Modify: `backend/.env` (new secrets)
- Modify: `backend/prisma/seed.ts` (demo customer)
- Modify: `backend/src/modules/uploads/service.ts:37-57` (optional `maxEdge` param)
- Test: none (schema/infra task; verified by migration + generate + a smoke query)

**Interfaces:**
- Produces: Prisma models `Customer`, `CustomerOtp`, `Address`; enums `OtpType { EMAIL_VERIFY PASSWORD_RESET PASSWORD_CHANGE }`, `AddressType { SHIPPING BILLING }`. Env `JWT_SECRET`, `JWT_EXPIRES_IN`, `OTP_TTL_MIN`, `OTP_MAX_ATTEMPTS`. `uploadsService.processImage(buffer, kind, maxEdge?)`.

- [ ] **Step 1: Add enums + models to `schema.prisma`**

Append to `backend/prisma/schema.prisma`:

```prisma
enum OtpType {
  EMAIL_VERIFY
  PASSWORD_RESET
  PASSWORD_CHANGE
}

enum AddressType {
  SHIPPING
  BILLING
}

model Customer {
  id              String        @id @default(cuid())
  email           String        @unique
  passwordHash    String?
  name            String
  phone           String?
  imageUrl        String?
  googleId        String?       @unique
  emailVerifiedAt DateTime?
  isActive        Boolean       @default(true)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  otps            CustomerOtp[]
  addresses       Address[]
}

model CustomerOtp {
  id         String   @id @default(cuid())
  customerId String
  customer   Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  type       OtpType
  codeHash   String
  expiresAt  DateTime
  attempts   Int      @default(0)
  consumedAt DateTime?
  createdAt  DateTime @default(now())

  @@index([customerId, type])
  @@index([expiresAt])
}

model Address {
  id         String      @id @default(cuid())
  customerId String
  customer   Customer    @relation(fields: [customerId], references: [id], onDelete: Cascade)
  type       AddressType @default(SHIPPING)
  isDefault  Boolean     @default(false)
  name       String
  phone      String
  line1      String
  line2      String?
  city       String
  district   String
  postalCode String?
  country    String      @default("Bangladesh")
  createdAt  DateTime    @default(now())
  updatedAt  DateTime    @updatedAt

  @@index([customerId])
}
```

(Leave `Order.customerId` as the existing nullable `String` column — no FK, preserving the Phase 2 guest-order shape.)

- [ ] **Step 2: Add env vars to `backend/src/env.ts`**

Inside the `z.object({ ... })`, after the bKash block:

```ts
  // Phase 3 — customer auth
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  OTP_TTL_MIN: z.coerce.number().int().positive().default(15),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
```

- [ ] **Step 3: Add secrets to `backend/.env`**

Append (the value must be ≥32 chars):

```
JWT_SECRET=dev-jwt-secret-change-me-0123456789abcdef
JWT_EXPIRES_IN=7d
```

- [ ] **Step 4: Add an optional `maxEdge` to the uploads pipeline**

In `backend/src/modules/uploads/service.ts`, change the `processImage` signature and the resize call:

```ts
  async processImage(buffer: Buffer, kind: UploadKind, maxEdge = 1600): Promise<ProcessedImage> {
```
```ts
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
```

- [ ] **Step 5: Seed a demo customer**

In `backend/prisma/seed.ts`, near the admin bootstrap, add (import `hashPassword` from `../src/lib/password` if not already imported):

```ts
  const demoEmail = 'customer@rootsandrings.example';
  await prisma.customer.upsert({
    where: { email: demoEmail },
    update: {},
    create: {
      email: demoEmail,
      name: 'Demo Customer',
      passwordHash: await hashPassword('ChangeMe123!'),
      emailVerifiedAt: new Date(),
    },
  });
  console.log(`Seeded demo customer: ${demoEmail} / ChangeMe123!`);
```

- [ ] **Step 6: Run migration + generate + seed**

```
cd backend
node node_modules/prisma/build/index.js migrate dev --name phase3_customer_accounts
node node_modules/prisma/build/index.js generate
node --env-file=.env --import tsx prisma/seed.ts
```
Expected: migration applies cleanly (additive — no DROP on existing tables; the `Product_name_shortDescription_idx` FULLTEXT index must remain), client regenerates, seed logs the demo customer.

- [ ] **Step 7: Checkpoint**

Run the full backend suite — existing 84 tests still green (schema additions don't break anything):
```
cd backend; node node_modules/vitest/vitest.mjs run
```
Expected: all pass.

---

### Task 2: JWT lib

**Files:**
- Create: `backend/src/lib/jwt.ts`
- Test: `backend/tests/jwt.test.ts`
- Add dep: `jsonwebtoken` + `@types/jsonwebtoken`

**Interfaces:**
- Produces: `signCustomerToken(c: { id: string; email: string; name: string }): string`, `verifyCustomerToken(token: string): CustomerClaims`, `interface CustomerClaims { sub: string; email: string; name: string }`.

- [ ] **Step 1: Install jsonwebtoken**

```
cd backend
node node_modules/npm/bin/npm-cli.js install jsonwebtoken
node node_modules/npm/bin/npm-cli.js install -D @types/jsonwebtoken
```
(If `npm` is not vendored, use the system `npm install jsonwebtoken @types/jsonwebtoken -D` from the `backend` dir — note the path has no `&`, so npm works here.)

- [ ] **Step 2: Write the failing test**

`backend/tests/jwt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { signCustomerToken, verifyCustomerToken } from '../src/lib/jwt';

const c = { id: 'cust_1', email: 'a@b.com', name: 'Aya' };

describe('customer JWT', () => {
  it('round-trips claims', () => {
    const token = signCustomerToken(c);
    const claims = verifyCustomerToken(token);
    expect(claims.sub).toBe('cust_1');
    expect(claims.email).toBe('a@b.com');
    expect(claims.name).toBe('Aya');
  });

  it('rejects a tampered token', () => {
    const token = signCustomerToken(c);
    expect(() => verifyCustomerToken(token + 'x')).toThrow();
  });

  it('rejects garbage', () => {
    expect(() => verifyCustomerToken('not.a.jwt')).toThrow();
  });
});
```

- [ ] **Step 3: Run it — verify it fails**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/jwt.test.ts
```
Expected: FAIL (cannot find `../src/lib/jwt`).

- [ ] **Step 4: Implement `backend/src/lib/jwt.ts`**

```ts
import jwt from 'jsonwebtoken';
import { env } from '../env';

export interface CustomerClaims {
  sub: string;
  email: string;
  name: string;
}

export function signCustomerToken(c: { id: string; email: string; name: string }): string {
  return jwt.sign({ email: c.email, name: c.name }, env.JWT_SECRET, {
    subject: c.id,
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function verifyCustomerToken(token: string): CustomerClaims {
  const p = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  return { sub: String(p.sub), email: String(p.email), name: String(p.name) };
}
```

- [ ] **Step 5: Run it — verify it passes**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/jwt.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 6: Checkpoint** — `node node_modules/vitest/vitest.mjs run` still green.

---

### Task 3: OTP service

**Files:**
- Create: `backend/src/modules/auth/otp.ts`
- Test: `backend/tests/otp.test.ts`

**Interfaces:**
- Consumes: `httpError` from `../../lib/errors`, `env` from `../../env`, Prisma `customerOtp`.
- Produces: `issueOtp(db, customerId, type): Promise<string>` (returns the plaintext code), `verifyOtp(db, customerId, type, code): Promise<void>` (throws `httpError(400)` on failure). `type Db = PrismaClient | Prisma.TransactionClient`.

- [ ] **Step 1: Write the failing test**

`backend/tests/otp.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { issueOtp, verifyOtp } from '../src/modules/auth/otp';
import { hashPassword } from '../src/lib/password';

const prisma = new PrismaClient();
let customerId: string;

beforeAll(async () => {
  const c = await prisma.customer.create({
    data: { email: 'otp-zz@test.com', name: 'OTP', passwordHash: await hashPassword('x12345678') },
  });
  customerId = c.id;
});

afterAll(async () => {
  await prisma.customer.deleteMany({ where: { email: 'otp-zz@test.com' } });
  await prisma.$disconnect();
});

describe('OTP service', () => {
  it('issues a 6-digit code that verifies once', async () => {
    const code = await issueOtp(prisma, customerId, 'EMAIL_VERIFY');
    expect(code).toMatch(/^\d{6}$/);
    await expect(verifyOtp(prisma, customerId, 'EMAIL_VERIFY', code)).resolves.toBeUndefined();
    // single-use: second verify fails
    await expect(verifyOtp(prisma, customerId, 'EMAIL_VERIFY', code)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a wrong code and counts the attempt', async () => {
    await issueOtp(prisma, customerId, 'PASSWORD_RESET');
    await expect(verifyOtp(prisma, customerId, 'PASSWORD_RESET', '000000')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('invalidates prior codes of the same type on re-issue', async () => {
    const first = await issueOtp(prisma, customerId, 'PASSWORD_CHANGE');
    await issueOtp(prisma, customerId, 'PASSWORD_CHANGE');
    await expect(verifyOtp(prisma, customerId, 'PASSWORD_CHANGE', first)).rejects.toMatchObject({ statusCode: 400 });
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/otp.test.ts
```
Expected: FAIL (cannot find `../src/modules/auth/otp`).

- [ ] **Step 3: Implement `backend/src/modules/auth/otp.ts`**

```ts
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
```

- [ ] **Step 4: Run it — verify it passes**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/otp.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Checkpoint** — full backend suite green.

---

### Task 4: Auth guards + request decoration

**Files:**
- Create: `backend/src/modules/auth/guards.ts`
- Modify: `backend/src/app.ts` (decorate request)
- Test: covered by Task 5's route tests (guards have no standalone deliverable)

**Interfaces:**
- Produces: `customerContext(req)` (preHandler; decodes a Bearer token into `req.customerClaims`, never throws), `requireCustomer(req)` (preHandler; verifies + loads `req.customer` or throws `httpError(401)`). Augments `FastifyRequest` with `customerClaims?: CustomerClaims` and `customer?: Customer`.

- [ ] **Step 1: Implement `backend/src/modules/auth/guards.ts`**

```ts
import type { FastifyRequest } from 'fastify';
import type { Customer } from '@prisma/client';
import { verifyCustomerToken, type CustomerClaims } from '../../lib/jwt';
import { httpError } from '../../lib/errors';

declare module 'fastify' {
  interface FastifyRequest {
    customerClaims?: CustomerClaims;
    customer?: Customer;
  }
}

function readBearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

/** Optional auth: attach claims if a valid token is present; never throws. */
export async function customerContext(req: FastifyRequest): Promise<void> {
  const token = readBearer(req);
  if (!token) return;
  try {
    req.customerClaims = verifyCustomerToken(token);
  } catch {
    /* anonymous — ignore an invalid token */
  }
}

/** Required auth: verify token, load the customer, assert active. */
export async function requireCustomer(req: FastifyRequest): Promise<void> {
  const token = readBearer(req);
  if (!token) throw httpError(401, 'Authentication required');
  let claims: CustomerClaims;
  try {
    claims = verifyCustomerToken(token);
  } catch {
    throw httpError(401, 'Invalid or expired session');
  }
  const customer = await req.server.prisma.customer.findUnique({ where: { id: claims.sub } });
  if (!customer || !customer.isActive) throw httpError(401, 'Account not found or inactive');
  req.customer = customer;
}
```

- [ ] **Step 2: Decorate request defaults in `backend/src/app.ts`**

After `const app = Fastify({ ... });` (before plugin registration), add:

```ts
  app.decorateRequest('customerClaims', undefined);
  app.decorateRequest('customer', undefined);
```

- [ ] **Step 3: Checkpoint** — `node node_modules/vitest/vitest.mjs run` still green (no behavior change yet; this compiles the augmentation).

---

### Task 5: Auth routes + OTP email

**Files:**
- Create: `backend/src/modules/auth/schemas.ts`
- Create: `backend/src/modules/auth/dto.ts`
- Create: `backend/src/modules/notifications/email.ts`
- Create: `backend/src/modules/auth/routes.ts`
- Modify: `backend/src/app.ts` (register `authRoutes`)
- Test: `backend/tests/auth.api.test.ts`

**Interfaces:**
- Consumes: `signCustomerToken` (Task 2), `issueOtp`/`verifyOtp` (Task 3), `requireCustomer` (Task 4), `hashPassword`/`verifyPassword` (`lib/password`).
- Produces: routes `POST /api/auth/register|login`, `GET /api/auth/me`, `POST /api/auth/verify-email|forgot-password|reset-password`. `customerDto(c): { id, name, email, phone, imageUrl, emailVerifiedAt }`. `sendOtpEmail(email, type, code): void`.

- [ ] **Step 1: Write the failing test**

`backend/tests/auth.api.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { issueOtp } from '../src/modules/auth/otp';

let app: FastifyInstance;
const EMAIL = 'auth-zz@test.com';
const PASS = 'Supersecret1';

const post = (url: string, payload: object, token?: string) =>
  app.inject({ method: 'POST', url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.prisma.customer.deleteMany({ where: { email: { in: [EMAIL, EMAIL.toUpperCase().toLowerCase()] } } });
  await app.close();
});

describe('auth', () => {
  it('registers, logs in, and returns me', async () => {
    const reg = await post('/api/auth/register', { name: 'Zoe', email: EMAIL, password: PASS });
    expect(reg.statusCode).toBe(201);
    const token = reg.json().token;
    expect(token).toBeTruthy();
    expect(reg.json().customer.email).toBe(EMAIL);
    expect(reg.json().customer.passwordHash).toBeUndefined();

    const dup = await post('/api/auth/register', { name: 'Zoe', email: EMAIL, password: PASS });
    expect(dup.statusCode).toBe(409);

    const bad = await post('/api/auth/login', { email: EMAIL, password: 'wrong' });
    expect(bad.statusCode).toBe(401);

    const ok = await post('/api/auth/login', { email: EMAIL, password: PASS });
    expect(ok.statusCode).toBe(200);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${ok.json().token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().customer.email).toBe(EMAIL);

    const noauth = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(noauth.statusCode).toBe(401);
  });

  it('verifies email with an issued code', async () => {
    const login = await post('/api/auth/login', { email: EMAIL, password: PASS });
    const token = login.json().token;
    const customer = await app.prisma.customer.findUnique({ where: { email: EMAIL } });
    const code = await issueOtp(app.prisma, customer!.id, 'EMAIL_VERIFY');
    const res = await post('/api/auth/verify-email', { code }, token);
    expect(res.statusCode).toBe(200);
    const after = await app.prisma.customer.findUnique({ where: { email: EMAIL } });
    expect(after!.emailVerifiedAt).not.toBeNull();
  });

  it('resets password via an issued code (and forgot is enumeration-safe)', async () => {
    const forgotUnknown = await post('/api/auth/forgot-password', { email: 'nobody-zz@test.com' });
    expect(forgotUnknown.statusCode).toBe(200);

    const customer = await app.prisma.customer.findUnique({ where: { email: EMAIL } });
    const code = await issueOtp(app.prisma, customer!.id, 'PASSWORD_RESET');
    const reset = await post('/api/auth/reset-password', { email: EMAIL, code, newPassword: 'BrandNew123' });
    expect(reset.statusCode).toBe(200);

    const relog = await post('/api/auth/login', { email: EMAIL, password: 'BrandNew123' });
    expect(relog.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/auth.api.test.ts
```
Expected: FAIL (routes not registered → 404).

- [ ] **Step 3: Implement schemas — `backend/src/modules/auth/schemas.ts`**

```ts
import { z } from 'zod';

export const registerBody = z.object({
  name: z.string().trim().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});
export const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export const verifyEmailBody = z.object({ code: z.string().trim().length(6) });
export const forgotBody = z.object({ email: z.string().email() });
export const resetBody = z.object({
  email: z.string().email(),
  code: z.string().trim().length(6),
  newPassword: z.string().min(8),
});
```

- [ ] **Step 4: Implement DTO — `backend/src/modules/auth/dto.ts`**

```ts
import type { Customer } from '@prisma/client';

export function customerDto(c: Customer) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    imageUrl: c.imageUrl,
    emailVerifiedAt: c.emailVerifiedAt,
  };
}
```

- [ ] **Step 5: Implement the OTP email no-op — `backend/src/modules/notifications/email.ts`**

```ts
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
```

- [ ] **Step 6: Implement routes — `backend/src/modules/auth/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { hashPassword, verifyPassword } from '../../lib/password';
import { httpError } from '../../lib/errors';
import { signCustomerToken } from '../../lib/jwt';
import { issueOtp, verifyOtp } from './otp';
import { sendOtpEmail } from '../notifications/email';
import { requireCustomer } from './guards';
import { customerDto } from './dto';
import { registerBody, loginBody, verifyEmailBody, forgotBody, resetBody } from './schemas';

const tightLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/register', tightLimit, async (request, reply) => {
    const { name, email, password } = registerBody.parse(request.body);
    const lower = email.toLowerCase();
    if (await app.prisma.customer.findUnique({ where: { email: lower } })) {
      throw httpError(409, 'An account with this email already exists');
    }
    const customer = await app.prisma.customer.create({
      data: { name, email: lower, passwordHash: await hashPassword(password) },
    });
    const code = await issueOtp(app.prisma, customer.id, 'EMAIL_VERIFY');
    sendOtpEmail(customer.email, 'EMAIL_VERIFY', code);
    return reply.status(201).send({ token: signCustomerToken(customer), customer: customerDto(customer) });
  });

  app.post('/api/auth/login', tightLimit, async (request) => {
    const { email, password } = loginBody.parse(request.body);
    const customer = await app.prisma.customer.findUnique({ where: { email: email.toLowerCase() } });
    if (!customer || !customer.passwordHash || !customer.isActive) throw httpError(401, 'Invalid email or password');
    if (!(await verifyPassword(password, customer.passwordHash))) throw httpError(401, 'Invalid email or password');
    return { token: signCustomerToken(customer), customer: customerDto(customer) };
  });

  app.get('/api/auth/me', { preHandler: requireCustomer }, async (request) => {
    return { customer: customerDto(request.customer!) };
  });

  app.post('/api/auth/verify-email', { preHandler: requireCustomer }, async (request) => {
    const { code } = verifyEmailBody.parse(request.body);
    await verifyOtp(app.prisma, request.customer!.id, 'EMAIL_VERIFY', code);
    const updated = await app.prisma.customer.update({
      where: { id: request.customer!.id },
      data: { emailVerifiedAt: new Date() },
    });
    return { customer: customerDto(updated) };
  });

  app.post('/api/auth/forgot-password', tightLimit, async (request) => {
    const { email } = forgotBody.parse(request.body);
    const customer = await app.prisma.customer.findUnique({ where: { email: email.toLowerCase() } });
    if (customer && customer.isActive) {
      const code = await issueOtp(app.prisma, customer.id, 'PASSWORD_RESET');
      sendOtpEmail(customer.email, 'PASSWORD_RESET', code);
    }
    return { ok: true }; // enumeration-safe: always 200
  });

  app.post('/api/auth/reset-password', tightLimit, async (request) => {
    const { email, code, newPassword } = resetBody.parse(request.body);
    const customer = await app.prisma.customer.findUnique({ where: { email: email.toLowerCase() } });
    if (!customer) throw httpError(400, 'Code is invalid or has expired');
    await verifyOtp(app.prisma, customer.id, 'PASSWORD_RESET', code);
    await app.prisma.customer.update({ where: { id: customer.id }, data: { passwordHash: await hashPassword(newPassword) } });
    return { ok: true };
  });
}
```

- [ ] **Step 7: Register in `backend/src/app.ts`**

Add the import with the other module imports:
```ts
import authRoutes from './modules/auth/routes';
```
And register it in the Public API block (after `healthRoutes`):
```ts
  await app.register(authRoutes);
```

- [ ] **Step 8: Run it — verify it passes**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/auth.api.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 9: Checkpoint** — full backend suite green.

---

### Task 6: Shared order DTO + account dashboard / history / detail

**Files:**
- Create: `backend/src/modules/orders/dto.ts`
- Modify: `backend/src/modules/orders/routes.ts` (use the shared DTO)
- Create: `backend/src/modules/account/routes.ts` (dashboard + orders + detail; placeholder for later tasks' routes)
- Modify: `backend/src/app.ts` (register `accountRoutes`)
- Test: `backend/tests/account.orders.test.ts`

**Interfaces:**
- Consumes: `requireCustomer` (Task 4).
- Produces: `orderToDto(order: FullOrder)` (the existing guest-order shape), `type FullOrder`. Routes `GET /api/account`, `GET /api/account/orders`, `GET /api/account/orders/:orderNumber` (owner-scoped, 404 if not owned).

- [ ] **Step 1: Write the failing test**

`backend/tests/account.orders.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { signCustomerToken } from '../src/lib/jwt';
import { hashPassword } from '../src/lib/password';

let app: FastifyInstance;
let tokenA = '';
let tokenB = '';
let ownedOrderNumber = '';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const a = await app.prisma.customer.create({ data: { email: 'acc-a-zz@test.com', name: 'A', passwordHash: await hashPassword('x12345678') } });
  const b = await app.prisma.customer.create({ data: { email: 'acc-b-zz@test.com', name: 'B', passwordHash: await hashPassword('x12345678') } });
  tokenA = signCustomerToken(a);
  tokenB = signCustomerToken(b);
  const order = await app.prisma.order.create({
    data: {
      orderNumber: 'RR-ACCTEST-0001', customerId: a.id, guestEmail: a.email, guestPhone: '0',
      status: 'PROCESSING', currency: 'BDT', subtotal: 100, shippingTotal: 0, discountTotal: 0, taxTotal: 0, grandTotal: 100,
      idempotencyKey: 'acc-test-idem-zz', orderToken: 'acc-test-token-zz', shippingSnapshot: { line1: 'x', city: 'Dhaka', district: 'Dhaka' },
      items: { create: [{ productId: 'p', variantId: 'v', productName: 'Bowl', variantName: 'Standard', sku: 'S', unitPrice: 100, quantity: 1, lineTotal: 100 }] },
    },
  });
  ownedOrderNumber = order.orderNumber;
});

afterAll(async () => {
  await app.prisma.order.deleteMany({ where: { idempotencyKey: 'acc-test-idem-zz' } });
  await app.prisma.customer.deleteMany({ where: { email: { in: ['acc-a-zz@test.com', 'acc-b-zz@test.com'] } } });
  await app.close();
});

const get = (url: string, token: string) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

describe('account orders', () => {
  it('dashboard returns the customer and recent orders', async () => {
    const res = await get('/api/account', tokenA);
    expect(res.statusCode).toBe(200);
    expect(res.json().customer.email).toBe('acc-a-zz@test.com');
    expect(res.json().recentOrders.length).toBeGreaterThanOrEqual(1);
  });

  it('lists only the owner\'s orders', async () => {
    expect((await get('/api/account/orders', tokenA)).json().some((o: any) => o.orderNumber === ownedOrderNumber)).toBe(true);
    expect((await get('/api/account/orders', tokenB)).json().some((o: any) => o.orderNumber === ownedOrderNumber)).toBe(false);
  });

  it('owner sees detail; a different customer gets 404', async () => {
    expect((await get(`/api/account/orders/${ownedOrderNumber}`, tokenA)).statusCode).toBe(200);
    expect((await get(`/api/account/orders/${ownedOrderNumber}`, tokenB)).statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/account.orders.test.ts
```
Expected: FAIL (404 — routes not registered).

- [ ] **Step 3: Extract the shared order DTO — `backend/src/modules/orders/dto.ts`**

```ts
import type { Order, OrderItem, Payment, Shipment } from '@prisma/client';

export type FullOrder = Order & {
  items: OrderItem[];
  payments: Payment[];
  shipment: Shipment | null;
};

export function orderToDto(order: FullOrder) {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    currency: order.currency,
    email: order.guestEmail,
    placedAt: order.placedAt.toISOString(),
    totals: {
      subtotal: Number(order.subtotal),
      shipping: Number(order.shippingTotal),
      discount: Number(order.discountTotal),
      grand: Number(order.grandTotal),
    },
    items: order.items.map((i) => ({
      name: i.productName,
      variant: i.variantName,
      sku: i.sku,
      unitPrice: Number(i.unitPrice),
      quantity: i.quantity,
      lineTotal: Number(i.lineTotal),
    })),
    payment: order.payments[0]
      ? { provider: order.payments[0].provider, status: order.payments[0].status }
      : null,
    shipping: order.shippingSnapshot,
  };
}
```

- [ ] **Step 4: Refactor `backend/src/modules/orders/routes.ts` to use it**

Replace the whole file body with:

```ts
import type { FastifyInstance } from 'fastify';
import { orderToDto } from './dto';

export default async function ordersRoutes(app: FastifyInstance) {
  app.get('/api/orders/:orderNumber', async (request, reply) => {
    const { orderNumber } = request.params as { orderNumber: string };
    const { token } = request.query as { token?: string };
    const order = await app.prisma.order.findUnique({
      where: { orderNumber },
      include: { items: true, payments: true, shipment: true },
    });
    if (!order || !token || order.orderToken !== token) {
      return reply.status(404).send({ error: 'NotFound', message: 'Order not found', statusCode: 404 });
    }
    return orderToDto(order);
  });
}
```

- [ ] **Step 5: Implement `backend/src/modules/account/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { httpError } from '../../lib/errors';
import { requireCustomer } from '../auth/guards';
import { customerDto } from '../auth/dto';
import { orderToDto } from '../orders/dto';

function summarize(o: { orderNumber: string; status: string; placedAt: Date; grandTotal: unknown; items: { quantity: number }[] }) {
  return {
    orderNumber: o.orderNumber,
    status: o.status,
    placedAt: o.placedAt.toISOString(),
    grand: Number(o.grandTotal),
    itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
  };
}

export default async function accountRoutes(app: FastifyInstance) {
  app.get('/api/account', { preHandler: requireCustomer }, async (request) => {
    const me = request.customer!;
    const recent = await app.prisma.order.findMany({
      where: { customerId: me.id },
      orderBy: { placedAt: 'desc' },
      take: 5,
      include: { items: true },
    });
    return { customer: customerDto(me), recentOrders: recent.map(summarize) };
  });

  app.get('/api/account/orders', { preHandler: requireCustomer }, async (request) => {
    const orders = await app.prisma.order.findMany({
      where: { customerId: request.customer!.id },
      orderBy: { placedAt: 'desc' },
      include: { items: true },
    });
    return orders.map(summarize);
  });

  app.get('/api/account/orders/:orderNumber', { preHandler: requireCustomer }, async (request) => {
    const { orderNumber } = request.params as { orderNumber: string };
    const order = await app.prisma.order.findFirst({
      where: { orderNumber, customerId: request.customer!.id },
      include: { items: true, payments: true, shipment: true },
    });
    if (!order) throw httpError(404, 'Order not found');
    return orderToDto(order);
  });
}
```

- [ ] **Step 6: Register in `backend/src/app.ts`**

Add import:
```ts
import accountRoutes from './modules/account/routes';
```
Register after `authRoutes`:
```ts
  await app.register(accountRoutes);
```

- [ ] **Step 7: Run both affected suites — verify green**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/account.orders.test.ts tests/checkout.api.test.ts
```
Expected: PASS (the refactored guest `/api/orders` route still returns the identical DTO; account tests pass).

- [ ] **Step 8: Checkpoint** — full backend suite green.

---

### Task 7: Account profile, avatar, OTP-guarded password change

**Files:**
- Modify: `backend/src/modules/account/routes.ts` (add profile/avatar/password endpoints)
- Create: `backend/src/modules/account/schemas.ts`
- Test: `backend/tests/account.profile.test.ts`

**Interfaces:**
- Consumes: `requireCustomer`, `issueOtp`/`verifyOtp`, `uploadsService.processImage(buf, 'avatars', 512)`, `hashPassword`/`verifyPassword`, `env.APP_URL`.
- Produces: `PATCH /api/account/profile`, `POST /api/account/avatar`, `POST /api/account/password/request-code`, `POST /api/account/password/change`.

- [ ] **Step 1: Write the failing test**

`backend/tests/account.profile.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { signCustomerToken } from '../src/lib/jwt';
import { hashPassword, verifyPassword } from '../src/lib/password';
import { issueOtp } from '../src/modules/auth/otp';

let app: FastifyInstance;
let token = '';
let customerId = '';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const c = await app.prisma.customer.create({ data: { email: 'prof-zz@test.com', name: 'Old Name', passwordHash: await hashPassword('OldPass123') } });
  customerId = c.id;
  token = signCustomerToken(c);
});

afterAll(async () => {
  await app.prisma.customer.deleteMany({ where: { email: 'prof-zz@test.com' } });
  await app.close();
});

const auth = { authorization: '' };
function h() { return { authorization: `Bearer ${token}` }; }

describe('account profile', () => {
  it('updates name + phone', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/account/profile', headers: h(), payload: { name: 'New Name', phone: '+8801711111111' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().customer.name).toBe('New Name');
    expect(res.json().customer.phone).toBe('+8801711111111');
  });

  it('changes password with current password + OTP', async () => {
    const code = await issueOtp(app.prisma, customerId, 'PASSWORD_CHANGE');
    const res = await app.inject({
      method: 'POST', url: '/api/account/password/change', headers: h(),
      payload: { code, currentPassword: 'OldPass123', newPassword: 'FreshPass456' },
    });
    expect(res.statusCode).toBe(200);
    const after = await app.prisma.customer.findUnique({ where: { id: customerId } });
    expect(await verifyPassword('FreshPass456', after!.passwordHash!)).toBe(true);
  });

  it('rejects password change with a wrong current password', async () => {
    const code = await issueOtp(app.prisma, customerId, 'PASSWORD_CHANGE');
    const res = await app.inject({
      method: 'POST', url: '/api/account/password/change', headers: h(),
      payload: { code, currentPassword: 'WrongNow', newPassword: 'Whatever789' },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/account.profile.test.ts
```
Expected: FAIL (404 — endpoints missing).

- [ ] **Step 3: Implement `backend/src/modules/account/schemas.ts`**

```ts
import { z } from 'zod';

export const profileBody = z.object({
  name: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(3).optional(),
});
export const passwordChangeBody = z.object({
  code: z.string().trim().length(6),
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
```

- [ ] **Step 4: Add the endpoints to `backend/src/modules/account/routes.ts`**

Add imports at the top:
```ts
import { env } from '../../env';
import { hashPassword, verifyPassword } from '../../lib/password';
import { issueOtp, verifyOtp } from '../auth/otp';
import { sendOtpEmail } from '../notifications/email';
import { uploadsService } from '../uploads/service';
import { profileBody, passwordChangeBody } from './schemas';
```
Add these routes inside `accountRoutes` (after the orders routes):
```ts
  app.patch('/api/account/profile', { preHandler: requireCustomer }, async (request) => {
    const data = profileBody.parse(request.body);
    const updated = await app.prisma.customer.update({ where: { id: request.customer!.id }, data });
    return { customer: customerDto(updated) };
  });

  app.post('/api/account/avatar', { preHandler: requireCustomer }, async (request) => {
    const file = await request.file();
    if (!file) throw httpError(400, 'No file uploaded');
    const buf = await file.toBuffer();
    const img = await uploadsService.processImage(buf, 'avatars', 512);
    const updated = await app.prisma.customer.update({
      where: { id: request.customer!.id },
      data: { imageUrl: `${env.APP_URL}${img.url}` },
    });
    return { customer: customerDto(updated) };
  });

  app.post('/api/account/password/request-code', { preHandler: requireCustomer }, async (request) => {
    const code = await issueOtp(app.prisma, request.customer!.id, 'PASSWORD_CHANGE');
    sendOtpEmail(request.customer!.email, 'PASSWORD_CHANGE', code);
    return { ok: true };
  });

  app.post('/api/account/password/change', { preHandler: requireCustomer }, async (request) => {
    const { code, currentPassword, newPassword } = passwordChangeBody.parse(request.body);
    const me = request.customer!;
    if (!me.passwordHash || !(await verifyPassword(currentPassword, me.passwordHash))) {
      throw httpError(400, 'Current password is incorrect');
    }
    await verifyOtp(app.prisma, me.id, 'PASSWORD_CHANGE', code);
    await app.prisma.customer.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(newPassword) } });
    return { ok: true };
  });
```

- [ ] **Step 5: Run it — verify it passes**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/account.profile.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 6: Checkpoint** — full backend suite green.

---

### Task 8: Address CRUD

**Files:**
- Create: `backend/src/modules/account/addresses.ts`
- Modify: `backend/src/modules/account/routes.ts` (register address sub-routes)
- Test: `backend/tests/account.addresses.test.ts`

**Interfaces:**
- Consumes: `requireCustomer`.
- Produces: `registerAddressRoutes(app)` adding `GET/POST /api/account/addresses`, `PATCH/DELETE /api/account/addresses/:id`, `POST /api/account/addresses/:id/default`. Address DTO = the row as-is.

- [ ] **Step 1: Write the failing test**

`backend/tests/account.addresses.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { signCustomerToken } from '../src/lib/jwt';
import { hashPassword } from '../src/lib/password';

let app: FastifyInstance;
let token = '';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const c = await app.prisma.customer.create({ data: { email: 'addr-zz@test.com', name: 'Addr', passwordHash: await hashPassword('x12345678') } });
  token = signCustomerToken(c);
});

afterAll(async () => {
  await app.prisma.customer.deleteMany({ where: { email: 'addr-zz@test.com' } });
  await app.close();
});

const h = () => ({ authorization: `Bearer ${token}` });
const body = { name: 'Addr', phone: '0', line1: '1 Rd', city: 'Dhaka', district: 'Dhaka', postalCode: '1200' };

describe('addresses', () => {
  it('creates, lists, sets default, and deletes', async () => {
    const a = await app.inject({ method: 'POST', url: '/api/account/addresses', headers: h(), payload: { ...body, isDefault: true } });
    expect(a.statusCode).toBe(201);
    const id1 = a.json().id;

    const b = await app.inject({ method: 'POST', url: '/api/account/addresses', headers: h(), payload: { ...body, line1: '2 Rd' } });
    const id2 = b.json().id;

    const list = await app.inject({ method: 'GET', url: '/api/account/addresses', headers: h() });
    expect(list.json().length).toBe(2);

    const setDef = await app.inject({ method: 'POST', url: `/api/account/addresses/${id2}/default`, headers: h() });
    expect(setDef.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/account/addresses', headers: h() });
    const defaults = after.json().filter((x: any) => x.isDefault);
    expect(defaults.length).toBe(1);
    expect(defaults[0].id).toBe(id2);

    const del = await app.inject({ method: 'DELETE', url: `/api/account/addresses/${id1}`, headers: h() });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/account/addresses', headers: h() })).json().length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/account.addresses.test.ts
```
Expected: FAIL (404).

- [ ] **Step 3: Implement `backend/src/modules/account/addresses.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../lib/errors';
import { requireCustomer } from '../auth/guards';

const addressBody = z.object({
  type: z.enum(['SHIPPING', 'BILLING']).optional(),
  isDefault: z.boolean().optional(),
  name: z.string().trim().min(1),
  phone: z.string().trim().min(1),
  line1: z.string().trim().min(1),
  line2: z.string().trim().optional(),
  city: z.string().trim().min(1),
  district: z.string().trim().min(1),
  postalCode: z.string().trim().optional(),
  country: z.string().trim().optional(),
});

export function registerAddressRoutes(app: FastifyInstance) {
  app.get('/api/account/addresses', { preHandler: requireCustomer }, async (request) => {
    return app.prisma.address.findMany({
      where: { customerId: request.customer!.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  });

  app.post('/api/account/addresses', { preHandler: requireCustomer }, async (request, reply) => {
    const data = addressBody.parse(request.body);
    const customerId = request.customer!.id;
    const created = await app.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.address.updateMany({ where: { customerId }, data: { isDefault: false } });
      }
      return tx.address.create({ data: { ...data, customerId } });
    });
    return reply.status(201).send(created);
  });

  app.patch('/api/account/addresses/:id', { preHandler: requireCustomer }, async (request) => {
    const { id } = request.params as { id: string };
    const data = addressBody.partial().parse(request.body);
    const customerId = request.customer!.id;
    const owned = await app.prisma.address.findFirst({ where: { id, customerId } });
    if (!owned) throw httpError(404, 'Address not found');
    return app.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.address.updateMany({ where: { customerId }, data: { isDefault: false } });
      }
      return tx.address.update({ where: { id }, data });
    });
  });

  app.post('/api/account/addresses/:id/default', { preHandler: requireCustomer }, async (request) => {
    const { id } = request.params as { id: string };
    const customerId = request.customer!.id;
    const owned = await app.prisma.address.findFirst({ where: { id, customerId } });
    if (!owned) throw httpError(404, 'Address not found');
    await app.prisma.$transaction([
      app.prisma.address.updateMany({ where: { customerId }, data: { isDefault: false } }),
      app.prisma.address.update({ where: { id }, data: { isDefault: true } }),
    ]);
    return { ok: true };
  });

  app.delete('/api/account/addresses/:id', { preHandler: requireCustomer }, async (request) => {
    const { id } = request.params as { id: string };
    const owned = await app.prisma.address.findFirst({ where: { id, customerId: request.customer!.id } });
    if (!owned) throw httpError(404, 'Address not found');
    await app.prisma.address.delete({ where: { id } });
    return { ok: true };
  });
}
```

- [ ] **Step 4: Wire it into `backend/src/modules/account/routes.ts`**

Add the import:
```ts
import { registerAddressRoutes } from './addresses';
```
At the end of the `accountRoutes` function body:
```ts
  registerAddressRoutes(app);
```

- [ ] **Step 5: Run it — verify it passes**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/account.addresses.test.ts
```
Expected: PASS.

- [ ] **Step 6: Checkpoint** — full backend suite green.

---

### Task 9: Checkout attribution (attach customerId when authed)

**Files:**
- Modify: `backend/src/modules/checkout/service.ts` (accept optional `customerId`)
- Modify: `backend/src/modules/checkout/routes.ts` (attach `customerContext`, pass claims)
- Test: `backend/tests/checkout.customer.test.ts`

**Interfaces:**
- Consumes: `customerContext` (Task 4), `req.customerClaims`.
- Produces: `placeOrder(prisma, input, customerId?)` sets `order.customerId`.

- [ ] **Step 1: Write the failing test**

`backend/tests/checkout.customer.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { signCustomerToken } from '../src/lib/jwt';
import { hashPassword } from '../src/lib/password';

let app: FastifyInstance;
let token = '';
let customerId = '';
const EMAIL = 'co-cust-zz@test.com';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const c = await app.prisma.customer.create({ data: { email: EMAIL, name: 'CO', passwordHash: await hashPassword('x12345678') } });
  customerId = c.id;
  token = signCustomerToken(c);
  const p = await app.prisma.product.create({ data: { name: 'co-cust', slug: 'co-cust-zz', sku: 'TEST-COCUST', shortDescription: 'x', description: 'y', basePrice: 200 } });
  await app.prisma.productVariant.create({ data: { productId: p.id, sku: 'TEST-COCUST-V', name: 'Standard', stock: 5 } });
});

afterAll(async () => {
  await app.prisma.order.deleteMany({ where: { guestEmail: EMAIL } });
  await app.prisma.product.deleteMany({ where: { sku: 'TEST-COCUST' } });
  await app.prisma.customer.deleteMany({ where: { email: EMAIL } });
  await app.close();
});

const body = (idem: string) => ({
  items: [{ slug: 'co-cust-zz', qty: 1 }],
  contact: { name: 'CO', email: EMAIL, phone: '+8801700000000' },
  shipping: { line1: '1 Rd', city: 'Dhaka', district: 'Dhaka' },
  paymentMethod: 'COD', idempotencyKey: idem,
});

describe('checkout customer attribution', () => {
  it('attaches customerId when authenticated', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/checkout', headers: { authorization: `Bearer ${token}` }, payload: body('co-auth-zz') });
    expect(res.statusCode).toBe(200);
    const order = await app.prisma.order.findUnique({ where: { orderNumber: res.json().orderNumber } });
    expect(order!.customerId).toBe(customerId);
  });

  it('stays guest (null customerId) without a token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/checkout', payload: body('co-guest-zz') });
    const order = await app.prisma.order.findUnique({ where: { orderNumber: res.json().orderNumber } });
    expect(order!.customerId).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/checkout.customer.test.ts
```
Expected: FAIL (`customerId` is null even when authed).

- [ ] **Step 3: Thread `customerId` through `placeOrder`**

In `backend/src/modules/checkout/service.ts`, change the signature:
```ts
export async function placeOrder(prisma: PrismaClient, input: CheckoutInput, customerId?: string): Promise<PlaceOrderResult> {
```
In the `tx.order.create({ data: { ... } })` object, add after `orderNumber`:
```ts
        customerId: customerId ?? null,
```

- [ ] **Step 4: Attach `customerContext` + pass claims in `backend/src/modules/checkout/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { checkoutBody } from './schemas';
import { placeOrder } from './service';
import { customerContext } from '../auth/guards';

export default async function checkoutRoutes(app: FastifyInstance) {
  app.post(
    '/api/checkout',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, preHandler: customerContext },
    async (request, reply) => {
      const input = checkoutBody.parse(request.body);
      const result = await placeOrder(app.prisma, input, request.customerClaims?.sub);
      return reply.status(200).send(result);
    },
  );
}
```

- [ ] **Step 5: Run it — verify it passes**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/checkout.customer.test.ts tests/checkout.api.test.ts
```
Expected: PASS (attribution works; guest checkout unchanged).

- [ ] **Step 6: Checkpoint** — full backend suite green (expect ~99 tests across 22 files).

---

### Task 10: Frontend session lib

**Files:**
- Create: `frontend/src/lib/auth.ts`
- Create: `frontend/tests/auth.test.ts`
- Modify: `frontend/.env` (`JWT_SECRET`, must equal the backend's)
- Add dep: `jsonwebtoken` (frontend)

**Interfaces:**
- Produces: `SESSION_COOKIE = 'rr_session'`, `verifySession(token): Session | null`, `getSession(Astro): Session | null`, `bearer(Astro): string | undefined`, `interface Session { sub: string; email: string; name: string }`.

- [ ] **Step 1: Install jsonwebtoken in the frontend**

```
cd frontend
node node_modules/npm/bin/npm-cli.js install jsonwebtoken
node node_modules/npm/bin/npm-cli.js install -D @types/jsonwebtoken
```
(or system `npm install jsonwebtoken @types/jsonwebtoken -D` from the `frontend` dir.)

- [ ] **Step 2: Add the shared secret to `frontend/.env`**

```
JWT_SECRET=dev-jwt-secret-change-me-0123456789abcdef
PUBLIC_API_URL=http://localhost:4000
```
(JWT_SECRET MUST match `backend/.env`. `PUBLIC_API_URL` is read by SSR + BFF.)

- [ ] **Step 3: Write the failing test**

`frontend/tests/auth.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';

beforeAll(() => {
  process.env.JWT_SECRET = 'dev-jwt-secret-change-me-0123456789abcdef';
});

describe('verifySession', () => {
  it('verifies a valid token and rejects a bad one', async () => {
    const { verifySession } = await import('../src/lib/auth');
    const token = jwt.sign({ email: 'a@b.com', name: 'Aya' }, process.env.JWT_SECRET!, { subject: 'cust_1', expiresIn: '7d' });
    const s = verifySession(token);
    expect(s?.sub).toBe('cust_1');
    expect(s?.email).toBe('a@b.com');
    expect(verifySession('garbage')).toBeNull();
  });

  it('rejects an expired token', async () => {
    const { verifySession } = await import('../src/lib/auth');
    const token = jwt.sign({ email: 'a@b.com', name: 'Aya' }, process.env.JWT_SECRET!, { subject: 'cust_1', expiresIn: -10 });
    expect(verifySession(token)).toBeNull();
  });
});
```

- [ ] **Step 4: Run it — verify it fails**

```
cd frontend; node node_modules/vitest/vitest.mjs run tests/auth.test.ts
```
Expected: FAIL (cannot find `../src/lib/auth`).

- [ ] **Step 5: Implement `frontend/src/lib/auth.ts`**

```ts
import jwt from 'jsonwebtoken';
import type { AstroGlobal } from 'astro';

const SECRET = import.meta.env.JWT_SECRET ?? process.env.JWT_SECRET ?? '';
export const SESSION_COOKIE = 'rr_session';

export interface Session {
  sub: string;
  email: string;
  name: string;
}

export function verifySession(token: string): Session | null {
  if (!SECRET) return null;
  try {
    const p = jwt.verify(token, SECRET) as jwt.JwtPayload;
    return { sub: String(p.sub), email: String(p.email), name: String(p.name) };
  } catch {
    return null;
  }
}

export function getSession(Astro: AstroGlobal): Session | null {
  const token = Astro.cookies.get(SESSION_COOKIE)?.value;
  return token ? verifySession(token) : null;
}

export function bearer(Astro: AstroGlobal): string | undefined {
  return Astro.cookies.get(SESSION_COOKIE)?.value;
}
```

- [ ] **Step 6: Run it — verify it passes**

```
cd frontend; node node_modules/vitest/vitest.mjs run tests/auth.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 7: Checkpoint** — full frontend suite green (`node node_modules/vitest/vitest.mjs run`).

---

### Task 11: BFF endpoints (auth + checkout + account proxy)

**Files:**
- Create: `frontend/src/pages/api/auth/login.ts`, `register.ts`, `logout.ts`, `forgot.ts`, `reset.ts`, `verify.ts`
- Create: `frontend/src/pages/api/checkout.ts`
- Create: `frontend/src/pages/api/account/[...path].ts`
- Modify: `frontend/src/lib/checkout.ts` (POST to same-origin `/api/checkout`)
- Test: none automated (verified by the Task 14 browser pass; endpoints are thin proxies)

**Interfaces:**
- Consumes: `SESSION_COOKIE` (Task 10).
- Produces: same-origin endpoints that set/clear the `rr_session` cookie and proxy to the API with the Bearer token.

- [ ] **Step 1: `frontend/src/pages/api/auth/login.ts`**

```ts
import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '../../../lib/auth';

const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';
const WEEK = 60 * 60 * 24 * 7;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const next = String(form.get('next') || '/account');
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Login failed' }));
    return redirect(`/account/login?error=${encodeURIComponent(err.message ?? 'Login failed')}&next=${encodeURIComponent(next)}`);
  }
  const data = await res.json();
  cookies.set(SESSION_COOKIE, data.token, { httpOnly: true, sameSite: 'lax', path: '/', secure: import.meta.env.PROD, maxAge: WEEK });
  return redirect(next);
};
```

- [ ] **Step 2: `frontend/src/pages/api/auth/register.ts`**

```ts
import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '../../../lib/auth';

const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';
const WEEK = 60 * 60 * 24 * 7;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const res = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: form.get('name'), email: form.get('email'), password: form.get('password') }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Registration failed' }));
    return redirect(`/account/register?error=${encodeURIComponent(err.message ?? 'Registration failed')}`);
  }
  const data = await res.json();
  cookies.set(SESSION_COOKIE, data.token, { httpOnly: true, sameSite: 'lax', path: '/', secure: import.meta.env.PROD, maxAge: WEEK });
  return redirect('/account/verify-email?welcome=1');
};
```

- [ ] **Step 3: `frontend/src/pages/api/auth/logout.ts`**

```ts
import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '../../../lib/auth';

export const POST: APIRoute = async ({ cookies, redirect }) => {
  cookies.delete(SESSION_COOKIE, { path: '/' });
  return redirect('/');
};
```

- [ ] **Step 4: `frontend/src/pages/api/auth/forgot.ts`**

```ts
import type { APIRoute } from 'astro';

const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  await fetch(`${API}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: form.get('email') }),
  });
  // Always behave the same (enumeration-safe).
  return redirect('/account/reset-password?sent=1');
};
```

- [ ] **Step 5: `frontend/src/pages/api/auth/reset.ts`**

```ts
import type { APIRoute } from 'astro';

const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const res = await fetch(`${API}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: form.get('email'), code: form.get('code'), newPassword: form.get('newPassword') }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Reset failed' }));
    return redirect(`/account/reset-password?error=${encodeURIComponent(err.message ?? 'Reset failed')}`);
  }
  return redirect('/account/login?reset=1');
};
```

- [ ] **Step 6: `frontend/src/pages/api/auth/verify.ts`**

```ts
import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '../../../lib/auth';

const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return redirect('/account/login');
  const res = await fetch(`${API}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ code: form.get('code') }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Verification failed' }));
    return redirect(`/account/verify-email?error=${encodeURIComponent(err.message ?? 'Verification failed')}`);
  }
  return redirect('/account?verified=1');
};
```

- [ ] **Step 7: `frontend/src/pages/api/checkout.ts`** (proxy + attach bearer)

```ts
import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '../../lib/auth';

const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await request.text();
  const token = cookies.get(SESSION_COOKIE)?.value;
  const res = await fetch(`${API}/api/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body,
  });
  return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } });
};
```

- [ ] **Step 8: `frontend/src/pages/api/account/[...path].ts`** (generic authed proxy)

```ts
import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '../../../lib/auth';

const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';

const handler: APIRoute = async ({ request, params, cookies }) => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return new Response(JSON.stringify({ message: 'Authentication required' }), { status: 401, headers: { 'content-type': 'application/json' } });
  const path = params.path ? `/${params.path}` : '';
  const search = new URL(request.url).search;
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  const ct = request.headers.get('content-type');
  if (ct) headers['content-type'] = ct;
  const init: RequestInit = { method: request.method, headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = Buffer.from(await request.arrayBuffer());
  const res = await fetch(`${API}/api/account${path}${search}`, init);
  return new Response(await res.text(), { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } });
};

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
```

- [ ] **Step 9: Repoint the client checkout fetch in `frontend/src/lib/checkout.ts`**

Change the API constant and the fetch URL so the browser hits the same-origin BFF (which attaches the bearer). Replace:
```ts
const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';
```
with:
```ts
const CHECKOUT_URL = '/api/checkout';
```
and change the fetch call from `` `${API}/api/checkout` `` to `CHECKOUT_URL`.

- [ ] **Step 10: Build to verify endpoints compile**

```
cd frontend; node node_modules/astro/astro.js build
```
Expected: build completes; the new `/api/*` routes appear as endpoints. (No visual change.)

- [ ] **Step 11: Checkpoint** — frontend suite green.

---

### Task 12: Account pages — auth flows + dashboard + history

**Files:**
- Create: `frontend/src/components/account/AccountNav.astro`
- Create: `frontend/src/pages/account/login.astro`, `register.astro`, `forgot-password.astro`, `reset-password.astro`, `verify-email.astro`
- Create: `frontend/src/pages/account/index.astro`, `orders.astro`, `orders/[orderNumber].astro`
- Modify: `frontend/src/components/layout/Header.astro:61` (Account icon → `/account`)
- Test: none automated (browser pass in Task 14)

**Interfaces:**
- Consumes: `getSession`, `bearer` (Task 10); BFF endpoints (Task 11). Backend `GET /api/account`, `/orders`, `/orders/:orderNumber`.

- [ ] **Step 1: `frontend/src/components/account/AccountNav.astro`**

```astro
---
const { active } = Astro.props as { active: string };
const links = [
  { href: '/account', label: 'Overview', key: 'overview' },
  { href: '/account/orders', label: 'Orders', key: 'orders' },
  { href: '/account/profile', label: 'Profile', key: 'profile' },
  { href: '/account/addresses', label: 'Addresses', key: 'addresses' },
];
---
<nav class="flex flex-col gap-1">
  {links.map((l) => (
    <a href={l.href} class={`text-label-caps uppercase py-2 transition-opacity ${l.key === active ? 'opacity-100' : 'opacity-50 hover:opacity-100'}`}>{l.label}</a>
  ))}
  <form method="POST" action="/api/auth/logout" class="mt-4">
    <button class="text-label-caps uppercase opacity-50 hover:opacity-100 transition-opacity">Sign out</button>
  </form>
</nav>
```

- [ ] **Step 2: `frontend/src/pages/account/login.astro`**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { getSession } from '../../lib/auth';
if (getSession(Astro)) return Astro.redirect('/account');
const params = Astro.url.searchParams;
const error = params.get('error');
const reset = params.get('reset');
const next = params.get('next') ?? '/account';
const labelCls = 'text-label-caps uppercase opacity-60 flex flex-col gap-2';
---
<BaseLayout title="Sign In" noindex={true}>
  <section class="wrap py-16 md:py-24 max-w-md mx-auto">
    <h1 class="font-display text-display-mobile mb-8">Sign in</h1>
    {error && <p class="text-caption text-error border border-error px-4 py-3 mb-6">{error}</p>}
    {reset && <p class="text-caption text-secondary border border-secondary px-4 py-3 mb-6">Password updated — please sign in.</p>}
    <form method="POST" action="/api/auth/login" class="flex flex-col gap-6">
      <input type="hidden" name="next" value={next} />
      <label class={labelCls}>Email<input type="email" name="email" required autocomplete="email" class="input-minimal text-body-md" /></label>
      <label class={labelCls}>Password<input type="password" name="password" required autocomplete="current-password" class="input-minimal text-body-md" /></label>
      <button class="btn-solid w-full">Sign In</button>
    </form>
    <div class="flex justify-between mt-6">
      <a href="/account/forgot-password" class="btn-editorial text-label-caps uppercase">Forgot password?</a>
      <a href="/account/register" class="btn-editorial text-label-caps uppercase">Create account</a>
    </div>
  </section>
</BaseLayout>
```

- [ ] **Step 3: `frontend/src/pages/account/register.astro`**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { getSession } from '../../lib/auth';
if (getSession(Astro)) return Astro.redirect('/account');
const error = Astro.url.searchParams.get('error');
const labelCls = 'text-label-caps uppercase opacity-60 flex flex-col gap-2';
---
<BaseLayout title="Create Account" noindex={true}>
  <section class="wrap py-16 md:py-24 max-w-md mx-auto">
    <h1 class="font-display text-display-mobile mb-8">Create account</h1>
    {error && <p class="text-caption text-error border border-error px-4 py-3 mb-6">{error}</p>}
    <form method="POST" action="/api/auth/register" class="flex flex-col gap-6">
      <label class={labelCls}>Name<input name="name" required autocomplete="name" class="input-minimal text-body-md" /></label>
      <label class={labelCls}>Email<input type="email" name="email" required autocomplete="email" class="input-minimal text-body-md" /></label>
      <label class={labelCls}>Password<input type="password" name="password" required minlength="8" autocomplete="new-password" class="input-minimal text-body-md" /></label>
      <button class="btn-solid w-full">Create Account</button>
    </form>
    <a href="/account/login" class="btn-editorial text-label-caps uppercase mt-6 inline-block">Already have an account? Sign in</a>
  </section>
</BaseLayout>
```

- [ ] **Step 4: `frontend/src/pages/account/forgot-password.astro`**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
const labelCls = 'text-label-caps uppercase opacity-60 flex flex-col gap-2';
---
<BaseLayout title="Forgot Password" noindex={true}>
  <section class="wrap py-16 md:py-24 max-w-md mx-auto">
    <h1 class="font-display text-display-mobile mb-4">Reset password</h1>
    <p class="text-body-md text-on-surface-variant mb-8">Enter your email and we'll send a 6-digit reset code.</p>
    <form method="POST" action="/api/auth/forgot" class="flex flex-col gap-6">
      <label class={labelCls}>Email<input type="email" name="email" required class="input-minimal text-body-md" /></label>
      <button class="btn-solid w-full">Send Reset Code</button>
    </form>
    <a href="/account/login" class="btn-editorial text-label-caps uppercase mt-6 inline-block">Back to sign in</a>
  </section>
</BaseLayout>
```

- [ ] **Step 5: `frontend/src/pages/account/reset-password.astro`**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
const params = Astro.url.searchParams;
const sent = params.get('sent');
const error = params.get('error');
const labelCls = 'text-label-caps uppercase opacity-60 flex flex-col gap-2';
---
<BaseLayout title="Reset Password" noindex={true}>
  <section class="wrap py-16 md:py-24 max-w-md mx-auto">
    <h1 class="font-display text-display-mobile mb-4">Enter reset code</h1>
    {sent && <p class="text-caption text-secondary border border-secondary px-4 py-3 mb-6">If that email exists, a code is on its way. (Dev: check the API server log.)</p>}
    {error && <p class="text-caption text-error border border-error px-4 py-3 mb-6">{error}</p>}
    <form method="POST" action="/api/auth/reset" class="flex flex-col gap-6">
      <label class={labelCls}>Email<input type="email" name="email" required class="input-minimal text-body-md" /></label>
      <label class={labelCls}>6-digit code<input name="code" required inputmode="numeric" pattern="\d{6}" class="input-minimal text-body-md" /></label>
      <label class={labelCls}>New password<input type="password" name="newPassword" required minlength="8" autocomplete="new-password" class="input-minimal text-body-md" /></label>
      <button class="btn-solid w-full">Update Password</button>
    </form>
  </section>
</BaseLayout>
```

- [ ] **Step 6: `frontend/src/pages/account/verify-email.astro`**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { getSession } from '../../lib/auth';
const session = getSession(Astro);
if (!session) return Astro.redirect('/account/login?next=/account/verify-email');
const params = Astro.url.searchParams;
const welcome = params.get('welcome');
const error = params.get('error');
const labelCls = 'text-label-caps uppercase opacity-60 flex flex-col gap-2';
---
<BaseLayout title="Verify Email" noindex={true}>
  <section class="wrap py-16 md:py-24 max-w-md mx-auto">
    <h1 class="font-display text-display-mobile mb-4">Verify your email</h1>
    {welcome && <p class="text-body-md text-on-surface-variant mb-2">Welcome, {session.name.split(' ')[0]}! We sent a 6-digit code to {session.email}.</p>}
    <p class="text-caption text-on-surface-variant mb-8">Dev note: the code is printed in the API server log (SMTP arrives in a later phase).</p>
    {error && <p class="text-caption text-error border border-error px-4 py-3 mb-6">{error}</p>}
    <form method="POST" action="/api/auth/verify" class="flex flex-col gap-6">
      <label class={labelCls}>6-digit code<input name="code" required inputmode="numeric" pattern="\d{6}" class="input-minimal text-body-md" /></label>
      <button class="btn-solid w-full">Verify</button>
    </form>
    <a href="/account" class="btn-editorial text-label-caps uppercase mt-6 inline-block">Skip for now</a>
  </section>
</BaseLayout>
```

- [ ] **Step 7: `frontend/src/pages/account/index.astro`** (dashboard)

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import AccountNav from '../../components/account/AccountNav.astro';
import { getSession, bearer } from '../../lib/auth';
import { formatPrice } from '../../lib/format';
const session = getSession(Astro);
if (!session) return Astro.redirect('/account/login?next=/account');
const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';
let data: { customer: any; recentOrders: any[] } = { customer: { name: session.name, email: session.email, emailVerifiedAt: null }, recentOrders: [] };
try {
  const res = await fetch(`${API}/api/account`, { headers: { authorization: `Bearer ${bearer(Astro)}` } });
  if (res.ok) data = await res.json();
} catch { /* fall back to session basics */ }
const verified = Astro.url.searchParams.get('verified');
---
<BaseLayout title="My Account" noindex={true}>
  <section class="wrap py-16 md:py-24">
    <h1 class="font-display text-display-mobile md:text-display-lg mb-12">Hello, {data.customer.name.split(' ')[0]}.</h1>
    {verified && <p class="text-caption text-secondary border border-secondary px-4 py-3 mb-8">Email verified — thank you.</p>}
    <div class="grid lg:grid-cols-[200px_1fr] gap-12 lg:gap-20 items-start">
      <AccountNav active="overview" />
      <div class="flex flex-col gap-10">
        {!data.customer.emailVerifiedAt && (
          <a href="/account/verify-email" class="text-caption border border-secondary text-secondary px-4 py-3">Your email isn't verified yet — verify it →</a>
        )}
        <div>
          <h2 class="font-display text-headline-sm mb-5">Recent orders</h2>
          {data.recentOrders.length === 0 ? (
            <p class="text-body-md text-on-surface-variant">No orders yet. <a href="/objects" class="btn-editorial">Browse Objects</a></p>
          ) : (
            <div class="flex flex-col hairline-t">
              {data.recentOrders.map((o) => (
                <a href={`/account/orders/${o.orderNumber}`} class="flex justify-between items-center py-4 hairline-b hover:opacity-70 transition-opacity">
                  <span class="text-body-md">{o.orderNumber} <span class="opacity-50 text-label-caps uppercase ml-2">{o.status}</span></span>
                  <span class="text-body-md">{formatPrice(o.grand)}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  </section>
</BaseLayout>
```

- [ ] **Step 8: `frontend/src/pages/account/orders.astro`**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import AccountNav from '../../components/account/AccountNav.astro';
import { getSession, bearer } from '../../lib/auth';
import { formatPrice } from '../../lib/format';
const session = getSession(Astro);
if (!session) return Astro.redirect('/account/login?next=/account/orders');
const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';
let orders: any[] = [];
try {
  const res = await fetch(`${API}/api/account/orders`, { headers: { authorization: `Bearer ${bearer(Astro)}` } });
  if (res.ok) orders = await res.json();
} catch { /* empty */ }
---
<BaseLayout title="Order History" noindex={true}>
  <section class="wrap py-16 md:py-24">
    <h1 class="font-display text-display-mobile md:text-display-lg mb-12">Order history</h1>
    <div class="grid lg:grid-cols-[200px_1fr] gap-12 lg:gap-20 items-start">
      <AccountNav active="orders" />
      <div>
        {orders.length === 0 ? (
          <p class="text-body-md text-on-surface-variant">No orders yet. <a href="/objects" class="btn-editorial">Browse Objects</a></p>
        ) : (
          <div class="flex flex-col hairline-t">
            {orders.map((o) => (
              <a href={`/account/orders/${o.orderNumber}`} class="flex justify-between items-center py-5 hairline-b hover:opacity-70 transition-opacity">
                <span>
                  <span class="text-body-md block">{o.orderNumber}</span>
                  <span class="text-label-caps uppercase opacity-50">{o.status} · {o.itemCount} item(s)</span>
                </span>
                <span class="text-body-md">{formatPrice(o.grand)}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  </section>
</BaseLayout>
```

- [ ] **Step 9: `frontend/src/pages/account/orders/[orderNumber].astro`**

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import AccountNav from '../../../components/account/AccountNav.astro';
import { getSession, bearer } from '../../../lib/auth';
import { formatPrice } from '../../../lib/format';
const session = getSession(Astro);
if (!session) return Astro.redirect('/account/login');
const { orderNumber } = Astro.params;
const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';
let order: any = null;
try {
  const res = await fetch(`${API}/api/account/orders/${orderNumber}`, { headers: { authorization: `Bearer ${bearer(Astro)}` } });
  if (res.ok) order = await res.json();
} catch { /* not found */ }
---
<BaseLayout title={`Order ${orderNumber}`} noindex={true}>
  <section class="wrap py-16 md:py-24">
    <div class="grid lg:grid-cols-[200px_1fr] gap-12 lg:gap-20 items-start">
      <AccountNav active="orders" />
      {order ? (
        <div>
          <a href="/account/orders" class="btn-editorial text-label-caps uppercase mb-6 inline-block">← All orders</a>
          <h1 class="font-display text-headline-lg mb-2">{order.orderNumber}</h1>
          <p class="text-label-caps uppercase opacity-50 mb-8">{order.status} · {new Date(order.placedAt).toLocaleDateString()}</p>
          <div class="bg-surface-container-low p-8">
            {order.items.map((i: any) => (
              <div class="flex justify-between py-3 hairline-b">
                <span class="text-body-md">{i.name} <span class="opacity-50">× {i.quantity}</span></span>
                <span class="text-body-md">{formatPrice(i.lineTotal)}</span>
              </div>
            ))}
            <div class="flex justify-between pt-5 font-display text-body-lg"><span>Total</span><span>{formatPrice(order.totals.grand)}</span></div>
          </div>
          {order.payment && <p class="text-caption text-on-surface-variant mt-4">Payment: {order.payment.provider} · {order.payment.status}</p>}
        </div>
      ) : (
        <div>
          <h1 class="font-display text-headline-lg italic mb-4">Order not found.</h1>
          <a href="/account/orders" class="btn-solid">Back to orders</a>
        </div>
      )}
    </div>
  </section>
</BaseLayout>
```

- [ ] **Step 10: Repoint the Account icon in `frontend/src/components/layout/Header.astro`**

Change line 61's `href="/about"` to `href="/account"` (keep everything else — `aria-label`, classes, the `<Icon name="account" />` — identical):
```astro
      <a href="/account" aria-label="Account" class="hidden md:inline-flex opacity-60 hover:opacity-100 transition-opacity">
```

- [ ] **Step 11: Build to verify pages compile**

```
cd frontend; node node_modules/astro/astro.js build
```
Expected: build succeeds; `/account`, `/account/orders`, `/account/orders/[orderNumber]`, and the auth pages are emitted.

- [ ] **Step 12: Checkpoint** — frontend suite green.

---

### Task 13: Profile + addresses pages, account island, checkout prefill

**Files:**
- Create: `frontend/src/pages/account/profile.astro`
- Create: `frontend/src/pages/account/addresses.astro`
- Create: `frontend/src/scripts/account.ts`
- Modify: `frontend/src/pages/checkout.astro` (prefill for logged-in users)
- Test: none automated (browser pass in Task 14)

**Interfaces:**
- Consumes: `getSession`, `bearer`; the `/api/account/*` proxy (Task 11). `account.ts` runs client-side, fetching the same-origin proxy.

- [ ] **Step 1: `frontend/src/scripts/account.ts`** (client island for profile + addresses)

```ts
/** Account-area client island: profile save, avatar upload, address add/delete/default. */
function init(): void {
  const root = document.querySelector('[data-account]');
  if (!root) return;
  const err = root.querySelector<HTMLElement>('[data-account-error]');

  function fail(message: string): void {
    if (err) { err.textContent = message; err.hidden = false; }
  }
  async function send(path: string, method: string, body?: BodyInit, headers?: Record<string, string>): Promise<Response> {
    const res = await fetch(`/api/account${path}`, { method, body, headers });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ message: 'Something went wrong' }));
      throw new Error(data.message ?? `Error ${res.status}`);
    }
    return res;
  }

  // Profile save
  root.querySelector<HTMLFormElement>('[data-profile-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (err) err.hidden = true;
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    try {
      await send('/profile', 'PATCH', JSON.stringify({ name: fd.get('name'), phone: fd.get('phone') }), { 'content-type': 'application/json' });
      window.location.reload();
    } catch (e2) { fail((e2 as Error).message); }
  });

  // Avatar upload
  root.querySelector<HTMLInputElement>('[data-avatar-input]')?.addEventListener('change', async (e) => {
    const input = e.currentTarget as HTMLInputElement;
    if (!input.files?.length) return;
    const fd = new FormData();
    fd.append('file', input.files[0]);
    try {
      await send('/avatar', 'POST', fd);
      window.location.reload();
    } catch (e2) { fail((e2 as Error).message); }
  });

  // Add address
  root.querySelector<HTMLFormElement>('[data-address-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (err) err.hidden = true;
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const payload: Record<string, unknown> = Object.fromEntries(fd.entries());
    payload.isDefault = fd.get('isDefault') === 'on';
    try {
      await send('/addresses', 'POST', JSON.stringify(payload), { 'content-type': 'application/json' });
      window.location.reload();
    } catch (e2) { fail((e2 as Error).message); }
  });

  // Delete / set-default (event delegation)
  root.addEventListener('click', async (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-address-action]');
    if (!t) return;
    e.preventDefault();
    const id = t.getAttribute('data-id');
    const action = t.getAttribute('data-address-action');
    try {
      if (action === 'delete') await send(`/addresses/${id}`, 'DELETE');
      else if (action === 'default') await send(`/addresses/${id}/default`, 'POST');
      window.location.reload();
    } catch (e2) { fail((e2 as Error).message); }
  });
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
```

- [ ] **Step 2: `frontend/src/pages/account/profile.astro`**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import AccountNav from '../../components/account/AccountNav.astro';
import { getSession, bearer } from '../../lib/auth';
const session = getSession(Astro);
if (!session) return Astro.redirect('/account/login?next=/account/profile');
const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';
let customer: any = { name: session.name, email: session.email, phone: '', imageUrl: null };
try {
  const res = await fetch(`${API}/api/account`, { headers: { authorization: `Bearer ${bearer(Astro)}` } });
  if (res.ok) customer = (await res.json()).customer;
} catch { /* defaults */ }
const labelCls = 'text-label-caps uppercase opacity-60 flex flex-col gap-2';
---
<BaseLayout title="Profile" noindex={true}>
  <section class="wrap py-16 md:py-24" data-account>
    <h1 class="font-display text-display-mobile md:text-display-lg mb-12">Profile</h1>
    <div class="grid lg:grid-cols-[200px_1fr] gap-12 lg:gap-20 items-start">
      <AccountNav active="profile" />
      <div class="flex flex-col gap-12 max-w-lg">
        <p data-account-error hidden class="text-caption text-error border border-error px-4 py-3"></p>

        <div class="flex items-center gap-5">
          {customer.imageUrl
            ? <img src={customer.imageUrl} alt="" class="w-20 h-20 rounded-full object-cover" />
            : <div class="w-20 h-20 rounded-full bg-surface-container flex items-center justify-center font-display text-headline-sm">{customer.name.charAt(0)}</div>}
          <label class="btn-editorial text-label-caps uppercase cursor-pointer">
            Change photo<input type="file" accept="image/*" data-avatar-input class="hidden" />
          </label>
        </div>

        <form data-profile-form class="flex flex-col gap-6">
          <label class={labelCls}>Name<input name="name" value={customer.name} required class="input-minimal text-body-md" /></label>
          <label class={labelCls}>Email<input value={customer.email} disabled class="input-minimal text-body-md opacity-60" /></label>
          <label class={labelCls}>Phone<input name="phone" value={customer.phone ?? ''} class="input-minimal text-body-md" /></label>
          <button class="btn-solid w-fit">Save changes</button>
        </form>

        <a href="/account/reset-password" class="btn-editorial text-label-caps uppercase">Change password →</a>
      </div>
    </div>
  </section>
</BaseLayout>
<script>
  import '../../scripts/account.ts';
</script>
```

(Note: the simplest secure password-change path for the UI is the logged-out reset flow link above; the OTP-guarded in-place change endpoints remain available for a future inline form.)

- [ ] **Step 3: `frontend/src/pages/account/addresses.astro`**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import AccountNav from '../../components/account/AccountNav.astro';
import { getSession, bearer } from '../../lib/auth';
const session = getSession(Astro);
if (!session) return Astro.redirect('/account/login?next=/account/addresses');
const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';
let addresses: any[] = [];
try {
  const res = await fetch(`${API}/api/account/addresses`, { headers: { authorization: `Bearer ${bearer(Astro)}` } });
  if (res.ok) addresses = await res.json();
} catch { /* empty */ }
const labelCls = 'text-label-caps uppercase opacity-60 flex flex-col gap-2';
---
<BaseLayout title="Addresses" noindex={true}>
  <section class="wrap py-16 md:py-24" data-account>
    <h1 class="font-display text-display-mobile md:text-display-lg mb-12">Addresses</h1>
    <div class="grid lg:grid-cols-[200px_1fr] gap-12 lg:gap-20 items-start">
      <AccountNav active="addresses" />
      <div class="flex flex-col gap-12 max-w-2xl">
        <p data-account-error hidden class="text-caption text-error border border-error px-4 py-3"></p>

        {addresses.length > 0 && (
          <div class="grid sm:grid-cols-2 gap-5">
            {addresses.map((a) => (
              <div class={`p-6 hairline ${a.isDefault ? 'bg-surface-container-low' : ''}`}>
                {a.isDefault && <span class="text-label-caps uppercase text-secondary block mb-2">Default</span>}
                <p class="text-body-md">{a.name}</p>
                <p class="text-body-sm text-on-surface-variant">{a.line1}{a.line2 ? `, ${a.line2}` : ''}</p>
                <p class="text-body-sm text-on-surface-variant">{a.city}, {a.district} {a.postalCode ?? ''}</p>
                <p class="text-body-sm text-on-surface-variant mb-4">{a.phone}</p>
                <div class="flex gap-4">
                  {!a.isDefault && <button data-address-action="default" data-id={a.id} class="btn-editorial text-label-caps uppercase">Make default</button>}
                  <button data-address-action="delete" data-id={a.id} class="btn-editorial text-label-caps uppercase opacity-60">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div>
          <h2 class="font-display text-headline-sm mb-6">Add an address</h2>
          <form data-address-form class="grid sm:grid-cols-2 gap-6">
            <label class={labelCls}>Name<input name="name" required class="input-minimal text-body-md" /></label>
            <label class={labelCls}>Phone<input name="phone" required class="input-minimal text-body-md" /></label>
            <label class={`${labelCls} sm:col-span-2`}>Address line 1<input name="line1" required class="input-minimal text-body-md" /></label>
            <label class={`${labelCls} sm:col-span-2`}>Address line 2<input name="line2" class="input-minimal text-body-md" /></label>
            <label class={labelCls}>City<input name="city" required class="input-minimal text-body-md" /></label>
            <label class={labelCls}>District<input name="district" required class="input-minimal text-body-md" /></label>
            <label class={labelCls}>Postal code<input name="postalCode" class="input-minimal text-body-md" /></label>
            <label class="flex items-center gap-3 text-body-md sm:col-span-2"><input type="checkbox" name="isDefault" /> Set as default</label>
            <button class="btn-solid w-fit sm:col-span-2">Add Address</button>
          </form>
        </div>
      </div>
    </div>
  </section>
</BaseLayout>
<script>
  import '../../scripts/account.ts';
</script>
```

- [ ] **Step 4: Prefill checkout for logged-in users — `frontend/src/pages/checkout.astro`**

In the frontmatter, after the existing `lookupJson` line, add:
```ts
import { getSession, bearer } from '../lib/auth';
const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';
const session = getSession(Astro);
let prefill: { name?: string; email?: string; phone?: string; line1?: string; line2?: string; city?: string; district?: string; postalCode?: string } = {};
if (session) {
  prefill.name = session.name;
  prefill.email = session.email;
  try {
    const [meRes, addrRes] = await Promise.all([
      fetch(`${API}/api/account`, { headers: { authorization: `Bearer ${bearer(Astro)}` } }),
      fetch(`${API}/api/account/addresses`, { headers: { authorization: `Bearer ${bearer(Astro)}` } }),
    ]);
    if (meRes.ok) prefill.phone = (await meRes.json()).customer.phone ?? undefined;
    if (addrRes.ok) {
      const list = await addrRes.json();
      const def = list.find((a: any) => a.isDefault) ?? list[0];
      if (def) prefill = { ...prefill, name: def.name, phone: def.phone, line1: def.line1, line2: def.line2 ?? undefined, city: def.city, district: def.district, postalCode: def.postalCode ?? undefined };
    }
  } catch { /* keep basics */ }
}
```
Then add `value={prefill.<field> ?? ''}` to the matching inputs (name, email, phone, line1, line2, city, district, postalCode). For example, the name input becomes:
```astro
<label class={labelCls}>Name<input name="name" required autocomplete="name" value={prefill.name ?? ''} class="input-minimal text-body-md" /></label>
```
Apply the same `value={prefill.X ?? ''}` to email, phone, line1, line2, city, district, postalCode. (Leave the payment radios and the summary script untouched.)

- [ ] **Step 5: Build to verify**

```
cd frontend; node node_modules/astro/astro.js build
```
Expected: build succeeds with all account pages + checkout prefill.

- [ ] **Step 6: Checkpoint** — frontend suite green.

---

### Task 14: Full sweep + README + browser verification

**Files:**
- Modify: `backend/README.md` (Phase 3 section)
- Modify: memory `roots-rings-phase3-accounts.md` (mark built)
- Test: full backend + frontend suites; manual browser pass

- [ ] **Step 1: Run the full backend suite**

```
cd backend; node node_modules/vitest/vitest.mjs run
```
Expected: all green (84 prior + jwt 3 + otp 3 + auth 3 + account.orders 3 + account.profile 3 + account.addresses 1 + checkout.customer 2 ≈ 102 tests).

- [ ] **Step 2: Run the full frontend suite**

```
cd frontend; node node_modules/vitest/vitest.mjs run
```
Expected: all green (41 prior + auth 2 = 43).

- [ ] **Step 3: Start the stack and do a browser pass**

Ensure DB is up (`docker compose up -d db` from repo root). Then:
```
cd backend; node --env-file=.env --import tsx src/server.ts   (→ :4000)
cd frontend; node node_modules/astro/astro.js dev             (→ :4321)
```
Walk the flow in the browser:
1. `/account/register` → create an account → redirected to `/account/verify-email`.
2. Read the 6-digit code from the **backend server log** (`[email] OTP for … : NNNNNN`), submit it → `/account?verified=1`.
3. Add an address under `/account/addresses` (set as default).
4. Add an item to bag → `/checkout` — contact + shipping are **pre-filled** from the default address → place a COD order → `/checkout/success`.
5. `/account/orders` shows the new order; open it → detail renders. Confirm `/admin/orders` (backend) lists the same order with the customer attached.
6. Sign out (AccountNav) → `/account` redirects to login.

- [ ] **Step 4: Add the Phase 3 section to `backend/README.md`**

After the Phase 2 admin line / before "## Phase 1 — implemented vs. deferred", insert:

```markdown
## Phase 3 — implemented vs. deferred

**Implemented (this phase)**
- Customer auth: `POST /api/auth/register|login`, `GET /api/auth/me`,
  `POST /api/auth/verify-email|forgot-password|reset-password`. JWT (HS256, `JWT_SECRET`), bcrypt.
- OTP system: 6-digit codes, bcrypt-hashed, `OTP_TTL_MIN` expiry, `OTP_MAX_ATTEMPTS` cap,
  single-use, prior-code invalidation. Emails are logged no-ops until SMTP (read codes from the log).
- Account API (`requireCustomer`): dashboard, owner-scoped order history + detail (404 if not yours),
  profile, avatar (WebP pipeline), address CRUD + default, OTP-guarded password change.
- Checkout attaches `customerId` when authenticated; storefront pre-fills from the default address.
- Storefront BFF (Astro `/api/*` endpoints own an httpOnly `rr_session` cookie, forward a Bearer
  to the API) + on-brand `/account/*` pages. Header Account icon → `/account`.

**Deferred to Phase 4+**
- Google OAuth, real SMTP delivery, claiming guest orders by email, backend-persisted cart/merge,
  coupons, reviews, wishlist sync, SEO/CMS, enhancements.
```

Also add the new env vars to the env table:
```markdown
| `JWT_SECRET` | 32+ char secret for customer JWTs (shared with the storefront) |
| `JWT_EXPIRES_IN` / `OTP_TTL_MIN` / `OTP_MAX_ATTEMPTS` | Token lifetime; OTP TTL + attempt cap |
```

- [ ] **Step 5: Update memory**

Edit `C:\Users\PC\.claude\projects\D--Roots---Rings\memory\roots-rings-phase3-accounts.md`: change the status line to "Phase 3 **BUILT** — accounts + OTP + addresses + order history; N backend + 43 frontend tests pass" and note the BFF cookie/Bearer pattern shipped.

- [ ] **Step 6: Final checkpoint** — both suites green; browser flow verified end-to-end.

---

## Self-Review

**1. Spec coverage** (spec §3–§10 → tasks):
- §3 schema (Customer/CustomerOtp/Address) → Task 1. ✅
- §4 auth/JWT/guards → Tasks 2, 4, 5. ✅
- §5 OTP (issue/verify, password change) → Tasks 3, 7. ✅
- §6 account API (dashboard/orders/detail/profile/avatar/addresses/password) → Tasks 6, 7, 8. ✅
- §7 checkout attribution + prefill → Tasks 9 (backend), 13 (prefill). ✅
- §8 storefront BFF + pages + header → Tasks 11, 12, 13. ✅
- §9 security (bcrypt, JWT, OTP hardening, owner-scoping, rate-limit, enumeration-safe) → Tasks 3/5/6/8 tests + route configs. ✅
- §10 testing (unit + integration + browser) → Tasks 2–9 tests + Task 14 browser pass. ✅

**2. Placeholder scan:** No "TBD"/"add error handling"/bare "write tests" — every code step has complete code and every test step has real assertions. ✅

**3. Type consistency:** `customerDto` shape identical across auth/account; `orderToDto`/`FullOrder` shared by guest + account routes; `Session { sub,email,name }` matches `CustomerClaims`; `SESSION_COOKIE` constant reused by every BFF endpoint; `issueOtp`/`verifyOtp` signatures consistent backend-wide; `processImage(buf, kind, maxEdge)` matches its one new caller. ✅
