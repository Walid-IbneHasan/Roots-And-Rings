# Roots & Rings Phase 5 — Reviews & Ratings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add purchase-gated product reviews (1–5 stars + title + body, auto-published with admin take-down) and a denormalized rating shown on the product page and product cards.

**Architecture:** A new backend `reviews/` module (eligibility + aggregate + upsert) gated server-side on a `DELIVERED` order; ratings are denormalized onto `Product` (`ratingAvg`/`ratingCount`) and recomputed on every change. Customer submit/can-review live in the account module behind the existing BFF proxy; the public list + ratings ride the existing catalog DTO. Admin moderation hides/deletes.

**Tech Stack:** Fastify 5, Prisma + MySQL 8, zod, sanitize-html, Vitest + Fastify `.inject()` (backend); Astro 5 SSR (frontend). No new dependencies.

## Global Constraints

- **Git:** work on branch `phase-5-reviews` (already created). Each task ends with a real commit (Conventional Commit; end the body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).
- **Ampersand-path gotcha:** project is in `D:\Roots & Rings`; `&` breaks npm scripts. Call node entrypoints directly (`node node_modules/vitest/vitest.mjs run`, `node node_modules/prisma/build/index.js ...`). Never `npm run`.
- **Backend tests need the DB:** `docker compose up -d db` (repo root) must be healthy.
- **TDD, DRY, YAGNI.** Failing test → watch fail → implement → watch pass.
- **Money/decimals:** use `Number(decimal)` in DTOs. `ratingAvg` is `Decimal(3,2)`.
- **Purchase gate is server-authoritative:** `upsertReview` re-checks `canReview`; the storefront form is only a convenience.
- **Reviews are sanitized:** body via the existing `sanitizeRichText` (`lib/sanitize`); title is plain text (trim).
- **Status semantics:** a review is `PUBLISHED` on submit; admins set `HIDDEN` (toggle) or delete. `HIDDEN` reviews never appear in the public list or the aggregate.
- **Do not change the storefront's visual design.** Reuse existing tokens/classes only.
- **Plan strings contain curly apostrophes (’ U+2019)** — valid JS/HTML characters; transcribe verbatim, do not convert to straight quotes.
- Backend single-file test: `cd backend; node node_modules/vitest/vitest.mjs run tests/<file>`. Full backend: `cd backend; node node_modules/vitest/vitest.mjs run`. Frontend: `cd frontend; node node_modules/vitest/vitest.mjs run`.
- A known occasionally-flaky `uploads` timeout test is unrelated; if only that times out, re-run once.

---

### Task 1: Schema + migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Test: none (infra; verified by migrate + generate + the suite staying green)

**Interfaces:**
- Produces: `Review` model + `ReviewStatus { PUBLISHED HIDDEN }` enum; `Product.ratingAvg`/`ratingCount` + `Product.reviews`; `Customer.reviews`.

- [ ] **Step 1: Add the enum + Review model to `backend/prisma/schema.prisma`**

Append:

```prisma
enum ReviewStatus {
  PUBLISHED
  HIDDEN
}

model Review {
  id         String       @id @default(cuid())
  productId  String
  product    Product      @relation(fields: [productId], references: [id], onDelete: Cascade)
  customerId String
  customer   Customer     @relation(fields: [customerId], references: [id], onDelete: Cascade)
  rating     Int
  title      String?
  body       String?      @db.Text
  authorName String
  status     ReviewStatus @default(PUBLISHED)
  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt

  @@unique([productId, customerId])
  @@index([productId, status])
  @@index([customerId])
}
```

- [ ] **Step 2: Add the rating fields + back-relation to `Product`**

In the `Product` model, add (near the other relations like `variants`/`images`):

```prisma
  ratingAvg   Decimal?         @db.Decimal(3, 2)
  ratingCount Int              @default(0)
  reviews     Review[]
```

- [ ] **Step 3: Add the back-relation to `Customer`**

In the `Customer` model, add (next to `otps`/`addresses`):

```prisma
  reviews   Review[]
```

- [ ] **Step 4: Migrate + generate**

```
cd backend
node node_modules/prisma/build/index.js migrate dev --name phase5_reviews
node node_modules/prisma/build/index.js generate
```
Expected: additive migration — CREATE TABLE Review (+ FKs to Product & Customer) + ALTER TABLE Product ADD ratingAvg, ratingCount. It must NOT drop `Product_name_shortDescription_idx` or any table. If it proposes a destructive change, STOP and report BLOCKED.

- [ ] **Step 5: Checkpoint — full backend suite still green**

```
cd backend; node node_modules/vitest/vitest.mjs run
```
Expected: 122 passing (no regressions).

- [ ] **Step 6: Commit**

```
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(reviews): schema + migration"
```

---

### Task 2: Reviews service (eligibility, aggregate, upsert)

**Files:**
- Create: `backend/src/modules/reviews/errors.ts`
- Create: `backend/src/modules/reviews/service.ts`
- Test: `backend/tests/reviews.service.test.ts`

**Interfaces:**
- Produces: `class ReviewError extends Error { statusCode: number }`; `canReview(db, customerId, productId): Promise<boolean>`; `recomputeProductRating(db, productId): Promise<void>`; `interface ReviewInput { rating: number; title?: string; body?: string }`; `upsertReview(db, customerId, productId, authorName, input): Promise<Review>`.

- [ ] **Step 1: Write the failing test**

