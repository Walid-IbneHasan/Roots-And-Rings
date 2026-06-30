# Roots & Rings Backend — Phase 2 Design Spec (Checkout core)

**Date:** 2026-06-29
**Status:** Approved
**Builds on:** Phase 1 (Fastify + Prisma + MySQL catalog API + admin). This phase adds the
transactional purchase core.

## 0. Decisions (confirmed)

- **Guest checkout first** — no customer accounts yet (Phase 3). Orders carry guest
  email/phone; `customerId` is a nullable column with no Customer table this phase.
- **Client cart → checkout API** — keep the existing localStorage cart drawer (no UI change);
  the browser submits the cart to `POST /api/checkout`, which re-prices server-side.
- **COD now + bKash scaffolded** — Cash-on-Delivery works end-to-end; bKash is built behind a
  `PaymentProvider` interface and activates once sandbox credentials are supplied.
- **Full concurrency-safe inventory** — variants with stock, row-locked reservations, signed
  movement ledger, proven by a concurrent-checkout oversell test.

## 1. Goals & non-goals

**Goals**
- Concurrency-safe inventory (reserve/commit/release/restock) with `SELECT … FOR UPDATE`.
- `POST /api/checkout`: idempotent order creation, server-side re-pricing, COD + bKash(scaffold).
- Order + Payment models with status state machines; immutable order/shipping snapshots.
- Admin orders: list/detail, validated status transitions, refund→restock, COD settle-on-DELIVERED.
- Two on-brand storefront pages: `/checkout` and `/checkout/success`.
- Tests incl. concurrent-checkout (no oversell) + idempotency replay.

**Non-goals (Phase 3+)**
- Customer accounts (JWT/OAuth/OTP), addresses, account dashboard, owner-scoped history.
- Coupons, reviews, wishlist sync, backend-persisted cart/merge.
- bKash live (needs credentials), jobs/cron worker (Phase 2 enqueues to a simple table + runs
  the handler inline/logged), SEO/CMS, enhancements.

## 2. Architecture

- Backend modules under `backend/src/modules/`: `inventory/`, `checkout/`, `orders/`,
  `payments/` (+ `payments/providers/{cod,bkash}.ts`), and admin `orders.ts`.
- `lib/order-number.ts` (human IDs), `lib/order-state.ts` (allowed transitions), `lib/money.ts`.
- Storefront: new `frontend/src/pages/checkout.astro` + `checkout/success.astro`, a
  `frontend/src/lib/checkout.ts` (POST cart → API), reusing the existing cart store + lookup.
- Notifications: a minimal `Job` table + `notifications` handler that logs (no-op email when
  SMTP unset). Drained inline on order confirmation (a real cron worker is Phase 3).

## 3. Schema additions (Prisma)

Enums: `OrderStatus { AWAITING_PAYMENT PAYMENT_REVIEW PAID PROCESSING SHIPPED DELIVERED
CANCELLED FAILED EXPIRED REFUNDED PARTIALLY_REFUNDED }`, `PaymentProviderKind { COD BKASH }`,
`PaymentStatus { INITIATED PENDING PAID FAILED CANCELLED REFUNDED PARTIALLY_REFUNDED }`,
`ReservationStatus { ACTIVE COMMITTED RELEASED EXPIRED }`, `MovementType { MANUAL_ADJUSTMENT
SALE RESERVATION RESERVATION_RELEASE RESERVATION_EXPIRY REFUND_RESTOCK CANCELLATION_RESTOCK }`,
`ShipmentStatus { PENDING PACKED SHIPPED DELIVERED RETURNED CANCELLED }`, `JobStatus { PENDING
PROCESSING DONE FAILED }`.

- **InventoryMovement**: id, variantId(→ProductVariant), type(MovementType), quantity(Int, signed),
  reason?, orderId?, createdAt. Index (variantId), (orderId), (createdAt).
- **InventoryReservation**: id, variantId, orderId, quantity, status(ReservationStatus),
  expiresAt, createdAt, updatedAt. Index (variantId, status), (orderId), (status, expiresAt).
- **LowStockNotification**: id, variantId, threshold, notifiedAt?, resolvedAt?, createdAt.
- **Order**: id, orderNumber(@unique), customerId?(String, no FK this phase),
  guestEmail, guestPhone?, status(OrderStatus), currency(default BDT),
  subtotal/discountTotal/shippingTotal/taxTotal/grandTotal(Decimal(12,2)),
  idempotencyKey(@unique), orderToken(@unique), shippingSnapshot(Json), placedAt, paidAt?,
  createdAt, updatedAt. Index (status), (createdAt), (guestEmail).
