# Roots & Rings Phase 10 — Stock-aware SEO availability + job stale-lock reclaim — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Product JSON-LD report real stock status, and add a worker sweep that reclaims jobs stranded in `PROCESSING` by a crashed worker.

**Architecture:** Part A — the backend catalog serializer computes a 3-state `availability` from variant stock + `allowBackorder` and exposes it; the frontend maps it to schema.org in the Product JSON-LD. Part B — a `reclaimStaleJobs` sweep run at the start of each worker tick. No migration, no UI change.

**Tech Stack:** Backend — Fastify 5, Prisma + MySQL 8, Vitest. Frontend — Astro 5, zod, Vitest.

## Global Constraints

- **Branch `phase-10-polish`**, normal per-task commits (Conventional Commits; end the body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).
- **Ampersand-path gotcha:** project in `D:\Roots & Rings` — `&` breaks `npm run`. Call node entrypoints directly:
  - Backend tests: `cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run [tests/<file>]`
  - Frontend build: `cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build`
  - Frontend tests: `cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run`
- **Do NOT add deps, do NOT run `astro check`.** Frontend tests live in `frontend/tests/`. The full frontend suite (51) needs a backend dev server UP (the controller keeps one running).
- **DB `rootsandrings-db` up** for backend tests.
- **No UI change** — Part A is structured-data only; checkout inventory guards untouched.
- **Availability is 3-state** (`in_stock` / `out_of_stock` / `backorder`); the stale-lock threshold default is **300000 ms (5 min)** via `JOBS_STALE_LOCK_MS`.

---

### Task 1: Part A backend — compute + expose `availability`

**Files:**
- Modify: `backend/src/lib/mappers.ts` (helper + `ProductDTO` + `mapProduct` + `ProductWithRelations`)
- Modify: `backend/src/modules/catalog/service.ts` (`include` gains `variants`)
- Test: `backend/tests/catalog.availability.test.ts`

**Interfaces:**
- Produces: `type Availability = 'in_stock' | 'out_of_stock' | 'backorder'`; `computeAvailability(variants: {isActive: boolean; stock: number}[], allowBackorder: boolean): Availability`; `ProductDTO.availability: Availability`.

- [ ] **Step 1: Write the failing test — `backend/tests/catalog.availability.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { computeAvailability } from '../src/lib/mappers';

describe('computeAvailability', () => {
  it('in_stock when an active variant has stock', () => {
    expect(computeAvailability([{ isActive: true, stock: 3 }], false)).toBe('in_stock');
  });
  it('backorder when no stock but allowBackorder', () => {
    expect(computeAvailability([{ isActive: true, stock: 0 }], true)).toBe('backorder');
  });
  it('out_of_stock when no stock and no backorder', () => {
    expect(computeAvailability([{ isActive: true, stock: 0 }], false)).toBe('out_of_stock');
  });
  it('ignores inactive variants that have stock', () => {
    expect(computeAvailability([{ isActive: false, stock: 5 }], false)).toBe('out_of_stock');
  });
  it('out_of_stock for a product with no variants and no backorder', () => {
    expect(computeAvailability([], false)).toBe('out_of_stock');
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/catalog.availability.test.ts
```
Expected: FAIL (`computeAvailability` not exported).

- [ ] **Step 3: Add the helper + field in `backend/src/lib/mappers.ts`**

Add this exported type + helper near the top (after the `num`/`absUrl` helpers):
```ts
export type Availability = 'in_stock' | 'out_of_stock' | 'backorder';

/** Product-level availability from active-variant stock + backorder policy. */
export function computeAvailability(
  variants: { isActive: boolean; stock: number }[],
  allowBackorder: boolean,
): Availability {
  const inStock = variants.some((v) => v.isActive && v.stock > 0);
  if (inStock) return 'in_stock';
  return allowBackorder ? 'backorder' : 'out_of_stock';
}
```
Add the field to the `ProductDTO` interface (after `ratingCount: number;`):
```ts
  availability: Availability;
```
Add `variants: true` to the `ProductWithRelations` include type:
```ts
type ProductWithRelations = Prisma.ProductGetPayload<{
  include: { category: true; images: true; collections: true; variants: true };
}>;
```
In the `mapProduct` return object, add (after `ratingCount: p.ratingCount,`):
```ts
    availability: computeAvailability(p.variants, p.allowBackorder),
```