`backend/tests/reviews.service.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { canReview, recomputeProductRating, upsertReview } from '../src/modules/reviews/service';
import { ReviewError } from '../src/modules/reviews/errors';
import { hashPassword } from '../src/lib/password';

const prisma = new PrismaClient();
let productId = '';
let buyerId = '';
let strangerId = '';

async function makeOrder(customerId: string, status: 'DELIVERED' | 'PROCESSING', pid: string) {
  await prisma.order.create({
    data: {
      orderNumber: `RR-REV-${status}-${customerId.slice(-4)}`, customerId, guestEmail: 'x@x.com', guestPhone: '0',
      status, currency: 'BDT', subtotal: 100, shippingTotal: 0, discountTotal: 0, taxTotal: 0, grandTotal: 100,
      idempotencyKey: `rev-idem-${status}-${customerId}`, orderToken: `rev-tok-${status}-${customerId}`,
      shippingSnapshot: { line1: 'x', city: 'Dhaka', district: 'Dhaka' },
      items: { create: [{ productId: pid, variantId: 'v', productName: 'P', variantName: 'Standard', sku: 'S', unitPrice: 100, quantity: 1, lineTotal: 100 }] },
    },
  });
}

beforeAll(async () => {
  const p = await prisma.product.create({ data: { name: 'rev-zz', slug: 'rev-zz', sku: 'TEST-REV-ZZ', shortDescription: 'x', description: 'y', basePrice: 100 } });
  productId = p.id;
  const buyer = await prisma.customer.create({ data: { email: 'rev-buyer-zz@test.com', name: 'Buyer Zee', passwordHash: await hashPassword('x12345678') } });
  const stranger = await prisma.customer.create({ data: { email: 'rev-stranger-zz@test.com', name: 'Stranger', passwordHash: await hashPassword('x12345678') } });
  buyerId = buyer.id; strangerId = stranger.id;
  await makeOrder(buyerId, 'DELIVERED', productId);
  await makeOrder(strangerId, 'PROCESSING', productId);
});

afterAll(async () => {
  await prisma.review.deleteMany({ where: { productId } });
  await prisma.order.deleteMany({ where: { idempotencyKey: { startsWith: 'rev-idem-' } } });
  await prisma.product.deleteMany({ where: { sku: 'TEST-REV-ZZ' } });
  await prisma.customer.deleteMany({ where: { email: { in: ['rev-buyer-zz@test.com', 'rev-stranger-zz@test.com'] } } });
  await prisma.$disconnect();
});

describe('canReview', () => {
  it('is true for a delivered-order buyer', async () => {
    expect(await canReview(prisma, buyerId, productId)).toBe(true);
  });
  it('is false when the order is not delivered', async () => {
    expect(await canReview(prisma, strangerId, productId)).toBe(false);
  });
  it('is false for a customer with no order', async () => {
    const c = await prisma.customer.create({ data: { email: 'rev-none-zz@test.com', name: 'None', passwordHash: await hashPassword('x12345678') } });
    expect(await canReview(prisma, c.id, productId)).toBe(false);
    await prisma.customer.delete({ where: { id: c.id } });
  });
});

describe('upsertReview + recompute', () => {
  it('creates a review, blocks the ineligible, edits on re-submit, and updates the aggregate', async () => {
    await expect(upsertReview(prisma, strangerId, productId, 'Stranger', { rating: 5 })).rejects.toBeInstanceOf(ReviewError);

    const r1 = await upsertReview(prisma, buyerId, productId, 'Buyer Zee', { rating: 4, title: 'Lovely', body: 'Great bowl' });
    expect(r1.status).toBe('PUBLISHED');
    let p = await prisma.product.findUnique({ where: { id: productId } });
    expect(p!.ratingCount).toBe(1);
    expect(Number(p!.ratingAvg)).toBe(4);

    // re-submit edits (no duplicate)
    await upsertReview(prisma, buyerId, productId, 'Buyer Zee', { rating: 2 });
    const count = await prisma.review.count({ where: { productId, customerId: buyerId } });
    expect(count).toBe(1);
    p = await prisma.product.findUnique({ where: { id: productId } });
    expect(Number(p!.ratingAvg)).toBe(2);

    // hide → aggregate drops
    await prisma.review.updateMany({ where: { productId, customerId: buyerId }, data: { status: 'HIDDEN' } });
    await recomputeProductRating(prisma, productId);
    p = await prisma.product.findUnique({ where: { id: productId } });
    expect(p!.ratingCount).toBe(0);
    expect(p!.ratingAvg).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/reviews.service.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `backend/src/modules/reviews/errors.ts`**

```ts
export class ReviewError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'ReviewError';
  }
}
```

- [ ] **Step 4: Implement `backend/src/modules/reviews/service.ts`**

```ts
import type { Prisma, PrismaClient, Review } from '@prisma/client';
import { sanitizeRichText } from '../../lib/sanitize';
import { ReviewError } from './errors';

type Db = PrismaClient | Prisma.TransactionClient;

/** True iff the customer has this product in a DELIVERED order of theirs. */
export async function canReview(db: Db, customerId: string, productId: string): Promise<boolean> {
  const item = await db.orderItem.findFirst({
    where: { productId, order: { customerId, status: 'DELIVERED' } },
    select: { id: true },
  });
  return item != null;
}

/** Recompute the denormalized rating from PUBLISHED reviews. */
export async function recomputeProductRating(db: Db, productId: string): Promise<void> {
  const agg = await db.review.aggregate({
    where: { productId, status: 'PUBLISHED' },
    _avg: { rating: true },
    _count: true,
  });
  const count = agg._count;
  const avg = count > 0 && agg._avg.rating != null ? Math.round(agg._avg.rating * 100) / 100 : null;
  await db.product.update({ where: { id: productId }, data: { ratingAvg: avg, ratingCount: count } });
}

export interface ReviewInput {
  rating: number;
  title?: string;
  body?: string;
}

/** Purchase-gated upsert (one review per product+customer). Re-publishes + recomputes the aggregate. */
export async function upsertReview(db: Db, customerId: string, productId: string, authorName: string, input: ReviewInput): Promise<Review> {
  if (!(await canReview(db, customerId, productId))) {
    throw new ReviewError(403, 'You can review this once your order has been delivered.');
  }
  const body = input.body ? sanitizeRichText(input.body) : null;
  const title = input.title?.trim() || null;
  const review = await db.review.upsert({
    where: { productId_customerId: { productId, customerId } },
    update: { rating: input.rating, title, body, authorName, status: 'PUBLISHED' },
    create: { productId, customerId, rating: input.rating, title, body, authorName, status: 'PUBLISHED' },
  });
  await recomputeProductRating(db, productId);
  return review;
}
```

- [ ] **Step 5: Run it — verify it passes**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/reviews.service.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add backend/src/modules/reviews backend/tests/reviews.service.test.ts
git commit -m "feat(reviews): eligibility + aggregate + upsert service (TDD)"
```

---

### Task 3: Public reviews list + ratings in the product DTO

**Files:**
- Create: `backend/src/modules/reviews/schemas.ts`
- Create: `backend/src/modules/reviews/routes.ts`
- Modify: `backend/src/lib/mappers.ts` (add ratings to `ProductDTO`)
- Modify: `backend/src/app.ts` (register `reviewRoutes`)
- Test: `backend/tests/reviews.api.test.ts`