- **OrderItem**: id, orderId, productId?, variantId?, productName, variantName?, sku,
  unitPrice(Decimal), quantity, lineTotal(Decimal). Index (orderId).
- **Shipment**: id, orderId(@unique-ish, one per order for now), status(ShipmentStatus),
  carrier?, trackingNumber?, shippedAt?, deliveredAt?, createdAt, updatedAt.
- **Payment**: id, orderId, provider(PaymentProviderKind), status(PaymentStatus),
  amount(Decimal), currency, tranId(@unique), bkashPaymentID?(@unique), bkashTrxID?,
  payerMasked?, gatewayPageURL?, validatedAt?, createdAt, updatedAt. Index (orderId), (status).
- **PaymentEvent**: id, paymentId, type(String), rawPayload(Json), signatureValid(Bool default
  true), processed(Bool default false), createdAt. Index (paymentId), (type).
- **Job**: id, type, payload(Json), status(JobStatus default PENDING), runAt(default now),
  attempts(default 0), maxAttempts(default 5), lastError?, lockedAt?, lockedBy?, createdAt.
  Index (status, runAt).
- **ProductVariant** gains nothing structurally (already has stock, lowStockThreshold); seed
  creates one default variant per product.

## 4. Stock seeding (extend Phase 1 seed)

For each product, upsert a default `ProductVariant` (sku `${product.sku}-V`, name "Standard"):
- `badges` includes "Made to Order" → `stock=0`, product `allowBackorder=true`.
- `edition` present → `stock = edition.count` (e.g. 40), `lowStockThreshold = 3`.
- else one-of-a-kind → `stock = 1`, `lowStockThreshold = 1`.
Idempotent (upsert by sku). Existing products keep their data.

## 5. Inventory service (`modules/inventory/service.ts`)

All mutations write an `InventoryMovement`. Methods (all transactional):
- `availableStock(variantId)` = variant.stock − SUM(active reservations).
- `reserveForOrder(tx, orderId, items[{variantId,qty}], ttlMinutes)` — for each item:
  `SELECT … FOR UPDATE` the variant row (raw SQL inside the Prisma `$transaction`), compute
  available; if `available < qty` and not `allowBackorder` → throw `OutOfStock`. Create an
  ACTIVE reservation + a RESERVATION movement. Returns reservation ids.
- `commitReservations(tx, orderId)` — set reservations COMMITTED, decrement `variant.stock`,
  write SALE movements.
- `releaseReservations(tx, orderId)` — ACTIVE→RELEASED + RESERVATION_RELEASE movements.
- `restockOrder(tx, orderId, type)` — increment stock for committed items, write
  REFUND_RESTOCK/CANCELLATION_RESTOCK movements.
- `adjustStock(variantId, delta, reason, actor)` — admin manual, MANUAL_ADJUSTMENT movement.
- After commits, evaluate low-stock and upsert `LowStockNotification` when `stock ≤ threshold`.

Concurrency guarantee proven by `tests/inventory.concurrency.test.ts`: stock=1, fire N parallel
`reserveForOrder` in separate transactions → exactly one succeeds, others get `OutOfStock`.

## 6. Checkout (`modules/checkout/`)

`POST /api/checkout` body: `{ items:[{slug, qty}], contact:{email, phone, name},
shipping:{line1,line2?,city,district,postalCode,country?}, paymentMethod:'COD'|'BKASH',
idempotencyKey }`.
1. If an order with this `idempotencyKey` exists → return it (idempotent replay).
2. Resolve each slug → product + default variant; re-price via the Phase 1 pricing engine
   (server is source of truth); enforce min/max per order; reject empty/invalid carts.
3. In a transaction: create Order (status per method), OrderItems (snapshots), reserve
   inventory, create Payment + initial PaymentEvent.
   - **COD**: status `PROCESSING`, `commitReservations`, create Shipment(PENDING), enqueue
     `email.order_confirmation` Job (handler logs), return `{ orderNumber, orderToken, status }`.
   - **bKash**: status `AWAITING_PAYMENT`, `PaymentProvider.createSession()` → if creds present,
     return `gatewayPageURL`; else Payment stays INITIATED with a clear "credentials required"
     message (reservations held with TTL). Returns `{ orderNumber, orderToken, redirectUrl? }`.