- [ ] **Step 4: Include variants in the catalog query — `backend/src/modules/catalog/service.ts`**

Change the `include` const (currently `{ category: true, images: true, collections: true }`) to:
```ts
const include = { category: true, images: true, collections: true, variants: true } satisfies Prisma.ProductInclude;
```

- [ ] **Step 5: Run the test + a catalog regression**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/catalog.availability.test.ts tests/catalog.api.test.ts
```
Expected: PASS (availability 5; the catalog API tests still pass — they don't assert on the new field, and including variants doesn't change existing fields). If a catalog test asserts an exact product object shape and now fails because of the extra `availability` field, STOP and report — but the existing tests assert specific fields, not whole-object equality.

- [ ] **Step 6: Full-suite checkpoint + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/src/lib/mappers.ts backend/src/modules/catalog/service.ts backend/tests/catalog.availability.test.ts
git commit -m "feat(catalog): expose 3-state product availability from variant stock"
```
Expected: green (153 prior + availability 5 = 158).

---

### Task 2: Part A frontend — map `availability` into the Product JSON-LD

**Files:**
- Modify: `frontend/src/lib/schema.ts` (product schema field)
- Modify: `frontend/src/lib/api.ts` (map the field through)
- Modify: `frontend/src/lib/structured-data.ts` (use it in `productSchema`)
- Test: `frontend/tests/structured-data.test.ts` (extend)

**Interfaces:**
- Consumes: the backend product `availability` (Task 1); the `Product` type.
- Produces: `Product.availability: 'in_stock' | 'out_of_stock' | 'backorder'`; `productSchema` emits the matching schema.org availability URL.

- [ ] **Step 1: Extend the test — add to `frontend/tests/structured-data.test.ts`**

Inside the existing `describe('productSchema', ...)` block, add:
```ts
  it('maps availability to the matching schema.org URL', () => {
    const oos = productSchema({ ...baseProduct, availability: 'out_of_stock' } as Product, 'https://x/p') as any;
    expect(oos.offers.availability).toBe('https://schema.org/OutOfStock');
    const bo = productSchema({ ...baseProduct, availability: 'backorder' } as Product, 'https://x/p') as any;
    expect(bo.offers.availability).toBe('https://schema.org/BackOrder');
    const ins = productSchema({ ...baseProduct, availability: 'in_stock' } as Product, 'https://x/p') as any;
    expect(ins.offers.availability).toBe('https://schema.org/InStock');
  });
```
(`baseProduct` is the existing fixture; it has no `availability`, so spreading + setting it provides the value. The existing offer test, which has no `availability`, will exercise the `InStock` fallback.)

- [ ] **Step 2: Run it — verify it fails**

```
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run tests/structured-data.test.ts
```
Expected: FAIL (still emits the hardcoded `InStock` for `out_of_stock`/`backorder`).

- [ ] **Step 3: Add the field to `frontend/src/lib/schema.ts`**

In the product `z.object({ ... })`, add (next to `ratingCount`):
```ts
  availability: z.enum(['in_stock', 'out_of_stock', 'backorder']).default('in_stock'),
```

- [ ] **Step 4: Map it through in `frontend/src/lib/api.ts`**

In the `ApiProduct` raw type, add an optional field:
```ts
  availability?: 'in_stock' | 'out_of_stock' | 'backorder';
```
In `toProduct(p)`'s returned object, add (next to `ratingCount`):
```ts
    availability: p.availability ?? 'in_stock',
```

- [ ] **Step 5: Use it in `frontend/src/lib/structured-data.ts`**

Add near the top (after the `CONTEXT`/`abs` declarations):
```ts
const AVAILABILITY_URL: Record<string, string> = {
  in_stock: 'https://schema.org/InStock',
  out_of_stock: 'https://schema.org/OutOfStock',
  backorder: 'https://schema.org/BackOrder',
};
```
In `productSchema`, replace the hardcoded offers line:
```ts
      availability: 'https://schema.org/InStock',
```
with:
```ts
      availability: AVAILABILITY_URL[product.availability] ?? AVAILABILITY_URL.in_stock,
```

- [ ] **Step 6: Run the test + build + full suite**

```
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run tests/structured-data.test.ts
cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run
```
Expected: structured-data passes (7 now); build OK; full suite 52 (51 + the new availability test). Backend must be up for the catalog tests.

