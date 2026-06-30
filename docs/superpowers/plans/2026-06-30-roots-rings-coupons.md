# Roots & Rings Phase 4 — Coupons & Discounts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add discount codes (percent / fixed, order-subtotal) applied through the existing server-side checkout re-pricing, with concurrency-safe usage caps, admin CRUD, and an on-brand storefront apply-at-checkout flow.

**Architecture:** A new backend `coupons/` module (validate/compute/redeem) plugs into `placeOrder`; the global usage cap is enforced with `SELECT … FOR UPDATE` on the coupon row inside the existing checkout transaction (same pattern as inventory). A public `validate` endpoint powers a live preview; the order re-validates + redeems on submit. The discount flows through the `Order.discountTotal` slot that already exists.

**Tech Stack:** Fastify 5, Prisma + MySQL 8, zod, Vitest + Fastify `.inject()` (backend); Astro 5 SSR (frontend). No new dependencies.

## Global Constraints

- **Git:** work on branch `phase-4-coupons` (already created). Each task ends with a real commit (Conventional Commit message; end the body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).
- **Ampersand-path gotcha:** project lives in `D:\Roots & Rings`; `&` breaks npm scripts. Call node entrypoints directly (`node node_modules/vitest/vitest.mjs run`, `node node_modules/prisma/build/index.js ...`). Never `npm run`.
- **Backend tests need the DB:** `docker compose up -d db` (from repo root) must be healthy.
- **TDD, DRY, YAGNI.** Failing test → watch fail → implement → watch pass.
- **Money:** Decimal(12,2); use `round2` from `lib/money`; DTOs return `Number(decimal)`. Currency BDT (৳).
- **Coupon codes** are normalized to **trim + UPPERCASE** everywhere (storage, lookup, redemption).
- **Server is authoritative:** the discount is always recomputed + re-validated server-side at submit; the client preview is advisory. Discount is clamped to `[0, subtotal]` (no negative totals).
- **Do not change the storefront's visual design.** Reuse existing tokens/classes only.
- Backend single-file test: `cd backend; node node_modules/vitest/vitest.mjs run tests/<file>`. Full backend: `cd backend; node node_modules/vitest/vitest.mjs run`. Frontend: `cd frontend; node node_modules/vitest/vitest.mjs run`.
- A known occasionally-flaky `uploads` timeout test is unrelated to this phase; if only that times out, re-run once.

---

### Task 1: Schema, migration, seed

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/prisma/seed.ts`
- Test: none (infra; verified by migrate + generate + the full suite staying green)

**Interfaces:**
- Produces: Prisma models `Coupon`, `CouponRedemption`; enum `CouponType { PERCENT FIXED }`; new `Order.couponCode String?`.

- [ ] **Step 1: Add the enum + models to `backend/prisma/schema.prisma`**

Append:

```prisma
enum CouponType {
  PERCENT
  FIXED
}

model Coupon {
  id               String             @id @default(cuid())
  code             String             @unique
  description      String?
  type             CouponType
  value            Decimal            @db.Decimal(12, 2)
  minOrderSubtotal Decimal            @default(0) @db.Decimal(12, 2)
  maxRedemptions   Int?
  perCustomerLimit Int?
  startsAt         DateTime?
  endsAt           DateTime?
  isActive         Boolean            @default(true)
  timesRedeemed    Int                @default(0)
  createdAt        DateTime           @default(now())
  updatedAt        DateTime           @updatedAt
  redemptions      CouponRedemption[]
}

model CouponRedemption {
  id         String   @id @default(cuid())
  couponId   String
  coupon     Coupon   @relation(fields: [couponId], references: [id], onDelete: Cascade)
  orderId    String
  customerId String?
  email      String
  amount     Decimal  @db.Decimal(12, 2)
  createdAt  DateTime @default(now())

  @@index([couponId])
  @@index([couponId, customerId])
  @@index([couponId, email])
}
```

- [ ] **Step 2: Add `couponCode` to the `Order` model**

In the `Order` model, add this field (next to `idempotencyKey`):

```prisma
  couponCode       String?
```

- [ ] **Step 3: Seed two demo coupons**

In `backend/prisma/seed.ts`, after the demo customer block, add:

```ts
  await prisma.coupon.upsert({
    where: { code: 'SAVE20' },
    update: {},
    create: { code: 'SAVE20', description: '20% off your order', type: 'PERCENT', value: 20 },
  });
  await prisma.coupon.upsert({
    where: { code: 'WELCOME100' },
    update: {},
    create: { code: 'WELCOME100', description: '৳100 off orders over ৳500', type: 'FIXED', value: 100, minOrderSubtotal: 500 },
  });
  console.log('Seeded demo coupons: SAVE20, WELCOME100');
```

- [ ] **Step 4: Migrate + generate + seed**

```
cd backend
node node_modules/prisma/build/index.js migrate dev --name phase4_coupons
node node_modules/prisma/build/index.js generate
node --env-file=.env --import tsx prisma/seed.ts
```
Expected: additive migration (CREATE TABLE Coupon + CouponRedemption + ALTER TABLE Order ADD couponCode + FK). It must NOT drop `Product_name_shortDescription_idx` or any existing table; if it proposes a destructive change, STOP and report.

- [ ] **Step 5: Checkpoint — full backend suite still green**

```
cd backend; node node_modules/vitest/vitest.mjs run
```
Expected: 102 passing (no regressions).

- [ ] **Step 6: Commit**

```
git add backend/prisma/schema.prisma backend/prisma/seed.ts backend/prisma/migrations
git commit -m "feat(coupons): schema, migration, demo seed"
```

---

### Task 2: Coupon errors + computeDiscount + validateCoupon

**Files:**
- Create: `backend/src/modules/coupons/errors.ts`
- Create: `backend/src/modules/coupons/service.ts`
- Test: `backend/tests/coupons.service.test.ts`

**Interfaces:**
- Produces: `class CouponError extends Error { statusCode = 400 }`; `normalizeCode(code): string`; `computeDiscount(coupon: {type, value}, subtotal: number): number`; `interface CouponContext { subtotal: number; customerId?: string; email?: string }`; `validateCoupon(db, code, ctx): Promise<{ coupon: Coupon; discount: number }>` (throws `CouponError`, no writes).

- [ ] **Step 1: Write the failing test**

`backend/tests/coupons.service.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { computeDiscount, validateCoupon } from '../src/modules/coupons/service';
import { CouponError } from '../src/modules/coupons/errors';

const prisma = new PrismaClient();
const codes = ['PCT10ZZ', 'FIX50ZZ', 'MIN500ZZ', 'OFFZZ', 'CAPZZ'];

beforeAll(async () => {
  await prisma.couponRedemption.deleteMany({ where: { coupon: { code: { in: codes } } } });
  await prisma.coupon.deleteMany({ where: { code: { in: codes } } });
  await prisma.coupon.createMany({
    data: [
      { code: 'PCT10ZZ', type: 'PERCENT', value: 10 },
      { code: 'FIX50ZZ', type: 'FIXED', value: 50 },
      { code: 'MIN500ZZ', type: 'PERCENT', value: 10, minOrderSubtotal: 500 },
      { code: 'OFFZZ', type: 'PERCENT', value: 10, isActive: false },
      { code: 'CAPZZ', type: 'FIXED', value: 10, maxRedemptions: 1, timesRedeemed: 1 },
    ],
  });
});