**Interfaces:**
- Consumes: Prisma `review`/`product`.
- Produces: `GET /api/products/:slug/reviews` → `{ items: [{ id, rating, title, body, authorName, createdAt }], total, ratingAvg, ratingCount }`; `ProductDTO` gains `ratingAvg: number | null` + `ratingCount: number`.

- [ ] **Step 1: Write the failing test**

`backend/tests/reviews.api.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/lib/password';

let app: FastifyInstance;
let productId = '';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const p = await app.prisma.product.create({ data: { name: 'revapi-zz', slug: 'revapi-zz', sku: 'TEST-REVAPI', shortDescription: 'x', description: 'y', basePrice: 100, ratingAvg: 5, ratingCount: 1 } });
  productId = p.id;
  const c = await app.prisma.customer.create({ data: { email: 'revapi-zz@test.com', name: 'Rev Api', passwordHash: await hashPassword('x12345678') } });
  await app.prisma.review.create({ data: { productId, customerId: c.id, rating: 5, title: 'Shown', body: 'Visible review', authorName: 'Rev Api', status: 'PUBLISHED' } });
  const c2 = await app.prisma.customer.create({ data: { email: 'revapi2-zz@test.com', name: 'Hidden Guy', passwordHash: await hashPassword('x12345678') } });
  await app.prisma.review.create({ data: { productId, customerId: c2.id, rating: 1, title: 'Hidden', body: 'Hidden review', authorName: 'Hidden Guy', status: 'HIDDEN' } });
});
afterAll(async () => {
  await app.prisma.review.deleteMany({ where: { productId } });
  await app.prisma.product.deleteMany({ where: { sku: 'TEST-REVAPI' } });
  await app.prisma.customer.deleteMany({ where: { email: { in: ['revapi-zz@test.com', 'revapi2-zz@test.com'] } } });
  await app.close();
});

describe('public reviews', () => {
  it('lists only PUBLISHED reviews with the aggregate', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/products/revapi-zz/reviews' });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.items.length).toBe(1);
    expect(b.items[0].title).toBe('Shown');
    expect(b.total).toBe(1);
    expect(b.ratingCount).toBe(1);
    expect(b.ratingAvg).toBe(5);
  });
  it('exposes ratingAvg/ratingCount on the product DTO', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/products/revapi-zz' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ratingCount).toBe(1);
    expect(res.json().ratingAvg).toBe(5);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/reviews.api.test.ts
```
Expected: FAIL (404 on the reviews route; product DTO lacks ratingCount).

- [ ] **Step 3: Add ratings to `ProductDTO` in `backend/src/lib/mappers.ts`**

In the `ProductDTO` interface, add (after `publishedAt`):
```ts
  ratingAvg: number | null;
  ratingCount: number;
```
In the `mapProduct` return object, add (after `publishedAt`):
```ts
    ratingAvg: num(p.ratingAvg),
    ratingCount: p.ratingCount,
```

- [ ] **Step 4: Implement `backend/src/modules/reviews/schemas.ts`**

```ts
import { z } from 'zod';

export const reviewsQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(20),
});

export const reviewBody = z.object({
  productSlug: z.string().min(1),
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().max(4000).optional(),
});
export type ReviewBodyInput = z.infer<typeof reviewBody>;
```

- [ ] **Step 5: Implement `backend/src/modules/reviews/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { reviewsQuery } from './schemas';

export default async function reviewRoutes(app: FastifyInstance) {
  app.get('/api/products/:slug/reviews', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const { page, pageSize } = reviewsQuery.parse(request.query);
    const product = await app.prisma.product.findUnique({ where: { slug }, select: { id: true, ratingAvg: true, ratingCount: true } });
    if (!product) return reply.status(404).send({ error: 'NotFound', message: 'Product not found', statusCode: 404 });
    const where = { productId: product.id, status: 'PUBLISHED' as const };
    const [items, total] = await Promise.all([
      app.prisma.review.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      app.prisma.review.count({ where }),
    ]);
    return {
      items: items.map((r) => ({ id: r.id, rating: r.rating, title: r.title, body: r.body, authorName: r.authorName, createdAt: r.createdAt.toISOString() })),
      total,
      ratingAvg: product.ratingAvg != null ? Number(product.ratingAvg) : null,
      ratingCount: product.ratingCount,
    };
  });
}
```

- [ ] **Step 6: Register in `backend/src/app.ts`**

Add the import with the other module imports:
```ts
import reviewRoutes from './modules/reviews/routes';
```
Register in the Public API block (after `catalogRoutes`):
```ts
  await app.register(reviewRoutes);
```

- [ ] **Step 7: Run it — verify it passes**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/reviews.api.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 8: Checkpoint + commit**

```
cd backend; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/reviews backend/src/lib/mappers.ts backend/src/app.ts backend/tests/reviews.api.test.ts
git commit -m "feat(reviews): public list endpoint + ratings in product DTO"
```

---

### Task 4: Account review endpoints + order-item slug

**Files:**
- Modify: `backend/src/modules/account/routes.ts` (add submit + can-review; enrich order-detail items with `slug`)
- Test: `backend/tests/account.reviews.test.ts`

**Interfaces:**
- Consumes: `upsertReview`, `canReview` (Task 2), `reviewBody` (Task 3 schemas), `requireCustomer`.
- Produces: `POST /api/account/reviews`, `GET /api/account/reviews/can-review?slug=`; the account order-detail item DTO gains `slug` (string | null).

- [ ] **Step 1: Write the failing test**

