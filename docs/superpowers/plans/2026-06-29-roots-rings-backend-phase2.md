# Roots & Rings Backend — Phase 2 Implementation Plan (Checkout core)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add concurrency-safe inventory, a server-priced idempotent checkout, orders + COD payments (bKash scaffolded), an admin orders back-office, and on-brand storefront checkout/confirmation pages — on top of the Phase 1 catalog/admin.

**Architecture:** New Fastify modules (`inventory`, `checkout`, `orders`, `payments`, admin `orders`) over the existing Prisma/MySQL app. Inventory reservations use `SELECT … FOR UPDATE` inside interactive Prisma transactions to prevent oversell. The storefront keeps its localStorage cart and submits to `POST /api/checkout`; two new SSR pages (`/checkout`, `/checkout/success`) reuse the existing design system.

**Tech Stack:** (unchanged) Fastify 5, Prisma + MySQL, zod, eta, Vitest. New: raw-SQL row locks via `$transaction` + `$queryRawUnsafe`.

## Global Constraints

- Backend `D:\Roots & Rings\backend`; storefront `D:\Roots & Rings\frontend`. Call node entries directly (the `&` path breaks npm shims).
- Money `Decimal @db.Decimal(12,2)`; currency BDT (৳). **Re-price server-side; never trust client prices.**
- Guest checkout only this phase (no Customer table); orders carry `guestEmail`/`guestPhone`, nullable `customerId` string (no FK).
- Concurrency-safe stock via `SELECT … FOR UPDATE`; every stock change writes an `InventoryMovement`.
- Idempotent checkout via unique `idempotencyKey`; guest order access via unique `orderToken`.
- COD functional; bKash built behind `PaymentProvider`, returns `CredentialsMissing` without `BKASH_*` env.
- **Do NOT change existing storefront UI**; new pages reuse existing tokens/components only.
- TS strict; tests via Fastify `.inject()`. Git not initialised — "Commit" steps recorded, skipped.

## File Structure

```
backend/prisma/schema.prisma            # + Phase 2 models/enums
backend/prisma/seed.ts                  # + default variant per product (stock)
backend/src/
  env.ts                                # + BKASH_* (optional)
  lib/ order-number.ts  order-state.ts  money.ts
  modules/
    inventory/ service.ts errors.ts
    payments/ service.ts provider.ts providers/cod.ts providers/bkash.ts
    orders/ service.ts routes.ts        # GET /api/orders/:orderNumber
    checkout/ service.ts routes.ts schemas.ts
    notifications/ jobs.ts              # enqueue + inline drain (logged)
    cron/ routes.ts                     # token-guarded expire-orders
    admin/ orders.ts views/{orders-list.eta,order-detail.eta}
           products.ts (modify: stock field)
backend/tests/ order-state.test.ts inventory.test.ts inventory.concurrency.test.ts
               payments.test.ts checkout.api.test.ts admin.orders.test.ts
frontend/src/
  pages/ checkout.astro  checkout/success.astro
  lib/ checkout.ts
  components/cart/CartDrawer.astro (modify link) ; pages/cart.astro (modify link)
```

---

### Task 1: Schema additions + migration + stock seeding

**Files:** Modify `backend/prisma/schema.prisma`, `backend/prisma/seed.ts`, `backend/src/env.ts`.

**Interfaces:**
- Produces: enums `OrderStatus, PaymentProviderKind, PaymentStatus, ReservationStatus, MovementType, ShipmentStatus, JobStatus`; models `InventoryMovement, InventoryReservation, LowStockNotification, Order, OrderItem, Shipment, Payment, PaymentEvent, Job` (per spec §3). Seed creates one default `ProductVariant` per product with stock per spec §4. `env` gains optional `BKASH_BASE_URL, BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_USERNAME, BKASH_PASSWORD`.

- [ ] **Step 1:** Add the enums + models to `schema.prisma` (relations: Order 1—* OrderItem; Order 1—1 Shipment; Order 1—* Payment; Payment 1—* PaymentEvent; ProductVariant 1—* InventoryMovement/InventoryReservation/LowStockNotification). Indexes per spec.
- [ ] **Step 2:** `env.ts` — add the optional `BKASH_*` keys (`z.string().optional()`).
- [ ] **Step 3:** Migrate: `node node_modules/prisma/build/index.js migrate dev --name phase2_orders_inventory`.
- [ ] **Step 4:** Extend `seed.ts`: after creating each product, upsert a default variant `{ sku: product.sku + '-V', name: 'Standard', stock, lowStockThreshold }`; set product `allowBackorder` for made-to-order. Stock rules per spec §4.
- [ ] **Step 5: Verify** — re-run seed (`node --env-file=.env --import tsx prisma/seed.ts`); `prisma.productVariant.count()` ≥ 16; a made-to-order product has `allowBackorder=true, stock=0`; a limited edition has `stock=editionCount`.
- [ ] **Step 6: Commit** — `feat(db): phase 2 orders/inventory/payment schema + stock seed`.