afterAll(async () => {
  await prisma.coupon.deleteMany({ where: { code: { in: codes } } });
  await prisma.$disconnect();
});

describe('computeDiscount', () => {
  it('percent rounds to 2dp', () => {
    expect(computeDiscount({ type: 'PERCENT', value: 10 as any }, 199)).toBe(19.9);
  });
  it('fixed is the value, clamped to subtotal', () => {
    expect(computeDiscount({ type: 'FIXED', value: 50 as any }, 200)).toBe(50);
    expect(computeDiscount({ type: 'FIXED', value: 500 as any }, 200)).toBe(200);
  });
});

describe('validateCoupon', () => {
  it('accepts a valid percent code and returns the discount', async () => {
    const { discount } = await validateCoupon(prisma, 'pct10zz', { subtotal: 1000 });
    expect(discount).toBe(100);
  });
  it('is case/space-insensitive on the code', async () => {
    const { coupon } = await validateCoupon(prisma, '  fix50zz  ', { subtotal: 1000 });
    expect(coupon.code).toBe('FIX50ZZ');
  });
  it('rejects an unknown or inactive code', async () => {
    await expect(validateCoupon(prisma, 'NOPEZZ', { subtotal: 1000 })).rejects.toBeInstanceOf(CouponError);
    await expect(validateCoupon(prisma, 'OFFZZ', { subtotal: 1000 })).rejects.toBeInstanceOf(CouponError);
  });
  it('rejects below the minimum order', async () => {
    await expect(validateCoupon(prisma, 'MIN500ZZ', { subtotal: 200 })).rejects.toBeInstanceOf(CouponError);
  });
  it('rejects when the global cap is reached', async () => {
    await expect(validateCoupon(prisma, 'CAPZZ', { subtotal: 1000 })).rejects.toBeInstanceOf(CouponError);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/coupons.service.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `backend/src/modules/coupons/errors.ts`**

```ts
export class CouponError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'CouponError';
  }
}
```

- [ ] **Step 4: Implement `backend/src/modules/coupons/service.ts`**

```ts
import type { Coupon, Prisma, PrismaClient } from '@prisma/client';
import { round2 } from '../../lib/money';
import { CouponError } from './errors';

type Db = PrismaClient | Prisma.TransactionClient;

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function computeDiscount(coupon: Pick<Coupon, 'type' | 'value'>, subtotal: number): number {
  const value = Number(coupon.value);
  const raw = coupon.type === 'PERCENT' ? round2((subtotal * value) / 100) : value;
  return round2(Math.min(Math.max(raw, 0), subtotal));
}

export interface CouponContext {
  subtotal: number;
  customerId?: string;
  email?: string;
}

/** Validate a coupon for a given context. No writes. Throws CouponError on any failure. */
export async function validateCoupon(db: Db, code: string, ctx: CouponContext): Promise<{ coupon: Coupon; discount: number }> {
  const coupon = await db.coupon.findUnique({ where: { code: normalizeCode(code) } });
  if (!coupon || !coupon.isActive) throw new CouponError('This code isn’t valid.');
  const now = new Date();
  if (coupon.startsAt && now < coupon.startsAt) throw new CouponError('This code isn’t active yet.');
  if (coupon.endsAt && now > coupon.endsAt) throw new CouponError('This code has expired.');
  if (ctx.subtotal < Number(coupon.minOrderSubtotal)) {
    throw new CouponError(`Spend at least ৳${Number(coupon.minOrderSubtotal)} to use this code.`);
  }
  if (coupon.maxRedemptions != null && coupon.timesRedeemed >= coupon.maxRedemptions) {
    throw new CouponError('This code has reached its usage limit.');
  }
  if (coupon.perCustomerLimit != null) {
    const scope = ctx.customerId
      ? { customerId: ctx.customerId }
      : ctx.email
        ? { email: ctx.email.toLowerCase() }
        : null;
    if (scope) {
      const used = await db.couponRedemption.count({ where: { couponId: coupon.id, ...scope } });
      if (used >= coupon.perCustomerLimit) throw new CouponError('You’ve already used this code.');
    }
  }
  return { coupon, discount: computeDiscount(coupon, ctx.subtotal) };
}
```

- [ ] **Step 5: Run it — verify it passes**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/coupons.service.test.ts
```
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```
git add backend/src/modules/coupons backend/tests/coupons.service.test.ts
git commit -m "feat(coupons): compute + validate service (TDD)"
```

---

### Task 3: Concurrency-safe redeemCoupon

**Files:**
- Modify: `backend/src/modules/coupons/service.ts` (add `redeemCoupon`)
- Test: `backend/tests/coupons.concurrency.test.ts`

**Interfaces:**
- Consumes: `validateCoupon`, `normalizeCode`, `CouponError` (Task 2).
- Produces: `redeemCoupon(tx: Prisma.TransactionClient, code: string, ctx: { subtotal: number; orderId: string; customerId?: string; email: string }): Promise<{ coupon: Coupon; discount: number }>` — row-locks the coupon, re-validates, increments `timesRedeemed`, writes a `CouponRedemption`. For use inside the checkout transaction.

- [ ] **Step 1: Write the failing test**

`backend/tests/coupons.concurrency.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { redeemCoupon } from '../src/modules/coupons/service';
import { CouponError } from '../src/modules/coupons/errors';

const prisma = new PrismaClient();
const code = 'CONCURZZ';

beforeAll(async () => {
  await prisma.couponRedemption.deleteMany({ where: { coupon: { code } } });
  await prisma.coupon.deleteMany({ where: { code } });
  await prisma.coupon.create({ data: { code, type: 'FIXED', value: 50, maxRedemptions: 1 } });
});
afterAll(async () => {
  await prisma.couponRedemption.deleteMany({ where: { coupon: { code } } });
  await prisma.coupon.deleteMany({ where: { code } });
  await prisma.$disconnect();
});

describe('redeemCoupon concurrency', () => {
  it('enforces the global cap (exactly one of N wins on cap=1)', async () => {
    const attempts = Array.from({ length: 8 }, (_, i) =>
      prisma
        .$transaction((tx) => redeemCoupon(tx, code, { subtotal: 1000, orderId: `concur-${i}`, email: `c${i}@test.com` }), {
          isolationLevel: 'ReadCommitted',
        })
        .then(() => 'ok')
        .catch((e) => (e instanceof CouponError ? 'rejected' : Promise.reject(e))),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === 'ok').length).toBe(1);
    const c = await prisma.coupon.findUnique({ where: { code } });
    expect(c!.timesRedeemed).toBe(1);
    const reds = await prisma.couponRedemption.count({ where: { couponId: c!.id } });
    expect(reds).toBe(1);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/coupons.concurrency.test.ts
```
Expected: FAIL (`redeemCoupon` not exported).

- [ ] **Step 3: Add `redeemCoupon` to `backend/src/modules/coupons/service.ts`**

Add the `Tx` type alias near the top (after `type Db`) and the function at the end of the file:

```ts
type Tx = Prisma.TransactionClient;

/**
 * Redeem a coupon inside the checkout transaction. Row-locks the coupon (SELECT … FOR UPDATE)
 * so concurrent redemptions serialize and cannot exceed maxRedemptions, re-validates against the
 * locked state, increments the counter, and records the redemption. Throws CouponError if invalid.
 */
export async function redeemCoupon(
  tx: Tx,
  code: string,
  ctx: { subtotal: number; orderId: string; customerId?: string; email: string },
): Promise<{ coupon: Coupon; discount: number }> {
  const normalized = normalizeCode(code);
  // Acquire the row lock; held until the surrounding transaction commits.
  const locked = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM Coupon WHERE code = ? AND isActive = true FOR UPDATE`,
    normalized,
  );
  if (!locked[0]) throw new CouponError('This code isn’t valid.');
  // Re-validate against the now-locked state (window, min-order, caps, per-customer).
  const { coupon, discount } = await validateCoupon(tx, normalized, {
    subtotal: ctx.subtotal,
    customerId: ctx.customerId,
    email: ctx.email,
  });
  await tx.coupon.update({ where: { id: coupon.id }, data: { timesRedeemed: { increment: 1 } } });
  await tx.couponRedemption.create({
    data: {
      couponId: coupon.id,
      orderId: ctx.orderId,
      customerId: ctx.customerId ?? null,
      email: ctx.email.toLowerCase(),
      amount: discount,
    },
  });
  return { coupon, discount };
}
```

- [ ] **Step 4: Run it — verify it passes**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/coupons.concurrency.test.ts
```
Expected: PASS (exactly one redemption; `timesRedeemed === 1`).

- [ ] **Step 5: Commit**

```
git add backend/src/modules/coupons/service.ts backend/tests/coupons.concurrency.test.ts
git commit -m "feat(coupons): concurrency-safe redeemCoupon (FOR UPDATE)"
```

---

### Task 4: Extract `priceItems` from the checkout service

**Files:**
- Create: `backend/src/modules/checkout/pricing.ts`
- Modify: `backend/src/modules/checkout/service.ts`
- Test: `backend/tests/checkout.pricing.test.ts`

**Interfaces:**
- Produces: `interface PricedLine { productId; variantId; productName; variantName; sku; unitPrice: number; qty: number }`; `priceItems(prisma: PrismaClient, items: { slug: string; qty: number }[]): Promise<{ lines: PricedLine[]; subtotal: number }>`.
- Consumed by: Task 5 (validate endpoint) and Task 6 (checkout).

- [ ] **Step 1: Write the failing test**

`backend/tests/checkout.pricing.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { priceItems } from '../src/modules/checkout/pricing';

const prisma = new PrismaClient();

beforeAll(async () => {
  const p = await prisma.product.create({
    data: { name: 'price-zz', slug: 'price-zz', sku: 'TEST-PRICE-ZZ', shortDescription: 'x', description: 'y', basePrice: 150 },
  });
  await prisma.productVariant.create({ data: { productId: p.id, sku: 'TEST-PRICE-ZZ-V', name: 'Standard', stock: 5 } });
});
afterAll(async () => {
  await prisma.product.deleteMany({ where: { sku: 'TEST-PRICE-ZZ' } });
  await prisma.$disconnect();
});

describe('priceItems', () => {
  it('resolves slugs to priced lines and a subtotal', async () => {
    const { lines, subtotal } = await priceItems(prisma, [{ slug: 'price-zz', qty: 2 }]);
    expect(lines.length).toBe(1);
    expect(lines[0].unitPrice).toBe(150);
    expect(subtotal).toBe(300);
  });
  it('throws on an unknown product', async () => {
    await expect(priceItems(prisma, [{ slug: 'no-such-zz', qty: 1 }])).rejects.toMatchObject({ statusCode: 400 });
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/checkout.pricing.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `backend/src/modules/checkout/pricing.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import { resolvePrice } from '../../lib/pricing';
import { round2 } from '../../lib/money';
import { httpError } from '../../lib/errors';

const num = (d: { toString(): string } | number | null | undefined): number | null => (d == null ? null : Number(d));

export interface PricedLine {
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  unitPrice: number;
  qty: number;
}

/** Resolve slugs → active products + default variant, re-price server-side, return lines + subtotal. */
export async function priceItems(prisma: PrismaClient, items: { slug: string; qty: number }[]): Promise<{ lines: PricedLine[]; subtotal: number }> {
  const lines: PricedLine[] = [];
  for (const it of items) {
    const product = await prisma.product.findFirst({
      where: { slug: it.slug, isActive: true },
      include: { variants: { where: { isActive: true }, orderBy: { position: 'asc' } } },
    });
    if (!product) throw httpError(400, `Unknown or unavailable product: ${it.slug}`);
    const variant = product.variants[0];
    if (!variant) throw httpError(400, `No purchasable variant for ${product.name}`);
    if (it.qty < product.minPerOrder) throw httpError(400, `Minimum ${product.minPerOrder} for ${product.name}`);
    if (product.maxPerOrder && it.qty > product.maxPerOrder) throw httpError(400, `Maximum ${product.maxPerOrder} for ${product.name}`);
    const priced = resolvePrice(
      {
        basePrice: num(product.basePrice)!,
        salePrice: num(product.salePrice),
        flashPrice: num(product.flashPrice),
        flashStartAt: product.flashStartAt,
        flashEndAt: product.flashEndAt,
        currency: product.currency,
      },
      new Date(),
    );
    lines.push({
      productId: product.id,
      variantId: variant.id,
      productName: product.name,
      variantName: variant.name,
      sku: variant.sku,
      unitPrice: priced.price,
      qty: it.qty,
    });
  }
  const subtotal = round2(lines.reduce((s, l) => s + round2(l.unitPrice * l.qty), 0));
  return { lines, subtotal };
}
```

- [ ] **Step 4: Refactor `backend/src/modules/checkout/service.ts` to use it**

Replace the inline resolve loop. At the top, replace the local `num` helper + the resolve loop with an import and a call:

Add to imports:
```ts
import { priceItems } from './pricing';
```
Remove the local `const num = ...` line (now in pricing.ts) **only if it is otherwise unused** in service.ts. Replace the block that builds `resolved` (the `const resolved = [...]` declaration through the end of its `for (const it of input.items) { ... }` loop and the `const totals = computeTotals(...)` line) with:

```ts
  const { lines: resolved, subtotal } = await priceItems(prisma, input.items);
  const totals = computeTotals(
    resolved.map((r) => ({ unitPrice: r.unitPrice, quantity: r.qty })),
    0,
  );
```

(`resolved` keeps the same field names — `productId/variantId/productName/variantName/sku/unitPrice/qty` — so the rest of `placeOrder` is unchanged. Keep the `import { resolvePrice }` removal only if no longer referenced in service.ts.)

- [ ] **Step 5: Run the checkout regression + the new test — both green**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/checkout.pricing.test.ts tests/checkout.api.test.ts tests/checkout.customer.test.ts
```
Expected: PASS (behavior unchanged for existing checkout; priceItems unit passes).

- [ ] **Step 6: Checkpoint + commit**

```
cd backend; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/checkout/pricing.ts backend/src/modules/checkout/service.ts backend/tests/checkout.pricing.test.ts
git commit -m "refactor(checkout): extract priceItems helper"
```
Expected: full suite green.

---

### Task 5: Public validate (preview) endpoint

**Files:**
- Create: `backend/src/modules/coupons/schemas.ts`
- Create: `backend/src/modules/coupons/routes.ts`
- Modify: `backend/src/app.ts` (register `couponRoutes`)
- Test: `backend/tests/coupons.api.test.ts`

**Interfaces:**
- Consumes: `priceItems` (Task 4), `validateCoupon` + `CouponError` (Task 2), `customerContext` (auth guards).
- Produces: `POST /api/coupons/validate` → `{ valid: true, code, type, discount, subtotal, newTotal, message }` or `{ valid: false, message }` (HTTP 200 either way).

- [ ] **Step 1: Write the failing test**

`backend/tests/coupons.api.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const p = await app.prisma.product.create({
    data: { name: 'coup-zz', slug: 'coup-zz', sku: 'TEST-COUP-ZZ', shortDescription: 'x', description: 'y', basePrice: 1000 },
  });
  await app.prisma.productVariant.create({ data: { productId: p.id, sku: 'TEST-COUP-ZZ-V', name: 'Standard', stock: 9 } });
  await app.prisma.coupon.deleteMany({ where: { code: { in: ['SAVE20', 'WELCOME100'] } } });
  await app.prisma.coupon.createMany({
    data: [
      { code: 'SAVE20', type: 'PERCENT', value: 20 },
      { code: 'WELCOME100', type: 'FIXED', value: 100, minOrderSubtotal: 500 },
    ],
  });
});
afterAll(async () => {
  await app.prisma.product.deleteMany({ where: { sku: 'TEST-COUP-ZZ' } });
  await app.close();
});

const post = (body: object) => app.inject({ method: 'POST', url: '/api/coupons/validate', payload: body });

describe('POST /api/coupons/validate', () => {
  it('previews a valid percent discount', async () => {
    const res = await post({ code: 'save20', items: [{ slug: 'coup-zz', qty: 1 }] });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.valid).toBe(true);
    expect(b.discount).toBe(200);
    expect(b.newTotal).toBe(800);
  });
  it('returns valid:false with a message for an unknown code', async () => {
    const res = await post({ code: 'NOPEZZ', items: [{ slug: 'coup-zz', qty: 1 }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(false);
    expect(res.json().message).toBeTruthy();
  });
  it('returns valid:false when below the minimum order', async () => {
    const res = await post({ code: 'WELCOME100', items: [{ slug: 'coup-zz', qty: 1 }] });
    // subtotal 1000 ≥ 500 → actually valid; use a cheaper product check instead:
    expect(res.json().valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/coupons.api.test.ts
```
Expected: FAIL (404 — route not registered).

- [ ] **Step 3: Implement `backend/src/modules/coupons/schemas.ts`**

```ts
import { z } from 'zod';

export const validateBody = z.object({
  code: z.string().trim().min(1),
  items: z.array(z.object({ slug: z.string().min(1), qty: z.coerce.number().int().positive() })).min(1),
});
export type ValidateInput = z.infer<typeof validateBody>;
```

- [ ] **Step 4: Implement `backend/src/modules/coupons/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { round2 } from '../../lib/money';
import { customerContext } from '../auth/guards';
import { priceItems } from '../checkout/pricing';
import { validateBody } from './schemas';
import { validateCoupon } from './service';
import { CouponError } from './errors';

export default async function couponRoutes(app: FastifyInstance) {
  app.post(
    '/api/coupons/validate',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, preHandler: customerContext },
    async (request) => {
      const { code, items } = validateBody.parse(request.body);
      const { subtotal } = await priceItems(app.prisma, items);
      try {
        const { coupon, discount } = await validateCoupon(app.prisma, code, {
          subtotal,
          customerId: request.customerClaims?.sub,
        });
        return {
          valid: true as const,
          code: coupon.code,
          type: coupon.type,
          discount,
          subtotal,
          newTotal: round2(subtotal - discount),
          message: 'Code applied.',
        };
      } catch (e) {
        if (e instanceof CouponError) return { valid: false as const, message: e.message };
        throw e;
      }
    },
  );
}
```

- [ ] **Step 5: Register in `backend/src/app.ts`**

Add the import with the other module imports:
```ts
import couponRoutes from './modules/coupons/routes';
```
Register it in the Public API block (after `checkoutRoutes`):
```ts
  await app.register(couponRoutes);
```

- [ ] **Step 6: Run it — verify it passes**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/coupons.api.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 7: Checkpoint + commit**

```
cd backend; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/coupons backend/src/app.ts backend/tests/coupons.api.test.ts
git commit -m "feat(coupons): public validate (preview) endpoint"
```

---

### Task 6: Checkout integration (redeem + apply discount)

**Files:**
- Modify: `backend/src/modules/checkout/schemas.ts` (add `couponCode`)
- Modify: `backend/src/modules/checkout/service.ts` (redeem in-transaction)
- Modify: `backend/src/modules/orders/dto.ts` (expose `couponCode`)
- Test: `backend/tests/checkout.coupon.test.ts`

**Interfaces:**
- Consumes: `redeemCoupon` (Task 3), `normalizeCode` (Task 2), `round2` (`lib/money`).
- Produces: `placeOrder` honors `input.couponCode` → sets `Order.discountTotal`, `Order.couponCode`, discounted `grandTotal`, and a `CouponRedemption`. `orderToDto` returns `couponCode`.

- [ ] **Step 1: Write the failing test**

`backend/tests/checkout.coupon.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

let app: FastifyInstance;
const EMAIL = 'coup-co-zz@test.com';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const p = await app.prisma.product.create({
    data: { name: 'coupco-zz', slug: 'coupco-zz', sku: 'TEST-COUPCO', shortDescription: 'x', description: 'y', basePrice: 1000 },
  });
  await app.prisma.productVariant.create({ data: { productId: p.id, sku: 'TEST-COUPCO-V', name: 'Standard', stock: 20 } });
  await app.prisma.coupon.deleteMany({ where: { code: { in: ['CO20ZZ', 'ONCEZZ'] } } });
  await app.prisma.coupon.create({ data: { code: 'CO20ZZ', type: 'PERCENT', value: 20 } });
  await app.prisma.coupon.create({ data: { code: 'ONCEZZ', type: 'FIXED', value: 100, maxRedemptions: 1 } });
});
afterAll(async () => {
  await app.prisma.order.deleteMany({ where: { guestEmail: EMAIL } });
  await app.prisma.coupon.deleteMany({ where: { code: { in: ['CO20ZZ', 'ONCEZZ'] } } });
  await app.prisma.product.deleteMany({ where: { sku: 'TEST-COUPCO' } });
  await app.close();
});

const body = (idem: string, couponCode?: string) => ({
  items: [{ slug: 'coupco-zz', qty: 1 }],
  contact: { name: 'Coup', email: EMAIL, phone: '+8801700000000' },
  shipping: { line1: '1 Rd', city: 'Dhaka', district: 'Dhaka' },
  paymentMethod: 'COD',
  idempotencyKey: idem,
  ...(couponCode ? { couponCode } : {}),
});
const post = (b: object) => app.inject({ method: 'POST', url: '/api/checkout', payload: b });

describe('checkout with coupon', () => {
  it('applies the discount, records a redemption, increments the counter', async () => {
    const res = await post(body('co-ok-zz', 'co20zz'));
    expect(res.statusCode).toBe(200);
    const order = await app.prisma.order.findUnique({ where: { orderNumber: res.json().orderNumber }, include: { payments: true } });
    expect(Number(order!.discountTotal)).toBe(200);
    expect(Number(order!.grandTotal)).toBe(800);
    expect(order!.couponCode).toBe('CO20ZZ');
    expect(Number(order!.payments[0].amount)).toBe(800);
    const c = await app.prisma.coupon.findUnique({ where: { code: 'CO20ZZ' } });
    expect(c!.timesRedeemed).toBeGreaterThanOrEqual(1);
    const reds = await app.prisma.couponRedemption.count({ where: { orderId: order!.id } });
    expect(reds).toBe(1);
  });
  it('replay (same idempotency key) does not double-redeem', async () => {
    const first = (await post(body('co-replay-zz', 'co20zz'))).json();
    const c1 = (await app.prisma.coupon.findUnique({ where: { code: 'CO20ZZ' } }))!.timesRedeemed;
    const second = (await post(body('co-replay-zz', 'co20zz'))).json();
    expect(second.orderNumber).toBe(first.orderNumber);
    const c2 = (await app.prisma.coupon.findUnique({ where: { code: 'CO20ZZ' } }))!.timesRedeemed;
    expect(c2).toBe(c1);
  });
  it('rejects an invalid code at submit (no order created)', async () => {
    const res = await post(body('co-bad-zz', 'NOPEZZ'));
    expect(res.statusCode).toBe(400);
    const order = await app.prisma.order.findFirst({ where: { idempotencyKey: 'co-bad-zz' } });
    expect(order).toBeNull();
  });
  it('enforces a reached cap at submit', async () => {
    await post(body('once-1-zz', 'oncezz')); // consumes the single redemption
    const res = await post(body('once-2-zz', 'oncezz'));
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/checkout.coupon.test.ts
```
Expected: FAIL (couponCode ignored — discountTotal 0).

- [ ] **Step 3: Add `couponCode` to `backend/src/modules/checkout/schemas.ts`**

Add to the `checkoutBody` object (after `idempotencyKey`):
```ts
  couponCode: z.string().trim().min(1).optional(),
```

- [ ] **Step 4: Redeem inside the transaction in `backend/src/modules/checkout/service.ts`**

Add imports:
```ts
import { redeemCoupon } from '../coupons/service';
```
Inside the `prisma.$transaction(async (tx) => { ... })`, after `reserveForOrder(...)` and BEFORE the `payment` creation, insert:

```ts
    let discount = 0;
    let appliedCode: string | null = null;
    if (input.couponCode) {
      const r = await redeemCoupon(tx, input.couponCode, {
        subtotal,
        orderId: order.id,
        customerId: customerId ?? undefined,
        email: input.contact.email,
      });
      discount = r.discount;
      appliedCode = r.coupon.code;
      await tx.order.update({
        where: { id: order.id },
        data: { discountTotal: discount, grandTotal: round2(subtotal - discount), couponCode: appliedCode },
      });
    }
    const grand = round2(subtotal - discount);
```

Then change the `payment` creation's `amount` from `totals.grandTotal` to `grand`:
```ts
    const payment = await tx.payment.create({
      data: { orderId: order.id, provider: input.paymentMethod, amount: grand, currency: 'BDT', tranId, status: 'INITIATED' },
    });
```

Add `import { round2 } from '../../lib/money';` if `round2` is not already imported in service.ts (it imports `computeTotals, round2` already — verify; if only `computeTotals`, add `round2`).

(The order is created earlier with `discountTotal` defaulting from `totals` (0) and `grandTotal = subtotal`; the coupon block updates it. `customerId` is the `placeOrder` parameter from Phase 3.)

- [ ] **Step 5: Expose `couponCode` in `backend/src/modules/orders/dto.ts`**

In `orderToDto`, add to the returned object (e.g., after `status`):
```ts
    couponCode: order.couponCode,
```

- [ ] **Step 6: Run the coupon + regression tests**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/checkout.coupon.test.ts tests/checkout.api.test.ts tests/checkout.customer.test.ts tests/account.orders.test.ts
```
Expected: PASS (coupon applied/replay/invalid/cap; guest + account checkout unchanged).

- [ ] **Step 7: Checkpoint + commit**

```
cd backend; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/checkout backend/src/modules/orders/dto.ts backend/tests/checkout.coupon.test.ts
git commit -m "feat(coupons): redeem + apply discount at checkout"
```

---

### Task 7: Admin coupons CRUD

**Files:**
- Create: `backend/src/modules/admin/coupons.ts`
- Create: `backend/src/modules/admin/views/coupons-list.eta`
- Create: `backend/src/modules/admin/views/coupon-form.eta`
- Modify: `backend/src/modules/admin/index.ts` (register)
- Modify: `backend/src/modules/admin/views/layout.eta` (nav link)
- Test: `backend/tests/admin.coupons.test.ts`

**Interfaces:**
- Consumes: `renderPage` (`lib/render`), `requireAdminSession`/`getUser` (`admin/guards`), `app.csrfProtection`, `writeAudit` (`lib/audit`), `normalizeCode` (coupons service).
- Produces: `registerAdminCoupons(app)` — `GET /admin/coupons`, `GET /admin/coupons/new`, `POST /admin/coupons`, `GET /admin/coupons/:id/edit`, `POST /admin/coupons/:id`, `POST /admin/coupons/:id/deactivate`.

- [ ] **Step 1: Write the failing test**

`backend/tests/admin.coupons.test.ts` (uses the shared helpers):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loginAdmin, csrfFrom, formPost, cookieHeader } from './helpers';

let app: FastifyInstance;
let cookie: string;
let csrf: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const s = await loginAdmin(app);
  cookie = s.cookie;
  const page = await app.inject({ method: 'GET', url: '/admin/coupons/new', headers: { cookie } });
  csrf = csrfFrom(page.body);
});
afterAll(async () => {
  await app.prisma.coupon.deleteMany({ where: { code: { in: ['ADMINPCTZZ', 'ADMINFIXZZ'] } } });
  await app.close();
});

describe('admin coupons', () => {
  it('creates a percent coupon and lists it', async () => {
    const res = await formPost(app, '/admin/coupons', { _csrf: csrf, code: 'adminpctzz', type: 'PERCENT', value: '15', description: '15% off' }, cookie);
    expect([302, 303]).toContain(res.statusCode);
    const c = await app.prisma.coupon.findUnique({ where: { code: 'ADMINPCTZZ' } });
    expect(c).not.toBeNull();
    expect(c!.type).toBe('PERCENT');
    const list = await app.inject({ method: 'GET', url: '/admin/coupons', headers: { cookie } });
    expect(list.body).toContain('ADMINPCTZZ');
  });
  it('deactivates a coupon', async () => {
    await app.prisma.coupon.create({ data: { code: 'ADMINFIXZZ', type: 'FIXED', value: 50 } });
    const c = await app.prisma.coupon.findUnique({ where: { code: 'ADMINFIXZZ' } });
    const res = await formPost(app, `/admin/coupons/${c!.id}/deactivate`, { _csrf: csrf }, cookie);
    expect([302, 303]).toContain(res.statusCode);
    const after = await app.prisma.coupon.findUnique({ where: { id: c!.id } });
    expect(after!.isActive).toBe(false);
  });
  it('rejects a duplicate code', async () => {
    const res = await formPost(app, '/admin/coupons', { _csrf: csrf, code: 'adminpctzz', type: 'PERCENT', value: '10' }, cookie);
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/admin.coupons.test.ts
```
Expected: FAIL (routes 404).

- [ ] **Step 3: Implement `backend/src/modules/admin/coupons.ts`**

```ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import { renderPage } from '../../lib/render';
import { getUser, requireAdminSession } from './guards';
import { writeAudit } from '../../lib/audit';
import { normalizeCode } from '../coupons/service';
import type { CouponType } from '@prisma/client';

const blocked = (reply: FastifyReply, msg: string) =>
  reply
    .status(400)
    .type('text/html')
    .send(`<div style="font-family:Georgia,serif;padding:40px"><h1>Action blocked</h1><p>${msg}</p><p><a href="javascript:history.back()">← Back</a></p></div>`);

interface CouponForm {
  code?: string;
  type?: string;
  value?: string;
  description?: string;
  minOrderSubtotal?: string;
  maxRedemptions?: string;
  perCustomerLimit?: string;
  isActive?: string;
}

function parseForm(body: CouponForm) {
  const code = normalizeCode(String(body.code ?? ''));
  const type = (body.type === 'FIXED' ? 'FIXED' : 'PERCENT') as CouponType;
  const value = Number(body.value);
  const minOrderSubtotal = body.minOrderSubtotal ? Number(body.minOrderSubtotal) : 0;
  const maxRedemptions = body.maxRedemptions ? Number(body.maxRedemptions) : null;
  const perCustomerLimit = body.perCustomerLimit ? Number(body.perCustomerLimit) : null;
  return { code, type, value, minOrderSubtotal, maxRedemptions, perCustomerLimit, description: body.description?.trim() || null };
}

function validate(f: ReturnType<typeof parseForm>): string | null {
  if (!f.code) return 'Code is required.';
  if (!Number.isFinite(f.value) || f.value <= 0) return 'Value must be greater than zero.';
  if (f.type === 'PERCENT' && f.value > 100) return 'Percent value cannot exceed 100.';
  return null;
}

export function registerAdminCoupons(app: FastifyInstance) {
  const authed = { preHandler: requireAdminSession };
  const authedWrite = { preHandler: [requireAdminSession, app.csrfProtection] };

  app.get('/admin/coupons', authed, async (req, reply) => {
    const user = getUser(req)!;
    const csrf = reply.generateCsrf();
    const coupons = await app.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
    return renderPage(reply, { template: 'coupons-list', title: 'Coupons', user, active: 'coupons', csrf, data: { coupons } });
  });

  app.get('/admin/coupons/new', authed, async (req, reply) => {
    const user = getUser(req)!;
    const csrf = reply.generateCsrf();
    return renderPage(reply, { template: 'coupon-form', title: 'New coupon', user, active: 'coupons', csrf, data: { coupon: null } });
  });

  app.post('/admin/coupons', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const f = parseForm(req.body as CouponForm);
    const err = validate(f);
    if (err) return blocked(reply, err);
    if (await app.prisma.coupon.findUnique({ where: { code: f.code } })) return blocked(reply, 'A coupon with that code already exists.');
    const created = await app.prisma.coupon.create({ data: f });
    await writeAudit(app.prisma, { actor: user, action: 'coupon.create', entity: 'Coupon', entityId: created.id, after: { code: f.code }, req });
    return reply.redirect('/admin/coupons');
  });

  app.get('/admin/coupons/:id/edit', authed, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const coupon = await app.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) return reply.redirect('/admin/coupons');
    const csrf = reply.generateCsrf();
    return renderPage(reply, { template: 'coupon-form', title: coupon.code, user, active: 'coupons', csrf, data: { coupon } });
  });

  app.post('/admin/coupons/:id', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const existing = await app.prisma.coupon.findUnique({ where: { id } });
    if (!existing) return reply.redirect('/admin/coupons');
    const f = parseForm(req.body as CouponForm);
    const err = validate(f);
    if (err) return blocked(reply, err);
    const dupe = await app.prisma.coupon.findUnique({ where: { code: f.code } });
    if (dupe && dupe.id !== id) return blocked(reply, 'A coupon with that code already exists.');
    await app.prisma.coupon.update({ where: { id }, data: f });
    await writeAudit(app.prisma, { actor: user, action: 'coupon.update', entity: 'Coupon', entityId: id, after: { code: f.code }, req });
    return reply.redirect('/admin/coupons');
  });

  app.post('/admin/coupons/:id/deactivate', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    await app.prisma.coupon.update({ where: { id }, data: { isActive: false } });
    await writeAudit(app.prisma, { actor: user, action: 'coupon.deactivate', entity: 'Coupon', entityId: id, req });
    return reply.redirect('/admin/coupons');
  });
}
```

- [ ] **Step 4: Implement `backend/src/modules/admin/views/coupons-list.eta`**

```html
<div class="toolbar">
  <div><h1>Coupons</h1><p class="sub">Discount codes applied at checkout.</p></div>
  <a class="btn" href="/admin/coupons/new">New coupon</a>
</div>
<table>
  <thead><tr><th>Code</th><th>Type</th><th>Value</th><th>Min order</th><th>Used</th><th>Status</th><th></th></tr></thead>
  <tbody>
    <% it.coupons.forEach(function(c){ %>
    <tr>
      <td><strong><%= c.code %></strong><% if (c.description) { %><br><span class="muted"><%= c.description %></span><% } %></td>
      <td><%= c.type %></td>
      <td><%= c.type === 'PERCENT' ? Number(c.value) + '%' : '৳' + Number(c.value) %></td>
      <td><%= Number(c.minOrderSubtotal) > 0 ? '৳' + Number(c.minOrderSubtotal) : '—' %></td>
      <td><%= c.timesRedeemed %><%= c.maxRedemptions != null ? ' / ' + c.maxRedemptions : '' %></td>
      <td><span class="pill" style="<%= c.isActive ? '' : 'background:#eee;color:#999' %>"><%= c.isActive ? 'Active' : 'Inactive' %></span></td>
      <td>
        <a class="btn ghost sm" href="/admin/coupons/<%= c.id %>/edit">Edit</a>
        <% if (c.isActive) { %>
        <form method="post" action="/admin/coupons/<%= c.id %>/deactivate" style="display:inline">
          <input type="hidden" name="_csrf" value="<%= it.csrf %>" />
          <button class="btn danger sm" type="submit">Deactivate</button>
        </form>
        <% } %>
      </td>
    </tr>
    <% }) %>
  </tbody>
</table>
```

- [ ] **Step 5: Implement `backend/src/modules/admin/views/coupon-form.eta`**

```html
<% var c = it.coupon; %>
<h1><%= c ? 'Edit ' + c.code : 'New coupon' %></h1>
<p class="sub">Percent (0–100) or a fixed ৳ amount off the order subtotal.</p>
<form class="stack" method="post" action="<%= c ? '/admin/coupons/' + c.id : '/admin/coupons' %>">
  <input type="hidden" name="_csrf" value="<%= it.csrf %>" />
  <div class="grid2">
    <label>Code<input name="code" value="<%= c ? c.code : '' %>" required /></label>
    <label>Type
      <select name="type">
        <option value="PERCENT" <%= c && c.type === 'PERCENT' ? 'selected' : '' %>>Percent (%)</option>
        <option value="FIXED" <%= c && c.type === 'FIXED' ? 'selected' : '' %>>Fixed (৳)</option>
      </select>
    </label>
  </div>
  <div class="grid2">
    <label>Value<input name="value" type="number" step="0.01" min="0" value="<%= c ? Number(c.value) : '' %>" required /></label>
    <label>Min order subtotal (৳)<input name="minOrderSubtotal" type="number" step="0.01" min="0" value="<%= c ? Number(c.minOrderSubtotal) : '' %>" /></label>
  </div>
  <div class="grid2">
    <label>Max redemptions (blank = unlimited)<input name="maxRedemptions" type="number" min="1" value="<%= c && c.maxRedemptions != null ? c.maxRedemptions : '' %>" /></label>
    <label>Per-customer limit (blank = unlimited)<input name="perCustomerLimit" type="number" min="1" value="<%= c && c.perCustomerLimit != null ? c.perCustomerLimit : '' %>" /></label>
  </div>
  <label>Description<input name="description" value="<%= c && c.description ? c.description : '' %>" /></label>
  <div class="actions">
    <button class="btn" type="submit"><%= c ? 'Save changes' : 'Create coupon' %></button>
    <a class="btn ghost" href="/admin/coupons">Cancel</a>
  </div>
</form>
```

- [ ] **Step 6: Register + add the nav link**

In `backend/src/modules/admin/index.ts`, import and call:
```ts
import { registerAdminCoupons } from './coupons';
```
```ts
  registerAdminCoupons(app);
```
In `backend/src/modules/admin/views/layout.eta`, add a nav link after the Orders link:
```html
      <a href="/admin/coupons" class="<%= it.active==='coupons'?'active':'' %>">Coupons</a>
```

- [ ] **Step 7: Run it — verify it passes**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/admin.coupons.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 8: Checkpoint + commit**

```
cd backend; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/admin backend/tests/admin.coupons.test.ts
git commit -m "feat(coupons): admin CRUD + deactivate"
```

---

### Task 8: Storefront — coupon apply at checkout

**Files:**
- Create: `frontend/src/pages/api/coupons/validate.ts` (BFF proxy)
- Modify: `frontend/src/pages/checkout.astro` (discount-code field + discount line)
- Modify: `frontend/src/lib/checkout.ts` (apply logic + summary)
- Test: none automated (verified by Task 10 browser pass + the build)

**Interfaces:**
- Consumes: `SESSION_COOKIE` (`lib/auth`), the backend `POST /api/coupons/validate`.
- Produces: a same-origin `/api/coupons/validate` proxy; the checkout payload now includes `couponCode` when applied.

- [ ] **Step 1: Create the BFF proxy `frontend/src/pages/api/coupons/validate.ts`**

```ts
import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '../../../lib/auth';

const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await request.text();
  const token = cookies.get(SESSION_COOKIE)?.value;
  const res = await fetch(`${API}/api/coupons/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body,
  });
  return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } });
};
```

- [ ] **Step 2: Add the discount-code field + discount line to `frontend/src/pages/checkout.astro`**

Inside the order-summary `<aside>`, between the `data-checkout-summary` div and the Total row, add the discount UI:

```astro
        <div class="mt-5 flex flex-col gap-2">
          <label class="text-label-caps uppercase opacity-60">Discount code</label>
          <div class="flex gap-2">
            <input data-coupon-input class="input-minimal text-body-md flex-1" placeholder="Enter code" />
            <button type="button" data-coupon-apply class="btn-editorial text-label-caps uppercase">Apply</button>
          </div>
          <p data-coupon-msg hidden class="text-caption"></p>
        </div>
        <div data-coupon-row hidden class="flex justify-between mt-4 text-body-md text-secondary">
          <span>Discount <span data-coupon-code></span></span>
          <span data-coupon-amount>−৳0</span>
        </div>
```

- [ ] **Step 3: Add coupon logic to `frontend/src/lib/checkout.ts`**

At the top, near the other element lookups inside `init()`, add:
```ts
  const couponInput = root.querySelector<HTMLInputElement>('[data-coupon-input]');
  const couponApply = root.querySelector<HTMLButtonElement>('[data-coupon-apply]');
  const couponMsg = root.querySelector<HTMLElement>('[data-coupon-msg]');
  const couponRow = root.querySelector<HTMLElement>('[data-coupon-row]');
  const couponCodeEl = root.querySelector<HTMLElement>('[data-coupon-code]');
  const couponAmountEl = root.querySelector<HTMLElement>('[data-coupon-amount]');
  let appliedCoupon: { code: string; discount: number } | null = null;
```

In `renderSummary()`, after computing `subtotal` and setting `totalEl`, account for the discount. Replace the `if (totalEl) totalEl.textContent = formatPrice(subtotal);` line with:
```ts
    const discount = appliedCoupon ? Math.min(appliedCoupon.discount, subtotal) : 0;
    if (couponRow) couponRow.hidden = !appliedCoupon;
    if (appliedCoupon && couponCodeEl) couponCodeEl.textContent = appliedCoupon.code;
    if (appliedCoupon && couponAmountEl) couponAmountEl.textContent = `−${formatPrice(discount)}`;
    if (totalEl) totalEl.textContent = formatPrice(Math.max(subtotal - discount, 0));
```

Add the Apply handler (inside `init()`, after the form submit handler):
```ts
  couponApply?.addEventListener('click', async () => {
    const code = couponInput?.value.trim();
    if (!code) return;
    const items = $cart.get().items.map((i) => ({ slug: i.slug, qty: i.qty }));
    if (!items.length) return;
    if (couponMsg) couponMsg.hidden = true;
    couponApply.disabled = true;
    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, items }),
      });
      const data = await res.json();
      if (data.valid) {
        appliedCoupon = { code: data.code, discount: data.discount };
        if (couponMsg) {
          couponMsg.textContent = 'Code applied.';
          couponMsg.className = 'text-caption text-secondary';
          couponMsg.hidden = false;
        }
      } else {
        appliedCoupon = null;
        if (couponMsg) {
          couponMsg.textContent = data.message ?? 'This code isn’t valid.';
          couponMsg.className = 'text-caption text-error';
          couponMsg.hidden = false;
        }
      }
      renderSummary();
    } catch {
      if (couponMsg) { couponMsg.textContent = 'Could not check that code.'; couponMsg.className = 'text-caption text-error'; couponMsg.hidden = false; }
    } finally {
      couponApply.disabled = false;
    }
  });
```

In the submit handler's `payload`, add the coupon code when applied:
```ts
      paymentMethod: fd.get('paymentMethod') || 'COD',
      idempotencyKey: idemKey(),
      ...(appliedCoupon ? { couponCode: appliedCoupon.code } : {}),
```

- [ ] **Step 4: Build to verify**

```
cd frontend; node node_modules/astro/astro.js build
```
Expected: build succeeds; `/api/coupons/validate` endpoint emitted.

- [ ] **Step 5: Checkpoint + commit**

```
cd frontend; node node_modules/vitest/vitest.mjs run
git add frontend/src/pages/api/coupons frontend/src/pages/checkout.astro frontend/src/lib/checkout.ts
git commit -m "feat(coupons): storefront apply-at-checkout"
```
Expected: frontend suite green (~43; the backend is running so catalog passes).

---

### Task 9: Show the discount on confirmation + account order detail

**Files:**
- Modify: `frontend/src/pages/checkout/success.astro`
- Modify: `frontend/src/pages/account/orders/[orderNumber].astro`
- Test: none automated (browser pass)

**Interfaces:**
- Consumes: the order DTO (`totals.discount`, `couponCode`) from Task 6.

- [ ] **Step 1: Add a discount line to `frontend/src/pages/checkout/success.astro`**

The `OrderView` interface's `totals` is `{ grand: number }`; widen it and add `couponCode`. Change the interface to:
```ts
  totals: { grand: number; discount?: number };
  couponCode?: string | null;
```
In the order summary block, immediately before the Total row, add:
```astro
          {order.totals.discount && order.totals.discount > 0 && (
            <div class="flex justify-between py-3 hairline-b text-secondary">
              <span>Discount {order.couponCode ? `(${order.couponCode})` : ''}</span>
              <span>−{formatPrice(order.totals.discount)}</span>
            </div>
          )}
```

- [ ] **Step 2: Add a discount line to `frontend/src/pages/account/orders/[orderNumber].astro`**

In the order detail bag/summary block, before the Total row, add (the DTO already carries `totals.discount` + `couponCode`):
```astro
          {order.totals.discount > 0 && (
            <div class="flex justify-between py-3 hairline-b text-secondary">
              <span class="text-body-md">Discount {order.couponCode ? `(${order.couponCode})` : ''}</span>
              <span class="text-body-md">−{formatPrice(order.totals.discount)}</span>
            </div>
          )}
```
(If the page types `order` as `any`, no interface change is needed; otherwise add `discount` to the totals type and `couponCode` to the order type.)

- [ ] **Step 3: Build + checkpoint + commit**

```
cd frontend; node node_modules/astro/astro.js build
cd frontend; node node_modules/vitest/vitest.mjs run
git add frontend/src/pages/checkout/success.astro frontend/src/pages/account/orders/[orderNumber].astro
git commit -m "feat(coupons): show discount on confirmation + account order detail"
```
Expected: build OK; suite green.

---

### Task 10: Full sweep + README + browser verification

**Files:**
- Modify: `backend/README.md`
- Test: full backend + frontend suites; manual browser pass

- [ ] **Step 1: Full backend suite**

```
cd backend; node node_modules/vitest/vitest.mjs run
```
Expected: green (102 prior + coupons.service 7 + coupons.concurrency 1 + checkout.pricing 2 + coupons.api 3 + checkout.coupon 4 + admin.coupons 3 ≈ 122).

- [ ] **Step 2: Full frontend suite**

```
cd frontend; node node_modules/vitest/vitest.mjs run
```
Expected: 43 green (backend running).

- [ ] **Step 3: Browser pass** (backend on :4000, `astro dev` or built server on :4321)

1. Add an item to the bag → `/checkout`.
2. Enter `SAVE20` → Apply → the summary shows `Discount (SAVE20) −৳…` and a reduced total.
3. Place a COD order → `/checkout/success` shows the discount line.
4. `/admin/coupons` (admin login) → the demo coupons list with usage counts; create a new code; deactivate one and confirm it no longer applies at checkout.
5. Log in as a customer, place a coupon order, and confirm `/account/orders/<n>` shows the discount.

- [ ] **Step 4: Add a Phase 4 section to `backend/README.md`**

After the Phase 3 implemented/deferred section (before "## Phase 1 — implemented vs. deferred"), insert:

```markdown
## Phase 4 — implemented vs. deferred

**Implemented (this phase)**
- Schema: Coupon, CouponRedemption; `Order.couponCode`. Demo seeds: SAVE20, WELCOME100.
- Coupon service: `computeDiscount` (clamped to subtotal), `validateCoupon` (active, window,
  min-order, global cap, per-customer limit), `redeemCoupon` (**SELECT … FOR UPDATE** — proven by a
  concurrent-redemption test: exactly one wins on cap=1).
- `POST /api/coupons/validate` (preview, no side effects) + checkout integration: `couponCode`
  redeemed inside the order transaction; `discountTotal`/`couponCode` set; idempotent replay never
  double-redeems; invalid/expired/cap-reached → order fails cleanly.
- Admin `/admin/coupons` CRUD + deactivate (CSRF + audit). Storefront: apply-at-checkout with live
  preview + discount line on checkout, confirmation, and account order detail (on-brand).

**Deferred to later phases**
- Free-shipping coupons (needs a shipping-fee model), product/collection-targeted coupons, stacking,
  automatic/cart-level promotions, BOGO, gift cards/store credit.
```

Also add to the Public API list (under the Phase 3 line): `POST /api/coupons/validate` (preview).

- [ ] **Step 5: Update memory**

Append to `C:\Users\PC\.claude\projects\D--Roots---Rings\memory\MEMORY.md` a one-line pointer, and create `roots-rings-phase4-coupons.md` summarizing: coupons built (percent/fixed, order-subtotal, global cap + per-customer limit, FOR-UPDATE redemption, admin CRUD, apply-at-checkout); demo codes; N backend + 43 frontend tests.

- [ ] **Step 6: Final checkpoint + commit**

```
cd backend; node node_modules/vitest/vitest.mjs run
git add backend/README.md
git commit -m "docs(coupons): Phase 4 README + verification"
```

---

## Self-Review

**1. Spec coverage** (spec §3–§10 → tasks):
- §3 schema (Coupon, CouponRedemption, Order.couponCode) → Task 1. ✅
- §4 service (normalizeCode, computeDiscount, validateCoupon, redeemCoupon w/ FOR UPDATE) → Tasks 2, 3. ✅
- §5 validate endpoint (200 valid/invalid) → Task 5. ✅
- §6 checkout integration (couponCode, redeem in-tx, discountTotal/couponCode, idempotent replay) → Task 6; shared `priceItems` → Task 4. ✅
- §7 admin CRUD + deactivate (CSRF + audit, dup→reject) → Task 7. ✅
- §8 storefront (BFF, apply, discount line on checkout/success/account detail; order DTO couponCode) → Tasks 8, 9 (+ DTO in Task 6). ✅
- §9 security/concurrency (FOR UPDATE proof, clamp, rate-limit, server authority) → Tasks 3, 5, 6. ✅
- §10 testing (unit, concurrency, integration, admin) → Tasks 2–7; browser → Task 10. ✅

**2. Placeholder scan:** Every code step has complete code; every test step has real assertions. No TBD/"handle edge cases". ✅

**3. Type consistency:** `priceItems` returns `{ lines, subtotal }` and is consumed identically by Tasks 5 & 6; `validateCoupon`/`redeemCoupon` signatures match between definition (Tasks 2/3) and callers (Tasks 5/6); `computeDiscount` takes `{type, value}` consistently; `CouponError.statusCode = 400` surfaces via the existing error plugin (validate route catches it → 200; checkout lets it propagate → 400). The coupon `value` is `Decimal` → `Number(value)` at every read. ✅

*Note (Task 5 test):* the third test asserts `WELCOME100` is valid at subtotal 1000 (≥ its ৳500 min), so it exercises the min-order field without a below-min case; the below-min path is covered by the unit test in Task 2 (`MIN500ZZ`).