`backend/tests/account.reviews.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { signCustomerToken } from '../src/lib/jwt';
import { hashPassword } from '../src/lib/password';

let app: FastifyInstance;
let buyerToken = '';
let strangerToken = '';

async function deliveredOrder(customerId: string, productId: string) {
  await app.prisma.order.create({
    data: {
      orderNumber: `RR-AREV-${customerId.slice(-4)}`, customerId, guestEmail: 'x@x.com', guestPhone: '0',
      status: 'DELIVERED', currency: 'BDT', subtotal: 100, shippingTotal: 0, discountTotal: 0, taxTotal: 0, grandTotal: 100,
      idempotencyKey: `arev-idem-${customerId}`, orderToken: `arev-tok-${customerId}`,
      shippingSnapshot: { line1: 'x', city: 'Dhaka', district: 'Dhaka' },
      items: { create: [{ productId, variantId: 'v', productName: 'P', variantName: 'Standard', sku: 'S', unitPrice: 100, quantity: 1, lineTotal: 100 }] },
    },
  });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const p = await app.prisma.product.create({ data: { name: 'arev-zz', slug: 'arev-zz', sku: 'TEST-AREV', shortDescription: 'x', description: 'y', basePrice: 100 } });
  const buyer = await app.prisma.customer.create({ data: { email: 'arev-buyer-zz@test.com', name: 'A Buyer', passwordHash: await hashPassword('x12345678') } });
  const stranger = await app.prisma.customer.create({ data: { email: 'arev-stranger-zz@test.com', name: 'A Stranger', passwordHash: await hashPassword('x12345678') } });
  buyerToken = signCustomerToken(buyer);
  strangerToken = signCustomerToken(stranger);
  await deliveredOrder(buyer.id, p.id);
});
afterAll(async () => {
  await app.prisma.review.deleteMany({ where: { product: { sku: 'TEST-AREV' } } });
  await app.prisma.order.deleteMany({ where: { idempotencyKey: { startsWith: 'arev-idem-' } } });
  await app.prisma.product.deleteMany({ where: { sku: 'TEST-AREV' } });
  await app.prisma.customer.deleteMany({ where: { email: { in: ['arev-buyer-zz@test.com', 'arev-stranger-zz@test.com'] } } });
  await app.close();
});

const post = (body: object, token: string) => app.inject({ method: 'POST', url: '/api/account/reviews', headers: { authorization: `Bearer ${token}` }, payload: body });

describe('account reviews', () => {
  it('eligible buyer submits a review', async () => {
    const res = await post({ productSlug: 'arev-zz', rating: 5, title: 'Great', body: 'Loved it' }, buyerToken);
    expect(res.statusCode).toBe(201);
    expect(res.json().review.rating).toBe(5);
    const p = await app.prisma.product.findUnique({ where: { slug: 'arev-zz' } });
    expect(p!.ratingCount).toBe(1);
  });
  it('re-submit edits, not duplicates', async () => {
    await post({ productSlug: 'arev-zz', rating: 3 }, buyerToken);
    const count = await app.prisma.review.count({ where: { product: { slug: 'arev-zz' } } });
    expect(count).toBe(1);
  });
  it('ineligible customer is blocked (403)', async () => {
    const res = await post({ productSlug: 'arev-zz', rating: 5 }, strangerToken);
    expect(res.statusCode).toBe(403);
  });
  it('rejects a bad rating (400)', async () => {
    expect((await post({ productSlug: 'arev-zz', rating: 6 }, buyerToken)).statusCode).toBe(400);
    expect((await post({ productSlug: 'arev-zz', rating: 0 }, buyerToken)).statusCode).toBe(400);
  });
  it('can-review reflects eligibility + the existing review', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/account/reviews/can-review?slug=arev-zz', headers: { authorization: `Bearer ${buyerToken}` } });
    expect(ok.json().eligible).toBe(true);
    expect(ok.json().review.rating).toBe(3);
    const no = await app.inject({ method: 'GET', url: '/api/account/reviews/can-review?slug=arev-zz', headers: { authorization: `Bearer ${strangerToken}` } });
    expect(no.json().eligible).toBe(false);
  });
  it('order-detail items expose a slug for the review link', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/account/orders/RR-AREV-${(await app.prisma.customer.findUnique({ where: { email: 'arev-buyer-zz@test.com' } }))!.id.slice(-4)}`, headers: { authorization: `Bearer ${buyerToken}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0].slug).toBe('arev-zz');
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/account.reviews.test.ts
```
Expected: FAIL (404 on review routes; item has no slug).

- [ ] **Step 3: Add imports to `backend/src/modules/account/routes.ts`**

Add to the imports at the top:
```ts
import { upsertReview, canReview } from '../reviews/service';
import { reviewBody } from '../reviews/schemas';
```

- [ ] **Step 4: Enrich the order-detail items with `slug`**

Replace the existing `GET /api/account/orders/:orderNumber` handler body (the `return orderToDto(order);` line) so it attaches a product slug to each item:

```ts
  app.get('/api/account/orders/:orderNumber', { preHandler: requireCustomer }, async (request) => {
    const { orderNumber } = request.params as { orderNumber: string };
    const order = await app.prisma.order.findFirst({
      where: { orderNumber, customerId: request.customer!.id },
      include: { items: true, payments: true, shipment: true },
    });
    if (!order) throw httpError(404, 'Order not found');
    const dto = orderToDto(order);
    const ids = [...new Set(order.items.map((i) => i.productId).filter((x): x is string => !!x))];
    const products = ids.length ? await app.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, slug: true } }) : [];
    const slugById = new Map(products.map((p) => [p.id, p.slug]));
    const items = dto.items.map((it, idx) => ({ ...it, slug: order.items[idx].productId ? slugById.get(order.items[idx].productId!) ?? null : null }));
    return { ...dto, items };
  });
```

- [ ] **Step 5: Add the review endpoints**

Add these routes inside `accountRoutes` (e.g., after the order routes):

```ts
  app.post('/api/account/reviews', { preHandler: requireCustomer }, async (request, reply) => {
    const { productSlug, rating, title, body } = reviewBody.parse(request.body);
    const product = await app.prisma.product.findUnique({ where: { slug: productSlug }, select: { id: true } });
    if (!product) throw httpError(404, 'Product not found');
    const review = await upsertReview(app.prisma, request.customer!.id, product.id, request.customer!.name, { rating, title, body });
    return reply.status(201).send({ review: { id: review.id, rating: review.rating, title: review.title, body: review.body, status: review.status } });
  });

  app.get('/api/account/reviews/can-review', { preHandler: requireCustomer }, async (request) => {
    const { slug } = request.query as { slug?: string };
    if (!slug) throw httpError(400, 'slug is required');
    const product = await app.prisma.product.findUnique({ where: { slug }, select: { id: true } });
    if (!product) return { eligible: false, review: null };
    const eligible = await canReview(app.prisma, request.customer!.id, product.id);
    const existing = await app.prisma.review.findUnique({ where: { productId_customerId: { productId: product.id, customerId: request.customer!.id } } });
    return { eligible, review: existing ? { rating: existing.rating, title: existing.title, body: existing.body } : null };
  });
```

(Note: `ReviewError` thrown by `upsertReview` carries `statusCode` so the existing error plugin returns it as 403; the route doesn't need to catch it.)

- [ ] **Step 6: Run it — verify it passes**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/account.reviews.test.ts tests/account.orders.test.ts
```
Expected: PASS (account reviews + the existing account-orders regression both green).

- [ ] **Step 7: Checkpoint + commit**

```
cd backend; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/account/routes.ts backend/tests/account.reviews.test.ts
git commit -m "feat(reviews): account submit + can-review + order-item slug"
```

---

### Task 5: Admin reviews moderation

**Files:**
- Create: `backend/src/modules/admin/reviews.ts`
- Create: `backend/src/modules/admin/views/reviews-list.eta`
- Modify: `backend/src/modules/admin/index.ts` (register)
- Modify: `backend/src/modules/admin/views/layout.eta` (nav link)
- Test: `backend/tests/admin.reviews.test.ts`

**Interfaces:**
- Consumes: `renderPage`, `requireAdminSession`/`getUser`, `app.csrfProtection`, `writeAudit`, `recomputeProductRating` (reviews service).
- Produces: `registerAdminReviews(app)` — `GET /admin/reviews`, `POST /admin/reviews/:id/hide`, `POST /admin/reviews/:id/unhide`, `POST /admin/reviews/:id/delete`.

- [ ] **Step 1: Write the failing test**

`backend/tests/admin.reviews.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loginAdmin, csrfFrom, formPost } from './helpers';
import { hashPassword } from '../src/lib/password';

let app: FastifyInstance;
let cookie: string;
let csrf: string;
let reviewId = '';
let productId = '';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  cookie = await loginAdmin(app);
  csrf = await csrfFrom(app, '/admin/reviews', cookie);
  const p = await app.prisma.product.create({ data: { name: 'mrev-zz', slug: 'mrev-zz', sku: 'TEST-MREV', shortDescription: 'x', description: 'y', basePrice: 100, ratingAvg: 5, ratingCount: 1 } });
  productId = p.id;
  const c = await app.prisma.customer.create({ data: { email: 'mrev-zz@test.com', name: 'M Rev', passwordHash: await hashPassword('x12345678') } });
  const r = await app.prisma.review.create({ data: { productId, customerId: c.id, rating: 5, title: 'Mod me', authorName: 'M Rev', status: 'PUBLISHED' } });
  reviewId = r.id;
});
afterAll(async () => {
  await app.prisma.review.deleteMany({ where: { productId } });
  await app.prisma.product.deleteMany({ where: { sku: 'TEST-MREV' } });
  await app.prisma.customer.deleteMany({ where: { email: 'mrev-zz@test.com' } });
  await app.close();
});

