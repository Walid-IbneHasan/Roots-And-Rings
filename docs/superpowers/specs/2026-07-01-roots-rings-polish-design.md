# Roots & Rings — Phase 10 Design Spec (stock-aware SEO availability + job stale-lock reclaim)

**Date:** 2026-07-01
**Status:** Approved
**Builds on:** Phase 8 (SEO Product JSON-LD) + Phase 6 (job worker). Two independent deferred-polish items
from those phases' final reviews. No UI changes.

## 0. Decisions (confirmed)

- **Part A — availability:** product-level, 3-state (`in_stock` / `backorder` / `out_of_stock`), computed
  from active-variant stock + `Product.allowBackorder`; surfaced on the product API and mapped to
  schema.org in the Product JSON-LD. No visible UI change (structured-data only).
- **Part B — reclaim:** a `reclaimStaleJobs` sweep that resets `PROCESSING` jobs whose `lockedAt` is older
  than a threshold (default **5 min**, env `JOBS_STALE_LOCK_MS`) back to `PENDING`; run at the start of
  each worker tick.

## 1. Goals & non-goals

**Goals**
- Accurate `offers.availability` in the Product JSON-LD (no more always-`InStock`).
- A reliability backstop so a hard worker crash can't strand a job in `PROCESSING` forever.

**Non-goals**
- Any storefront UI change (sold-out badges, disabling add-to-cart — out of scope; checkout's inventory
  guards are unchanged). Per-variant availability / `AggregateOffer`. Order-status emails (separate item).

## 2. Part A — Real availability

**Backend (`backend/src/lib/mappers.ts` + `modules/catalog/service.ts`):**
- Add `variants: true` to the catalog query `include` (currently `{ category, images, collections }`) and
  to the `ProductWithRelations` type.
- Add `availability: 'in_stock' | 'out_of_stock' | 'backorder'` to `ProductDTO`.
- In `mapProduct`, compute it: `const inStock = p.variants.some((v) => v.isActive && v.stock > 0);`
  then `availability = inStock ? 'in_stock' : p.allowBackorder ? 'backorder' : 'out_of_stock'`.
  (A product with no active in-stock variant and no backorder → `out_of_stock`.)

**Frontend:**
- `src/lib/schema.ts`: add `availability: z.enum(['in_stock', 'out_of_stock', 'backorder']).default('in_stock')`
  to the product schema (default keeps old data / partial responses safe).
- `src/lib/api.ts`: map `availability` through from the backend product response.
- `src/lib/structured-data.ts`: `productSchema` maps `product.availability` →
  `{ in_stock: 'https://schema.org/InStock', out_of_stock: 'https://schema.org/OutOfStock',
  backorder: 'https://schema.org/BackOrder' }` (fallback `InStock`), replacing the hardcoded value.

## 3. Part B — Stale-`PROCESSING` reclaim

**`backend/src/modules/notifications/jobs.ts`:**
- `reclaimStaleJobs(prisma, staleMs): Promise<number>` — one `updateMany`:
  `where: { status: 'PROCESSING', lockedAt: { lt: new Date(Date.now() - staleMs) } }`,
  `data: { status: 'PENDING', lockedAt: null }`; returns the reclaimed count.

**`backend/src/modules/notifications/worker.ts`:**
- `startJobWorker` gains a `staleLockMs` option; each tick runs
  `reclaimStaleJobs(prisma, opts.staleLockMs).then(() => processJobs(prisma, opts.batchSize)).catch(log)`
  (reclaim first, then drain — a reclaimed job becomes `PENDING` and is picked up the same tick).

**`backend/src/server.ts`:** pass `staleLockMs: env.JOBS_STALE_LOCK_MS` into `startJobWorker`.

**`backend/src/env.ts`:** `JOBS_STALE_LOCK_MS: z.coerce.number().int().positive().default(300000)`.

The threshold (5 min) is safely longer than any email send, so an in-flight job is never reclaimed; only
a job orphaned by a crashed worker (no live process updating it) ages past the threshold.

## 4. Security & correctness

- Availability is derived server-side from inventory; no client input. The `default('in_stock')` on the
  frontend schema means an older backend (or a partial payload) degrades to the prior behavior, not a crash.
- `reclaimStaleJobs` only touches `PROCESSING` rows with a stale `lockedAt`; it can't disturb `PENDING`,
  `DONE`, or `FAILED` jobs, nor a freshly-claimed job (recent `lockedAt`). It's idempotent.
- Reclaim increments nothing — the job keeps its `attempts`; a reclaimed job re-runs and follows the normal
  retry/FAILED path on its next attempt (no infinite loop, bounded by `maxAttempts`). At-least-once
  semantics already accepted in Phase 6.

## 5. Testing

- **Part A (backend, Vitest + test DB):** `mapProduct` (or the catalog service) — a product with an active
  in-stock variant → `in_stock`; all variants 0 stock + `allowBackorder` → `backorder`; 0 stock no
  backorder → `out_of_stock`. **Frontend:** `structured-data.test.ts` — `productSchema` maps each
  availability value to the right schema.org URL (extend the existing test).
- **Part B (backend):** `reclaimStaleJobs` — a `PROCESSING` job with `lockedAt` well in the past → becomes
  `PENDING` (count 1); a `PROCESSING` job with a recent `lockedAt` → untouched.
- **Regression:** existing 153 backend + 51 frontend stay green; storefront build passes.
- **Verification:** curl a PDP → its Product JSON-LD `availability` reflects real stock (e.g. an in-stock
  product shows `InStock`); the catalog query still returns products with the new field.

## 6. File structure

**Backend (modified):** `src/lib/mappers.ts` (ProductDTO + mapProduct + ProductWithRelations),
`src/modules/catalog/service.ts` (`include` + variants), `src/modules/notifications/jobs.ts`
(`reclaimStaleJobs`), `src/modules/notifications/worker.ts` (call it), `src/server.ts` (pass the option),
`src/env.ts` (`JOBS_STALE_LOCK_MS`).
**Backend (new tests):** extend `tests/` with a mapProduct-availability test + a `reclaimStaleJobs` test
(e.g. `tests/catalog.availability.test.ts`, `tests/jobs.reclaim.test.ts`).
**Frontend (modified):** `src/lib/schema.ts`, `src/lib/api.ts`, `src/lib/structured-data.ts`
(+ extend `tests/structured-data.test.ts`).

## 7. Rollout

No migration (uses existing `ProductVariant.stock` + `Product.allowBackorder`). Additive env
(`JOBS_STALE_LOCK_MS`, default 5 min). With the catalog `include` change, availability flows into the
Product JSON-LD immediately. After Phase 10: bKash live, i18n, infra enhancements, order-status emails.