---

### Task 2: lib helpers — order-number, order-state, money (TDD)

**Files:** Create `backend/src/lib/{order-number,order-state,money}.ts`, `backend/tests/order-state.test.ts`.

**Interfaces:**
- Produces: `generateOrderNumber(now?:Date):string` → `RR-YYYYMMDD-XXXX` (4 base32 chars from `crypto.randomBytes`). `ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]>`; `canTransition(from,to):boolean`. `round2(n):number`; `computeTotals(items:{unitPrice:number,quantity:number}[], shipping=0):{subtotal,shippingTotal,grandTotal}`.

- [ ] **Step 1: Failing tests** (order-state + money): `canTransition('PROCESSING','SHIPPED')===true`; `canTransition('DELIVERED','AWAITING_PAYMENT')===false`; `computeTotals([{unitPrice:100,quantity:2}],50)` → `{subtotal:200,shippingTotal:50,grandTotal:250}`; `generateOrderNumber()` matches `/^RR-\d{8}-[A-Z2-7]{4}$/`.
- [ ] **Step 2: Run** `node node_modules/vitest/vitest.mjs run tests/order-state.test.ts` → FAIL.
- [ ] **Step 3: Implement** the three helpers.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(backend): order-number, order-state machine, money helpers`.

---

### Task 3: Inventory service + concurrency (TDD)

**Files:** Create `backend/src/modules/inventory/{service.ts,errors.ts}`, `backend/tests/inventory.test.ts`, `backend/tests/inventory.concurrency.test.ts`.

**Interfaces:**
- Consumes: prisma. Produces:
  - `OutOfStockError` (statusCode 409, `variantId`).
  - `availableStock(prisma, variantId):Promise<number>` = `stock − Σ(ACTIVE reservation qty)`.
  - `reserveForOrder(tx, orderId, items:{variantId:string;quantity:number}[], ttlMinutes=30):Promise<void>` — per item `SELECT id, stock FROM ProductVariant WHERE id=? FOR UPDATE` (raw), compute available within the tx, throw `OutOfStockError` if short and not `allowBackorder`; create ACTIVE `InventoryReservation` + `RESERVATION` movement.
  - `commitReservations(tx, orderId)`, `releaseReservations(tx, orderId)`, `restockOrder(tx, orderId, type:'REFUND_RESTOCK'|'CANCELLATION_RESTOCK')`, `adjustStock(prisma, variantId, delta, reason, actorEmail)`.
  - `checkLowStock(prisma, variantId)` upserts `LowStockNotification` when `stock ≤ lowStockThreshold`.

- [ ] **Step 1: Failing tests** (inventory.test): reserve then `availableStock` drops; commit decrements `stock` + writes SALE movement; release restores availability; `adjustStock(+5)` increments + MANUAL movement; reserve beyond stock w/o backorder throws `OutOfStockError`; with `allowBackorder` succeeds. (Use a throwaway variant created/deleted in the test.)
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement service + errors (FOR UPDATE via `tx.$executeRawUnsafe`/`$queryRawUnsafe`). **Step 4: Run** → PASS.
- [ ] **Step 5: Concurrency test** — create a variant stock=1; fire `Promise.allSettled` of 8 independent `prisma.$transaction(tx => reserveForOrder(tx, orderId_i, [{variantId,quantity:1}]))`; assert exactly 1 fulfilled, 7 rejected with `OutOfStockError`; `availableStock===0`.
- [ ] **Step 6: Run** concurrency test → PASS (proves no oversell). **Step 7: Commit** — `feat(inventory): concurrency-safe reservations + ledger`.

---

### Task 4: Payments — provider interface, COD, bKash scaffold (TDD)

**Files:** Create `backend/src/modules/payments/{provider.ts,service.ts}`, `backend/src/modules/payments/providers/{cod.ts,bkash.ts}`, `backend/tests/payments.test.ts`.

**Interfaces:**
- Produces: `interface PaymentProvider { kind; createSession(order,payment):Promise<{gatewayPageURL?:string; status:'INITIATED'|'PENDING'|'CREDENTIALS_MISSING'}>; execute(paymentId,ref):Promise<...>; query(paymentId):Promise<...>; refund(paymentId,amount):Promise<...> }`. `getProvider(kind):PaymentProvider`. `cod` (no gateway, status INITIATED). `bkash` — real Create/Execute/Query/Refund against `BKASH_BASE_URL` when env set, else returns `CREDENTIALS_MISSING` and logs (no network). `markPaid(prisma, orderId)`; `refundPayment(prisma, paymentId, amount)`. Each step appends a `PaymentEvent`; event handling idempotent (skip `processed`).

- [ ] **Step 1: Failing tests**: `getProvider('COD').createSession(...)` → `{status:'INITIATED'}`; `getProvider('BKASH').createSession(...)` with no env → `{status:'CREDENTIALS_MISSING'}`; `markPaid` sets Payment PAID + Order PAID/PROCESSING + appends a PaymentEvent. (Create a throwaway order+payment in the test.)
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement. **Step 4: Run** → PASS. **Step 5: Commit** — `feat(payments): provider interface, COD + bKash scaffold, markPaid/refund`.

---

### Task 5: Checkout service + routes (TDD)

**Files:** Create `backend/src/modules/checkout/{service.ts,routes.ts,schemas.ts}`, `backend/src/modules/orders/{service.ts,routes.ts}`, `backend/src/modules/notifications/jobs.ts`, `backend/tests/checkout.api.test.ts`. Modify `backend/src/app.ts` (register checkout + orders routes).

**Interfaces:**
- Consumes: inventory, payments, pricing (Phase 1), order helpers.
- Produces:
  - `placeOrder(prisma, input):Promise<{orderNumber:string; orderToken:string; status:OrderStatus; redirectUrl?:string}>` — idempotent by `input.idempotencyKey` (return existing if present); resolve each `{slug,qty}` → product + default variant; re-price (pricing engine); enforce min/max; transaction: create Order+OrderItems, `reserveForOrder`; COD → status PROCESSING + `commitReservations` + Shipment(PENDING) + enqueue confirmation Job; bKash → AWAITING_PAYMENT + provider.createSession.
  - `enqueueJob(prisma, type, payload)` + `runJobInline(prisma, jobId)` (handler logs the email; no-op when SMTP unset).
  - Routes: `POST /api/checkout` (zod body per spec §6), `GET /api/orders/:orderNumber?token=` (404 on mismatch).

- [ ] **Step 1: Failing tests**: POST `/api/checkout` (COD, 1 in-stock item) → 200 `{orderNumber,orderToken,status:'PROCESSING'}`; order exists with items + committed stock decremented; replay with same `idempotencyKey` → same orderNumber, no double-decrement; GET `/api/orders/:n?token=` → 200, wrong token → 404; checkout for an out-of-stock (stock=0, no backorder) item → 409.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement service + routes + schemas + jobs; register in `app.ts`. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(checkout): server-priced idempotent checkout + orders API + COD`.