describe('admin reviews', () => {
  it('lists reviews', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/reviews', headers: { cookie } });
    expect(res.body).toContain('Mod me');
  });
  it('hides a review and recomputes the aggregate', async () => {
    const res = await formPost(app, `/admin/reviews/${reviewId}/hide`, { _csrf: csrf }, cookie);
    expect([302, 303]).toContain(res.statusCode);
    const r = await app.prisma.review.findUnique({ where: { id: reviewId } });
    expect(r!.status).toBe('HIDDEN');
    const p = await app.prisma.product.findUnique({ where: { id: productId } });
    expect(p!.ratingCount).toBe(0);
  });
  it('unhides it', async () => {
    await formPost(app, `/admin/reviews/${reviewId}/unhide`, { _csrf: csrf }, cookie);
    const p = await app.prisma.product.findUnique({ where: { id: productId } });
    expect(p!.ratingCount).toBe(1);
  });
  it('deletes it and recomputes', async () => {
    const res = await formPost(app, `/admin/reviews/${reviewId}/delete`, { _csrf: csrf }, cookie);
    expect([302, 303]).toContain(res.statusCode);
    expect(await app.prisma.review.findUnique({ where: { id: reviewId } })).toBeNull();
    const p = await app.prisma.product.findUnique({ where: { id: productId } });
    expect(p!.ratingCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/admin.reviews.test.ts
```
Expected: FAIL (routes 404).

- [ ] **Step 3: Implement `backend/src/modules/admin/reviews.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { renderPage } from '../../lib/render';
import { getUser, requireAdminSession } from './guards';
import { writeAudit } from '../../lib/audit';
import { recomputeProductRating } from '../reviews/service';

export function registerAdminReviews(app: FastifyInstance) {
  const authed = { preHandler: requireAdminSession };
  const authedWrite = { preHandler: [requireAdminSession, app.csrfProtection] };

  app.get('/admin/reviews', authed, async (req, reply) => {
    const user = getUser(req)!;
    const csrf = reply.generateCsrf();
    const { status } = req.query as { status?: string };
    const where = status === 'HIDDEN' || status === 'PUBLISHED' ? { status } : {};
    const reviews = await app.prisma.review.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { product: { select: { name: true, slug: true } } },
    });
    return renderPage(reply, { template: 'reviews-list', title: 'Reviews', user, active: 'reviews', csrf, data: { reviews, status: status ?? '' } });
  });

  async function setStatus(id: string, status: 'PUBLISHED' | 'HIDDEN') {
    const review = await app.prisma.review.update({ where: { id }, data: { status } });
    await recomputeProductRating(app.prisma, review.productId);
    return review;
  }

  app.post('/admin/reviews/:id/hide', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const r = await setStatus(id, 'HIDDEN');
    await writeAudit(app.prisma, { actor: user, action: 'review.hide', entity: 'Review', entityId: id, after: { productId: r.productId }, req });
    return reply.redirect('/admin/reviews');
  });

  app.post('/admin/reviews/:id/unhide', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const r = await setStatus(id, 'PUBLISHED');
    await writeAudit(app.prisma, { actor: user, action: 'review.unhide', entity: 'Review', entityId: id, after: { productId: r.productId }, req });
    return reply.redirect('/admin/reviews');
  });

  app.post('/admin/reviews/:id/delete', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const existing = await app.prisma.review.findUnique({ where: { id } });
    if (!existing) return reply.redirect('/admin/reviews');
    await app.prisma.review.delete({ where: { id } });
    await recomputeProductRating(app.prisma, existing.productId);
    await writeAudit(app.prisma, { actor: user, action: 'review.delete', entity: 'Review', entityId: id, req });
    return reply.redirect('/admin/reviews');
  });
}
```

- [ ] **Step 4: Implement `backend/src/modules/admin/views/reviews-list.eta`**

```html
<div class="toolbar">
  <div><h1>Reviews</h1><p class="sub">Customer reviews. Hide takes one off the storefront + the rating.</p></div>