- [ ] **Step 7: Commit**

```
git add frontend/src/lib/schema.ts frontend/src/lib/api.ts frontend/src/lib/structured-data.ts frontend/tests/structured-data.test.ts
git commit -m "feat(seo): map real product availability into Product JSON-LD offers"
```

---

### Task 3: Part B — stale-`PROCESSING` job reclaim

**Files:**
- Modify: `backend/src/modules/notifications/jobs.ts` (`reclaimStaleJobs`)
- Modify: `backend/src/env.ts` (`JOBS_STALE_LOCK_MS`)
- Modify: `backend/src/modules/notifications/worker.ts` (call it each tick)
- Modify: `backend/src/server.ts` (pass the option)
- Test: `backend/tests/jobs.reclaim.test.ts`

**Interfaces:**
- Produces: `reclaimStaleJobs(prisma: PrismaClient, staleMs: number): Promise<number>`; `startJobWorker(prisma, { intervalMs, batchSize, staleLockMs })`.

- [ ] **Step 1: Write the failing test — `backend/tests/jobs.reclaim.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { reclaimStaleJobs } from '../src/modules/notifications/jobs';

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.job.deleteMany({ where: { type: { in: ['test.reclaim-stale', 'test.reclaim-fresh'] } } });
});
afterAll(async () => {
  await prisma.job.deleteMany({ where: { type: { in: ['test.reclaim-stale', 'test.reclaim-fresh'] } } });
  await prisma.$disconnect();
});

describe('reclaimStaleJobs', () => {
  it('resets a stale PROCESSING job to PENDING and leaves a recent one alone', async () => {
    const stale = await prisma.job.create({
      data: { type: 'test.reclaim-stale', payload: {}, status: 'PROCESSING', lockedAt: new Date(Date.now() - 10 * 60_000) },
    });
    const fresh = await prisma.job.create({
      data: { type: 'test.reclaim-fresh', payload: {}, status: 'PROCESSING', lockedAt: new Date() },
    });

    const count = await reclaimStaleJobs(prisma, 5 * 60_000);
    expect(count).toBeGreaterThanOrEqual(1);

    const s = await prisma.job.findUnique({ where: { id: stale.id } });
    const f = await prisma.job.findUnique({ where: { id: fresh.id } });
    expect(s!.status).toBe('PENDING');
    expect(s!.lockedAt).toBeNull();
    expect(f!.status).toBe('PROCESSING'); // recent lock untouched
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/jobs.reclaim.test.ts
```
Expected: FAIL (`reclaimStaleJobs` not exported).

- [ ] **Step 3: Add `reclaimStaleJobs` to `backend/src/modules/notifications/jobs.ts`**

Add this exported function (e.g. right after `enqueueJob`):
```ts
/**
 * Reclaim jobs orphaned in PROCESSING by a crashed worker: any job locked longer than `staleMs`
 * is reset to PENDING so the next tick retries it. Only touches stale PROCESSING rows.
 */
export async function reclaimStaleJobs(prisma: PrismaClient, staleMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - staleMs);
  const res = await prisma.job.updateMany({
    where: { status: 'PROCESSING', lockedAt: { lt: cutoff } },
    data: { status: 'PENDING', lockedAt: null },
  });
  return res.count;
}
```

- [ ] **Step 4: Add the env var in `backend/src/env.ts`**

Next to the other `JOBS_*` vars, add:
```ts
  JOBS_STALE_LOCK_MS: z.coerce.number().int().positive().default(300000),
```

- [ ] **Step 5: Call it each tick in `backend/src/modules/notifications/worker.ts`**

Change the import to also pull `reclaimStaleJobs`:
```ts
import { processJobs, reclaimStaleJobs } from './jobs';
```
Replace `startJobWorker` with the version that reclaims first, then drains:
```ts
export function startJobWorker(
  prisma: PrismaClient,
  opts: { intervalMs: number; batchSize: number; staleLockMs: number },
): void {
  if (timer) return;
  timer = setInterval(() => {
    reclaimStaleJobs(prisma, opts.staleLockMs)
      .then(() => processJobs(prisma, opts.batchSize))
      .catch((e) => console.error('[jobs] worker tick failed', e));
  }, opts.intervalMs);
  // Don't keep the process alive just for the worker.
  timer.unref();
}
```