---

### Task 6: Admin orders (list/detail/transitions/refund) + product stock field

**Files:** Create `backend/src/modules/admin/orders.ts`, views `orders-list.eta`, `order-detail.eta`. Modify `backend/src/modules/admin/index.ts` (register), `backend/src/modules/admin/products.ts` (+ stock field), `backend/src/modules/admin/views/product-form.eta` (+ stock input via pre-rendered block or simple field).

**Interfaces:**
- Consumes: order-state, inventory, payments, audit.
- Produces: `/admin/orders` (list: status filter, search), `/admin/orders/:id` (detail), `POST /admin/orders/:id/status` (validated via `canTransition`; DELIVERED + COD → also markPaid; CANCELLED → releaseReservations/restock), `POST /admin/orders/:id/refund` (amount → refundPayment + restock). Product form `stock` field updates the default variant via `adjustStock` (delta), audit-logged. All CSRF + audit.

- [ ] **Step 1:** Implement admin order routes + eta views (timeline, items, totals, payment, transition buttons, refund form).
- [ ] **Step 2:** Add stock field to product edit (load default variant stock; on save apply delta via `adjustStock`).
- [ ] **Step 3: Verify** (`tests/admin.orders.test.ts` via inject): login; list shows a seeded test order; valid transition PROCESSING→SHIPPED 302; invalid transition (e.g. DELIVERED→AWAITING_PAYMENT) rejected; refund restocks. Browser: order detail renders.
- [ ] **Step 4: Commit** — `feat(admin): orders back-office + transitions/refund + product stock`.

---

### Task 7: Cron-style expire-orders endpoint (token-guarded)

**Files:** Create `backend/src/modules/cron/routes.ts`; modify `app.ts` (register).