</div>
<table>
  <thead><tr><th>Product</th><th>Rating</th><th>Review</th><th>Author</th><th>Status</th><th></th></tr></thead>
  <tbody>
    <% it.reviews.forEach(function(r){ %>
    <tr>
      <td><a href="/admin/products" class="muted"><%= r.product.name %></a></td>
      <td><%= '★'.repeat(r.rating) %><span class="muted"><%= '☆'.repeat(5 - r.rating) %></span></td>
      <td><% if (r.title) { %><strong><%= r.title %></strong><br><% } %><span class="muted"><%= (r.body || '').replace(/<[^>]*>/g, '').slice(0, 120) %></span></td>
      <td><%= r.authorName %></td>
      <td><span class="pill" style="<%= r.status === 'PUBLISHED' ? '' : 'background:#eee;color:#999' %>"><%= r.status %></span></td>
      <td>
        <% if (r.status === 'PUBLISHED') { %>
        <form method="post" action="/admin/reviews/<%= r.id %>/hide" style="display:inline"><input type="hidden" name="_csrf" value="<%= it.csrf %>" /><button class="btn ghost sm" type="submit">Hide</button></form>
        <% } else { %>
        <form method="post" action="/admin/reviews/<%= r.id %>/unhide" style="display:inline"><input type="hidden" name="_csrf" value="<%= it.csrf %>" /><button class="btn ghost sm" type="submit">Unhide</button></form>
        <% } %>
        <form method="post" action="/admin/reviews/<%= r.id %>/delete" style="display:inline"><input type="hidden" name="_csrf" value="<%= it.csrf %>" /><button class="btn danger sm" type="submit">Delete</button></form>
      </td>
    </tr>
    <% }) %>
  </tbody>
</table>
```

- [ ] **Step 5: Register + nav link**

In `backend/src/modules/admin/index.ts`:
```ts
import { registerAdminReviews } from './reviews';
```
```ts
  registerAdminReviews(app);
```
In `backend/src/modules/admin/views/layout.eta`, add after the Coupons link:
```html
      <a href="/admin/reviews" class="<%= it.active==='reviews'?'active':'' %>">Reviews</a>
```

- [ ] **Step 6: Run it — verify it passes**

```
cd backend; node node_modules/vitest/vitest.mjs run tests/admin.reviews.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 7: Checkpoint + commit**

```
cd backend; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/admin backend/tests/admin.reviews.test.ts
git commit -m "feat(reviews): admin moderation (hide/unhide/delete)"
```

---

### Task 6: Frontend product types + a Stars component + card stars

**Files:**
- Create: `frontend/src/components/product/Stars.astro`
- Modify: `frontend/src/lib/api.ts` (ratings on `ApiProduct` + `toProduct`)
- Modify: `frontend/src/lib/schema.ts` (ratings on the `Product` type)
- Modify: `frontend/src/components/product/ProductCard.astro` (show stars)
- Test: none automated (build + browser pass)

**Interfaces:**
- Produces: `Stars.astro` (props `{ value: number | null; count?: number; size?: number }`); `Product` gains `ratingAvg: number | null` + `ratingCount: number`.

- [ ] **Step 1: Create `frontend/src/components/product/Stars.astro`**

```astro
---
interface Props {
  value: number | null;
  count?: number;
  size?: 'sm' | 'md';
}
const { value, count, size = 'sm' } = Astro.props;
const v = value ?? 0;
const full = Math.round(v); // nearest whole star
const cls = size === 'sm' ? 'text-caption' : 'text-body-md';
---
{(count ?? 0) > 0 ? (
  <span class={`inline-flex items-center gap-1.5 ${cls} text-secondary`} aria-label={`Rated ${v} out of 5`}>
    <span aria-hidden="true">{'★'.repeat(full)}<span class="opacity-30">{'★'.repeat(5 - full)}</span></span>
    {count != null && <span class="opacity-60">({count})</span>}
  </span>
) : null}
```

- [ ] **Step 2: Add ratings to `frontend/src/lib/api.ts`**

In the `ApiProduct` interface, add:
```ts
  ratingAvg?: number | null;
  ratingCount?: number;
```
In the `toProduct` mapping return, add:
```ts
    ratingAvg: p.ratingAvg ?? null,
    ratingCount: p.ratingCount ?? 0,
```

- [ ] **Step 3: Add ratings to the `Product` type in `frontend/src/lib/schema.ts`**

Read the file to find the `Product` type (interface or zod schema). Add two fields: `ratingAvg: number | null` and `ratingCount: number`. If `Product` is a zod schema, add `ratingAvg: z.number().nullable()` and `ratingCount: z.number()` (and the inferred type follows); if it's a plain interface, add the two TS fields. Keep it consistent with the file's existing style.

- [ ] **Step 4: Show stars on `frontend/src/components/product/ProductCard.astro`**

Add the import:
```ts
import Stars from './Stars.astro';
```
In the `<div class="mt-5">` block, after the price `<p>`, add:
```astro
      {product.ratingCount > 0 && <div class="mt-1.5"><Stars value={product.ratingAvg} count={product.ratingCount} /></div>}
```

- [ ] **Step 5: Build + checkpoint + commit**

```
cd frontend; node node_modules/astro/astro.js build
cd frontend; node node_modules/vitest/vitest.mjs run
git add frontend/src/components/product/Stars.astro frontend/src/lib/api.ts frontend/src/lib/schema.ts frontend/src/components/product/ProductCard.astro
git commit -m "feat(reviews): product rating type + Stars component + card stars"
```
Expected: build OK; frontend suite green (~43; backend must be running for catalog tests — start it with `cd backend; node --env-file=.env --import tsx src/server.ts` if needed).

---

### Task 7: PDP reviews section + write island

**Files:**
- Create: `frontend/src/scripts/reviews.ts`
- Modify: `frontend/src/pages/objects/[slug].astro` (rating summary + reviews section + write form)
- Test: none automated (browser pass)

**Interfaces:**
- Consumes: `Stars.astro` (Task 6), `getSession` (`lib/auth`), the public `GET /api/products/:slug/reviews`, and the account `/api/account/reviews*` endpoints (via the BFF proxy).

- [ ] **Step 1: Create `frontend/src/scripts/reviews.ts`**

