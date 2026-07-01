# Roots & Rings — Phase 12 Design Spec (order source + admin manual orders)

**Date:** 2026-07-01
**Status:** Approved
**Builds on:** Phase 2 (checkout/`placeOrder` + inventory), Phase 1 (admin orders). Adds channel
attribution to orders and an admin flow to record orders from other channels. Foundation for Phase 13
analytics (lead-source breakdown).

## 0. Decisions (confirmed)

- **Order source:** `WEBSITE` / `FACEBOOK` / `INSTAGRAM` / `OTHER`; every site checkout + all existing
  orders are `WEBSITE` (DB default). Shown in the admin.
- **Manual orders:** admin creates them; payment picked per order (**Paid** → PAID payment + `paidAt`, or
  **pay-on-delivery** → pending); customer captured as contact (name/email/phone) and **auto-linked** if
  the email matches an existing account; **decrements inventory** (reuses checkout inventory logic);
  starts in `PROCESSING`; **no confirmation email**.

## 1. Goals & non-goals

**Goals:** attribute every order to a channel; let the admin record FB/IG/other orders with correct
inventory + attribution.

**Non-goals:** the analytics/insights (Phase 13); a full variant/size picker on the manual form (uses
the product's first active variant, consistent with the slug-based site cart); editing an order's line
items after creation; per-line manual price overrides; sending the buyer an email.

## 2. Schema (additive migration)

- `enum OrderSource { WEBSITE FACEBOOK INSTAGRAM OTHER }`.
- `Order.source OrderSource @default(WEBSITE)` + `@@index([source])` (for Phase-13 grouping).
- `PaymentProviderKind` gains `MANUAL`.

Purely additive; existing orders backfill to `WEBSITE` via the default.

## 3. Site orders + admin display

- `placeOrder` (`checkout/service.ts`) sets `source: 'WEBSITE'` on the `order.create` (explicit; no other
  checkout change).
- Admin **orders list** (`orders-list.eta`): a **Source** column (badge) + a **"+ New order"** button →
  `/admin/orders/new`. Admin **order detail** (`order-detail.eta`): show the source.

## 4. `createManualOrder` service

`createManualOrder(prisma, input): Promise<{ orderNumber, orderId }>` — a new function (in the checkout
module, reusing its helpers):
- `input`: `{ items: { slug: string; qty: number }[]; contact: { name; email; phone }; shipping: {...};
  source: OrderSource; paid: boolean }`.
- Re-price server-side via `priceItems(prisma, input.items)` + `computeTotals` (never trust the client;
  the admin never sends prices). Reject if no valid line items.
- Resolve the customer: `customer.findUnique({ email: lower })` → link its id if found, else null (guest).
- In a `$transaction`: `order.create` (`source`, `status: 'PROCESSING'`, `paidAt: paid ? now : null`,
  `customerId`, contact/shipping snapshot, items, a unique `idempotencyKey`/`orderToken`/`orderNumber`);
  `reserveForOrder` + `commitReservations` (decrement stock, same as a site COD order); create a
  `MANUAL` `payment` with status `PAID` (if `paid`) else `INITIATED`; create a `shipment` (PENDING).
- No email, no bKash. Returns the order number + id (for the redirect).

## 5. Admin manual-order form + route (`admin/orders.ts` + a new view)

- `GET /admin/orders/new` (`authed`): renders `order-new.eta` — a CSRF form listing active products (name
  + price + a `qty` number input each, blank/0 = skip), contact fields (name/email/phone), shipping
  fields (line1/city/district/postalCode), a **Source** `<select>` (Website/Facebook/Instagram/Other),
  and a **"Payment received"** checkbox.
- `POST /admin/orders/new` (`authedWrite` = requireAdminSession + csrfProtection): parse the form → build
  the `items` list (products with qty > 0), contact, shipping, source, paid → `createManualOrder` →
  `reply.redirect('/admin/orders/<id>')`. On no items / invalid input → re-render with an error.

## 6. Security & correctness

- Prices are re-derived server-side (`priceItems`); the admin submits only product slugs + quantities.
- Manual orders go through the same `reserveForOrder`/`commitReservations` inventory path, so stock can't
  be oversold across channels (the existing `SELECT … FOR UPDATE` concurrency guard applies).
- The create route is admin-only (`requireAdminSession`) + CSRF-protected. `source` is validated against
  the `OrderSource` enum (zod); an out-of-range value is rejected.
- `idempotencyKey` is server-generated (random) per manual order (no client key).

## 7. Testing

- **Backend:** `createManualOrder` — creates an order with the chosen `source`; decrements the variant
  stock by the ordered qty; links `customerId` when the email matches an existing customer (and leaves it
  null otherwise); `paid: true` → payment `PAID` + `order.paidAt` set, `paid: false` → payment pending +
  `paidAt` null; rejects an empty item list. `placeOrder` sets `source: 'WEBSITE'`. The admin
  `POST /admin/orders/new` route (integration): creates the order + redirects.
- **Regression:** existing checkout/orders/admin suites stay green; existing 164 backend + 53 frontend green.
- **Live:** create a manual Facebook order in the admin → it appears in the orders list with Source =
  Facebook, stock dropped, and (if marked paid) shows a PAID manual payment.

## 8. File structure

**Backend (modified):** `prisma/schema.prisma` (+ migration), `modules/checkout/service.ts`
(`createManualOrder` + `source:'WEBSITE'` in `placeOrder`), `modules/checkout/schemas.ts` (a manual-order
zod body), `modules/admin/orders.ts` (the new GET/POST routes), `modules/admin/views/orders-list.eta` +
`order-detail.eta` (source display).
**Backend (new):** `modules/admin/views/order-new.eta`; tests `tests/manual-order.test.ts`,
`tests/admin.orders-create.test.ts`.

## 9. Rollout

Additive migration (existing orders → `WEBSITE`). No new deps, no frontend/storefront change. After
Phase 12: Phase 13 analytics (reads `Order.source` + order/item data for insights).