**Interfaces:**
- Produces: `POST /cron/expire-orders` guarded by `X-Cron-Token === env.CRON_TOKEN` → releases ACTIVE reservations past `expiresAt`, sets matching AWAITING_PAYMENT orders to EXPIRED, returns counts. (The always-on worker loop is Phase 3; this endpoint + logic exist now.)

- [ ] **Step 1: Failing test** (add to checkout.api.test or a cron test): POST without token → 401; with token → 200 `{releasedReservations, expiredOrders}`.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement `CronGuard` + route. **Step 4: Run** → PASS. **Step 5: Commit** — `feat(cron): token-guarded expire-orders`.

---

### Task 8: Storefront checkout + confirmation pages (on-brand, no redesign)

**Files:** Create `frontend/src/pages/checkout.astro`, `frontend/src/pages/checkout/success.astro`, `frontend/src/lib/checkout.ts`; modify `frontend/src/components/cart/CartDrawer.astro` + `frontend/src/pages/cart.astro` (Proceed-to-Checkout → `/checkout`).

**Interfaces:**
- Consumes: existing cart store + `buildCartLookup`/`lookupToJson`, design tokens/components.
- Produces:
  - `/checkout` (SSR shell): order-summary container (rendered client-side from the cart + embedded lookup, like `cart.astro`); contact (name/email/phone) + shipping (line1/line2/city/district/postalCode) fields using `.input-minimal`; payment method radios (COD / bKash); `Place Order` (`btn-solid`). `lib/checkout.ts` reads `$cart`, renders summary, on submit POSTs `${PUBLIC_API_URL}/api/checkout` with a `crypto.randomUUID()` idempotency key (persisted in sessionStorage), then `clearCart()` + redirect to success. Inline errors (out-of-stock/validation) in the page style.
  - `/checkout/success` (SSR): reads `?order=&token=`, server-fetches `GET /api/orders/:order?token=`, renders order number/status/items/totals + "what happens next". Empty/invalid → graceful message.
  - Cart drawer + cart page checkout buttons link to `/checkout`.

- [ ] **Step 1:** Build the two pages + `checkout.ts`, reusing existing components/classes (no new design language).
- [ ] **Step 2:** Repoint the two "Proceed to Checkout" actions to `/checkout`.
- [ ] **Step 3: Verify (browser)** — add to bag → `/checkout` shows summary + form → place COD order → redirected to `/checkout/success` with order number; admin shows the new order. Visual style matches the site.
- [ ] **Step 4: Commit** — `feat(storefront): on-brand checkout + order confirmation`.

---

### Task 9: Full sweep, README, verification

**Files:** Modify `backend/README.md` (Phase 2 section); ensure swagger lists new public routes.

- [ ] **Step 1:** Run full backend suite `node node_modules/vitest/vitest.mjs run` → all PASS (incl concurrency + idempotency). Run frontend suite → PASS.
- [ ] **Step 2:** Browser pass: end-to-end COD checkout + admin order transition + COD settle on DELIVERED; concurrent-checkout already proven by test.
- [ ] **Step 3:** README — document `/api/checkout`, `/api/orders/:n`, `/cron/expire-orders`, `BKASH_*` env, and Phase 2 implemented-vs-deferred.
- [ ] **Step 4: Commit** — `docs: phase 2 README + verification`.

---

## Self-Review

**Spec coverage:** §3 schema → Task 1. §4 stock seed → Task 1. §5 inventory + concurrency → Task 3. §6 checkout → Task 5. §7 payments → Task 4. §8 order-state → Task 2. §9 admin orders → Task 6. §10 storefront pages → Task 8. §11 security/cron → Tasks 5,7. §12 testing → Tasks 2–7,9. All covered. (Accounts/coupons/reviews/wishlist/persistent-cart/jobs-worker/SEO intentionally Phase 3+.)

**Placeholder scan:** No TBD/TODO. bKash "scaffold" is a concrete `CREDENTIALS_MISSING` path, not a placeholder. Admin/storefront views described by exact fields + behavior, verified by inject + browser.

**Type consistency:** `reserveForOrder/commitReservations/releaseReservations/restockOrder/adjustStock/availableStock/OutOfStockError` consistent (Tasks 3,5,6). `placeOrder` return shape consistent (Tasks 5,8). `canTransition/ORDER_TRANSITIONS` consistent (Tasks 2,6). `getProvider/markPaid/refundPayment` consistent (Tasks 4,5,6). Order fields (`orderNumber/orderToken/idempotencyKey/guestEmail/shippingSnapshot`) consistent (Tasks 1,5,6,8).

**TDD note:** Logic (order-state, inventory + concurrency, payments, checkout API, cron) is TDD via Vitest/`.inject()`. Admin eta views + storefront pages are build-and-verify (inject + browser).