```ts
/** Product-page review island: checks eligibility (logged-in only) and submits the review form. */
function init(): void {
  const root = document.querySelector<HTMLElement>('[data-reviews]');
  if (!root) return;
  const slug = root.getAttribute('data-slug');
  const loggedIn = root.getAttribute('data-logged-in') === 'true';
  const formWrap = root.querySelector<HTMLElement>('[data-review-form-wrap]');
  const stateEl = root.querySelector<HTMLElement>('[data-review-state]');
  const form = root.querySelector<HTMLFormElement>('[data-review-form]');
  const errEl = root.querySelector<HTMLElement>('[data-review-error]');
  if (!slug || !loggedIn) return; // signed-out copy is rendered server-side

  fetch(`/api/account/reviews/can-review?slug=${encodeURIComponent(slug)}`)
    .then((r) => (r.ok ? r.json() : { eligible: false, review: null }))
    .then((data: { eligible: boolean; review: { rating: number; title: string | null; body: string | null } | null }) => {
      if (!data.eligible) {
        if (stateEl) { stateEl.textContent = 'You can review this once your order has been delivered.'; stateEl.hidden = false; }
        return;
      }
      if (formWrap) formWrap.hidden = false;
      if (data.review && form) {
        const r = form.querySelector<HTMLSelectElement>('[name="rating"]');
        const t = form.querySelector<HTMLInputElement>('[name="title"]');
        const b = form.querySelector<HTMLTextAreaElement>('[name="body"]');
        if (r) r.value = String(data.review.rating);
        if (t && data.review.title) t.value = data.review.title;
        if (b && data.review.body) b.value = data.review.body.replace(/<[^>]*>/g, '');
        const heading = root.querySelector<HTMLElement>('[data-review-form-heading]');
        if (heading) heading.textContent = 'Edit your review';
      }
    })
    .catch(() => {});

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (errEl) errEl.hidden = true;
    const fd = new FormData(form);
    const payload = {
      productSlug: slug,
      rating: Number(fd.get('rating')),
      title: (fd.get('title') as string) || undefined,
      body: (fd.get('body') as string) || undefined,
    };
    const submit = form.querySelector<HTMLButtonElement>('[type="submit"]');
    if (submit) { submit.disabled = true; submit.textContent = 'Submitting…'; }
    try {
      const res = await fetch('/api/account/reviews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ message: 'Could not submit your review.' }))) as { message?: string };
        throw new Error(err.message ?? 'Could not submit your review.');
      }
      window.location.reload();
    } catch (err) {
      if (errEl) { errEl.textContent = (err as Error).message; errEl.hidden = false; }
      if (submit) { submit.disabled = false; submit.textContent = 'Submit review'; }
    }
  });
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
```

- [ ] **Step 2: Add the rating summary + reviews section to `frontend/src/pages/objects/[slug].astro`**

In the frontmatter, after `const related = await getRelated(slug, 4);`, add the session + reviews fetch:
```ts
import Stars from '../../components/product/Stars.astro';
import { getSession } from '../../lib/auth';
const session = getSession(Astro);
const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';
interface ReviewItem { id: string; rating: number; title: string | null; body: string | null; authorName: string; createdAt: string }
let reviews: { items: ReviewItem[]; total: number; ratingAvg: number | null; ratingCount: number } = { items: [], total: 0, ratingAvg: null, ratingCount: 0 };
try {
  const res = await fetch(`${API}/api/products/${encodeURIComponent(slug)}/reviews`);
  if (res.ok) reviews = await res.json();
} catch { /* no reviews */ }
```

Add the rating summary under the price (after the `formatPrice(product.price)` `<p>` at line 45):
```astro
      {reviews.ratingCount > 0 && <div class="mt-2"><Stars value={reviews.ratingAvg} count={reviews.ratingCount} size="md" /></div>}
```

Add a Reviews section immediately AFTER the closing `</section>` of the main product block (the `</section>` before the `{si && (` block):
```astro
  <section id="reviews" class="wrap pb-24" data-reviews data-slug={product.slug} data-logged-in={session ? 'true' : 'false'}>
    <h2 class="font-display text-headline-md mb-2">Reviews</h2>
    {reviews.ratingCount > 0
      ? <div class="mb-8"><Stars value={reviews.ratingAvg} count={reviews.ratingCount} size="md" /></div>
      : <p class="text-body-md text-on-surface-variant mb-8">No reviews yet.</p>}

    <div class="flex flex-col gap-8 max-w-prose">
      {reviews.items.map((r) => (
        <article class="hairline-t pt-6">
          <div class="flex items-center justify-between">
            <Stars value={r.rating} count={0} />
            <span class="text-caption text-on-surface-variant">{new Date(r.createdAt).toLocaleDateString()}</span>
          </div>
          {r.title && <h3 class="font-display text-body-lg mt-2">{r.title}</h3>}
          {r.body && <div class="text-body-md text-on-surface-variant mt-1 leading-relaxed" set:html={r.body}></div>}
          <span class="text-label-caps uppercase opacity-50 mt-2 block">{r.authorName}</span>
        </article>
      ))}
    </div>

    <div class="mt-12 max-w-prose">
      {session ? (
        <>
          <p data-review-state hidden class="text-body-md text-on-surface-variant"></p>
          <div data-review-form-wrap hidden>
            <h3 class="font-display text-headline-sm mb-5" data-review-form-heading>Write a review</h3>
            <form data-review-form class="flex flex-col gap-5">
              <label class="text-label-caps uppercase opacity-60 flex flex-col gap-2">Rating
                <select name="rating" required class="input-minimal text-body-md">
                  <option value="5">★★★★★ — Excellent</option>
                  <option value="4">★★★★ — Good</option>
                  <option value="3">★★★ — Average</option>
                  <option value="2">★★ — Poor</option>
                  <option value="1">★ — Terrible</option>
                </select>
              </label>
              <label class="text-label-caps uppercase opacity-60 flex flex-col gap-2">Title<input name="title" maxlength="120" class="input-minimal text-body-md" /></label>
              <label class="text-label-caps uppercase opacity-60 flex flex-col gap-2">Your review<textarea name="body" rows="4" maxlength="4000" class="input-minimal text-body-md"></textarea></label>
              <p data-review-error hidden class="text-caption text-error border border-error px-4 py-3"></p>
              <button type="submit" class="btn-solid w-fit">Submit review</button>
            </form>
          </div>
        </>
      ) : (
        <p class="text-body-md text-on-surface-variant">
          <a href={`/account/login?next=/objects/${product.slug}`} class="btn-editorial">Sign in</a> to write a review (available after your order is delivered).
        </p>
      )}
    </div>
  </section>
  <script>
    import '../../scripts/reviews.ts';
  </script>
```

- [ ] **Step 3: Build to verify**

```
cd frontend; node node_modules/astro/astro.js build
```
Expected: build succeeds; the PDP renders the reviews section.