`GET /api/orders/:orderNumber?token=…` → order summary (404 if token mismatch).

Order numbers: `RR-YYYYMMDD-XXXX` (date + base32 random), unique.

## 7. Payments (`modules/payments/`)

- `PaymentProvider` interface: `createSession(order, payment)`, `execute(paymentId, ref)`,
  `query(paymentId)`, `refund(paymentId, amount)`.
- `cod.ts`: trivial (no gateway).
- `bkash.ts`: implements the Create→Execute→Query→Refund calls against bKash's hosted-checkout
  REST API, reading creds from env (`BKASH_*`). With creds unset, methods return a typed
  `CredentialsMissing` result and log; no live calls. `PaymentEvent` appended at each step;
  event handling idempotent (skip already-`processed`).
- `markPaid(orderId)`: status→PAID/PROCESSING, ensure committed inventory, enqueue confirmation.
- Refund: full/partial → Payment REFUNDED/PARTIALLY_REFUNDED, order REFUNDED/PARTIALLY_REFUNDED,
  `restockOrder`.

## 8. Order state machine (`lib/order-state.ts`)

`canTransition(from, to)` allow-list (e.g. AWAITING_PAYMENT→{PAID,PROCESSING,CANCELLED,EXPIRED,
FAILED}; PROCESSING→{SHIPPED,CANCELLED,REFUNDED}; SHIPPED→{DELIVERED,RETURNED}; DELIVERED→
{REFUNDED,PARTIALLY_REFUNDED}; …). Admin transitions and refunds validated through it; invalid
transitions rejected.

## 9. Admin (server-rendered)

- `/admin/orders` — list (status filter, search by number/email), detail (items, totals,
  payment, shipment, timeline), status-transition buttons (validated), refund (full/partial →
  restock), COD settle-to-PAID on DELIVERED. All CSRF + audit-logged.
- Product form gains a **stock** field (maps to the default variant) and a small inventory
  movements panel per product. Low-stock count on the dashboard already wired in Phase 1.

## 10. Storefront (on-brand additions, no redesign)

- `/checkout` — uses the existing design system (same components/tokens): order summary from
  the localStorage cart (via the existing lookup), contact + shipping fields (`.input-minimal`),
  payment method (COD / bKash), `Place Order` (btn-solid). Submits via `lib/checkout.ts` →
  `/api/checkout` with a generated idempotency key; on success clears the cart and redirects to
  success. Errors (out of stock, validation) shown inline in the page's style.
- `/checkout/success?order=…&token=…` — confirmation: order number, status, items, totals,
  "what happens next". Reads `GET /api/orders/:orderNumber?token=…`.
- Cart drawer + `/cart` "Proceed to Checkout" now link to `/checkout` (no other UI change).

## 11. Security & non-functional

- Re-price server-side (never trust client prices); validate all input with zod; idempotency
  on checkout; transactions for checkout/refund/inventory; `SELECT … FOR UPDATE` for stock.
- Reservation TTL + an `expire-orders` admin/cron-style endpoint (token-guarded) releases stale
  reservations and expires unpaid bKash orders (the worker loop itself is Phase 3; the endpoint
  + logic exist now).
- Never log card/PII; PaymentEvent stores gateway payloads (no card data).

## 12. Testing & acceptance

- Unit: `order-state` transitions; inventory reserve/commit/release/restock + low-stock;
  order-number uniqueness; money totals.
- Integration (`.inject()`): COD checkout happy path; idempotency replay returns same order;
  **concurrent-checkout oversell** (exactly one of N wins on stock=1); GET order by token (and
  404 on bad token); admin order list/detail + a valid transition + an invalid one rejected;
  refund restocks. bKash createSession returns CredentialsMissing without creds.
- Browser: storefront cart → `/checkout` → place COD order → `/checkout/success`; admin sees the
  order, transitions it, settles COD on delivery.

## 13. Risks

- `SELECT … FOR UPDATE` via Prisma needs raw SQL inside `$transaction` (MySQL). Verified by the
  concurrency test.
- New storefront pages must match the design system exactly (reuse tokens/components).
- bKash cannot be live-tested without credentials — scaffolded + clearly flagged.
- Idempotency + reservation TTL edge cases covered by tests.