- [ ] **Step 6: Pass the option in `backend/src/server.ts`**

Change the `startJobWorker(...)` call to include `staleLockMs`:
```ts
    startJobWorker(app.prisma, {
      intervalMs: env.JOBS_POLL_INTERVAL_MS,
      batchSize: env.JOBS_BATCH_SIZE,
      staleLockMs: env.JOBS_STALE_LOCK_MS,
    });
```

- [ ] **Step 7: Run the test + the job-worker regression**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/jobs.reclaim.test.ts tests/jobs.test.ts tests/jobs.concurrency.test.ts
```
Expected: PASS (reclaim 1; the existing job tests unaffected — `reclaimStaleJobs` is a separate function and the worker isn't started in tests).

- [ ] **Step 8: Full-suite checkpoint + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/notifications/jobs.ts backend/src/env.ts backend/src/modules/notifications/worker.ts backend/src/server.ts backend/tests/jobs.reclaim.test.ts
git commit -m "feat(jobs): reclaim stale PROCESSING jobs each worker tick (crash recovery)"
```
Expected: green (158 prior + reclaim 1 = 159).

---

### Task 4: Verification sweep + memory

**Files:**
- Modify: `C:\Users\PC\.claude\projects\D--Roots---Rings\memory\MEMORY.md` + new `roots-rings-phase10-polish.md`

- [ ] **Step 1: Suites + build**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run
cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build
```
Expected: backend 159; frontend 52; build OK.

- [ ] **Step 2: Live curl verification (controller-run)** — restart the backend (so it loads the variants `include` + the reclaim wiring) and the SSR frontend (rebuilt), then:
  1. The catalog API returns the field: `curl -s http://127.0.0.1:4000/api/products | head` — products include an `"availability"` value (`in_stock`/`out_of_stock`/`backorder`).
  2. A PDP's Product JSON-LD reflects it: `curl -s http://127.0.0.1:4321/objects/<slug>` → the `ld+json` `offers.availability` is a `https://schema.org/...` URL matching the product's real stock (an in-stock product → `InStock`).

- [ ] **Step 3: Update memory** — create `roots-rings-phase10-polish.md` (availability: `computeAvailability` from variant stock + allowBackorder, exposed on ProductDTO, mapped to schema.org in productSchema; reclaim: `reclaimStaleJobs` resets stale PROCESSING→PENDING each worker tick, `JOBS_STALE_LOCK_MS` default 5min) + a one-line pointer in `MEMORY.md`.

- [ ] **Step 4: Report** the final counts + the curl-verification results.

---

## Self-Review

**1. Spec coverage** (spec §2–§5 → tasks):
- §2 Part A backend (variants include, ProductDTO.availability, mapProduct compute) → Task 1; frontend (schema, api, structured-data) → Task 2. ✅
- §3 Part B (`reclaimStaleJobs`, worker tick, env) → Task 3. ✅
- §4 security/correctness (server-side derivation, `default('in_stock')`, reclaim only stale PROCESSING, attempts preserved) → Tasks 1–3 (the reclaim's `updateMany` touches only `status='PROCESSING' & lockedAt<cutoff` and doesn't change `attempts`). ✅
- §5 testing (computeAvailability cases; productSchema mapping; reclaimStaleJobs; regression; curl) → Tasks 1, 2, 3, 4. ✅
- §6 file structure → matches Tasks 1–3. ✅

**2. Placeholder scan:** every code step contains complete code; every test step has real assertions; the frontend verification is explicit (`astro build` + suite + curl). No TBD/TODO.

**3. Type consistency:** `Availability`/`computeAvailability` (Task 1) is the type used by `ProductDTO.availability` (Task 1) and mirrored by the frontend `Product.availability` enum (Task 2); `productSchema` reads `product.availability` (Task 2) which the `AVAILABILITY_URL` map keys on (`in_stock`/`out_of_stock`/`backorder`). `reclaimStaleJobs(prisma, staleMs): Promise<number>` (Task 3) matches its call in the worker and the test. `startJobWorker(prisma, {intervalMs, batchSize, staleLockMs})` (Task 3 worker) matches the `server.ts` call (Task 3). `JOBS_STALE_LOCK_MS` (env, Task 3) is the value passed as `staleLockMs`. ✅