- [ ] **Step 4: Checkpoint + commit**

```
cd frontend; node node_modules/vitest/vitest.mjs run
git add frontend/src/scripts/reviews.ts frontend/src/pages/objects/[slug].astro
git commit -m "feat(reviews): product-page summary, list, and write form"
```
Expected: frontend suite green.

---

### Task 8: "Review this item" links on delivered account orders

**Files:**
- Modify: `frontend/src/pages/account/orders/[orderNumber].astro`
- Test: none automated (browser pass)

**Interfaces:**
- Consumes: the order-detail DTO's item `slug` (Task 4) + `order.status`.

- [ ] **Step 1: Add the review link to each delivered order line**

In `frontend/src/pages/account/orders/[orderNumber].astro`, find where each `order.items` line is rendered. Add a "Review this item" link when the order is delivered and the item has a slug. In the item row's markup, after the name/quantity, add:
```astro
              {order.status === 'DELIVERED' && i.slug && (
                <a href={`/objects/${i.slug}#reviews`} class="btn-editorial text-label-caps uppercase ml-3">Review this item</a>
              )}
```
(Match the existing item-row structure — the loop variable may be named `i`; use whatever the file uses. `order.status` and `i.slug` both come from the DTO.)

- [ ] **Step 2: Build + checkpoint + commit**

```
cd frontend; node node_modules/astro/astro.js build
cd frontend; node node_modules/vitest/vitest.mjs run
git add frontend/src/pages/account/orders/[orderNumber].astro
git commit -m "feat(reviews): review-this-item links on delivered orders"
```
Expected: build OK; suite green.

---

### Task 9: Full sweep + README + browser verification

**Files:**
- Modify: `backend/README.md`
- Test: full backend + frontend suites; manual browser pass

- [ ] **Step 1: Full backend suite**

```
cd backend; node node_modules/vitest/vitest.mjs run
```
Expected: green (122 prior + reviews.service 5 + reviews.api 2 + account.reviews 6 + admin.reviews 4 ≈ 139).

- [ ] **Step 2: Full frontend suite**

```
cd frontend; node node_modules/vitest/vitest.mjs run
```
Expected: 43 green (backend running).

- [ ] **Step 3: Browser pass** (backend on :4000, `astro dev`/built server on :4321)

1. As admin, open an order and move it to **DELIVERED** (Orders → Shipped → Delivered).
2. Sign in as that order's customer, open the product's page → the **Write a review** form appears → submit 5★ + title + body.
3. The review shows in the Reviews section + the rating summary; the product card on `/objects` shows stars.
4. `/account/orders/<n>` (delivered) shows a **Review this item** link per line → deep-links to the PDP form (pre-filled for editing).
5. As admin, `/admin/reviews` → **Hide** the review → it disappears from the PDP and the rating drops; **Unhide** restores it.

- [ ] **Step 4: Add a Phase 5 section to `backend/README.md`**

Add `GET /api/products/:slug/reviews` to the Public API list, note the account `POST /api/account/reviews` + `can-review`, and insert (before "## Phase 1 — implemented vs. deferred"):

```markdown
## Phase 5 — implemented vs. deferred

**Implemented (this phase)**
- Schema: Review (one per product+customer, PUBLISHED/HIDDEN); denormalized `Product.ratingAvg`/`ratingCount`.
- Reviews service: `canReview` (DELIVERED-order purchase gate), `recomputeProductRating`,
  `upsertReview` (gate + sanitize + recompute). Auto-publish; admin take-down.
- Public `GET /api/products/:slug/reviews` + ratings in the product DTO. Account
  `POST /api/account/reviews` + `GET /api/account/reviews/can-review` (purchase-gated server-side).
- Admin `/admin/reviews` hide/unhide/delete (recompute + CSRF + audit). Storefront: PDP rating summary +
  list + gated write form, product-card stars, "Review this item" links on delivered orders.
- Tests: 139 backend + 43 frontend.

**Deferred to later phases**
- Helpful/"was this useful" votes, photo reviews, replies/Q&A, review reminder emails, sort/filter of reviews.
```

- [ ] **Step 5: Update memory**

Create `C:\Users\PC\.claude\projects\D--Roots---Rings\memory\roots-rings-phase5-reviews.md` (purchase-gated reviews built: DELIVERED-order gate, auto-publish + admin take-down, denormalized rating, PDP + card stars; demo flow needs an order marked DELIVERED first) and add a one-line pointer in `MEMORY.md`.

- [ ] **Step 6: Final checkpoint + commit**

```
cd backend; node node_modules/vitest/vitest.mjs run
git add backend/README.md
git commit -m "docs(reviews): Phase 5 README + verification"
```

---

## Self-Review

**1. Spec coverage** (spec §3–§8 → tasks):
- §3 schema (Review, ReviewStatus, Product ratings, Customer relation) → Task 1. ✅
- §4 service (canReview, recomputeProductRating, upsertReview, ReviewError) → Task 2. ✅
- §5 public list + product DTO ratings → Task 3; account submit + can-review → Task 4; admin moderation → Task 5. ✅
- §6 storefront (PDP summary+list+form, card stars, account order links) → Tasks 6, 7, 8. ✅
- §7 security (server-side gate, sanitize body, one-per-customer unique, hidden excluded, admin CSRF+audit) → Tasks 2, 4, 5. ✅
- §8 testing (canReview, recompute, public-list PUBLISHED-only, eligible/ineligible submit, bad rating, hide-drops-aggregate, admin) → Tasks 2–5; browser → Task 9. ✅

**2. Placeholder scan:** Every code step has complete code; every test step has real assertions. The two "match the file's existing structure" notes (Task 6 Step 3 schema type, Task 8 item-row markup) are unavoidable because those files' exact shapes vary — each gives the precise fields/markup to add. No "handle edge cases"/TBD.

**3. Type consistency:** `canReview`/`recomputeProductRating`/`upsertReview` signatures match between Task 2 (definition) and Tasks 4/5 (callers). `ProductDTO.ratingAvg/ratingCount` (Task 3) match the frontend `Product`/`ApiProduct` additions (Task 6) and the `Stars` props. `reviewBody` (Task 3 schemas) is consumed by Task 4. The account order-detail item `slug` (Task 4) is consumed by Task 8. `ReviewError.statusCode` surfaces via the existing error plugin (upsert throws 403; route doesn't catch). The Prisma upsert uses the compound unique `productId_customerId` consistently. ✅
