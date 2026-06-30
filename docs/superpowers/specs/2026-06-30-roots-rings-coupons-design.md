# Roots & Rings — Phase 4 Design Spec (Coupons & discounts)

**Date:** 2026-06-30
**Status:** Approved
**Builds on:** Phases 1–3 (catalog + admin, checkout core, customer accounts). This phase adds
discount codes applied through the existing server-side checkout re-pricing.

## 0. Decisions (confirmed)

- **Types:** PERCENT and FIXED only. No free-shipping coupon (shipping is always ৳0 today, so it
  would have no monetary effect; deferred until a shipping-fee model exists).
- **Targeting:** whole-order (applies to the order **subtotal**). No product/collection targeting.
- **Usage limits:** an optional **global cap** (`maxRedemptions`) AND an optional **per-customer
  limit** (`perCustomerLimit`) — enforced by `customerId` for logged-in buyers, by `email` for
  guests — plus validity window and minimum-order.
- **Apply UX:** **live preview** — the customer applies the code at checkout, the server validates
  + previews the discount, and the order re-validates and **redeems** on submit.

## 1. Goals & non-goals

**Goals**
- A `Coupon` + `CouponRedemption` model and a validation/compute service.
- Public **preview** endpoint (`POST /api/coupons/validate`) — no side effects.
- Checkout integration: optional `couponCode`, validated + redeemed **inside the order
  transaction**, concurrency-safe against the global cap; sets `Order.discountTotal` + `couponCode`.
- Admin coupon CRUD (server-rendered, CSRF + audit) with usage counts.
- Storefront: a discount-code field + discount line on checkout, confirmation, and account order
  detail. On-brand, no redesign.
- Tests incl. a concurrent-redemption (no over-redeem) proof + idempotent-replay (no double-redeem).

**Non-goals (later phases)**
- Free-shipping coupons (needs a shipping-fee model), product/collection-targeted coupons,
  coupon stacking, automatic/cart-level promotions, BOGO, gift cards/store credit.

## 2. Architecture

- New backend module `backend/src/modules/coupons/` — `service.ts` (validate/compute/redeem),
  `errors.ts` (`CouponError`), `schemas.ts` (zod), `routes.ts` (public validate).
- A shared `priceItems(prisma, items)` helper extracted from the checkout service so checkout and
  the validate endpoint compute the subtotal identically (DRY). Lives in
  `backend/src/modules/checkout/pricing.ts`.
- Checkout integration in `modules/checkout/{service,schemas,routes}.ts`.
- Admin in `backend/src/modules/admin/coupons.ts` + eta views.
- Storefront: a coupon island + a BFF validate endpoint; checkout page/script + order DTO updated.

## 3. Schema additions (Prisma)

Enum `CouponType { PERCENT FIXED }`.

- **Coupon**: id, `code` (@unique — stored UPPERCASE, trimmed), description?, `type` (CouponType),
  `value` (Decimal(12,2) — 0–100 for PERCENT, BDT amount for FIXED), `minOrderSubtotal`
  (Decimal(12,2) @default 0), `maxRedemptions` (Int?), `perCustomerLimit` (Int?),
  `startsAt` (DateTime?), `endsAt` (DateTime?), `isActive` (Boolean @default true),
  `timesRedeemed` (Int @default 0 — denormalized counter for fast cap checks), createdAt, updatedAt.
  Relation: `redemptions`.
- **CouponRedemption**: id, `couponId` (→Coupon, cascade), `orderId` (String — plain column, like
  inventory; links to the Order), `customerId` (String?, null for guests), `email` (String, lower),
  `amount` (Decimal(12,2) — discount applied), createdAt. Indexes: (couponId), (couponId, customerId),
  (couponId, email).
- **Order**: add `couponCode String?` (snapshot of the code used). `discountTotal` already exists.

Additive migration only (no changes to Phase 1–3 tables besides the new `Order.couponCode` column).

## 4. Coupon service (`modules/coupons/service.ts`)

- `normalizeCode(code): string` → `code.trim().toUpperCase()`.
- `computeDiscount(coupon, subtotal): number` — PERCENT → `round2(subtotal * Number(value) / 100)`;
  FIXED → `Number(value)`. Then clamp to `min(discount, subtotal)` so the discount never exceeds the
  subtotal (grand total ≥ 0). Uses `round2` from `lib/money`.
- `validateCoupon(db, code, ctx): Promise<{ coupon, discount }>` where
  `ctx = { subtotal: number; customerId?: string; email?: string }`. Loads the coupon by normalized
  code; throws `CouponError(400, message)` if: not found / `!isActive`; now `< startsAt` or
  `> endsAt`; `subtotal < minOrderSubtotal`; `maxRedemptions != null && timesRedeemed >= maxRedemptions`;
  per-customer over limit (when `perCustomerLimit != null`: count `CouponRedemption` for this coupon
  filtered by `customerId` if present else by `email`, and reject if `>= perCustomerLimit`). On success
  returns `{ coupon, discount: computeDiscount(coupon, subtotal) }`. **No writes.**
- `redeemCoupon(tx, code, ctx): Promise<{ coupon, discount }>` — for use **inside** the checkout
  transaction. Row-locks the coupon: `tx.$queryRawUnsafe('SELECT id, timesRedeemed AS timesRedeemed,
  maxRedemptions AS maxRedemptions FROM Coupon WHERE code = ? AND isActive = true FOR UPDATE', code)`,
  re-runs the full `validateCoupon` checks against the locked row (window, min-order, global cap,
  per-customer limit), then `tx.coupon.update({ where:{id}, data:{ timesRedeemed:{ increment:1 } } })`
  and `tx.couponRedemption.create({ data:{ couponId, orderId, customerId, email, amount } })`. Returns
  `{ coupon, discount }`. Throws `CouponError` (rolls back the order) if invalid at submit time.

`CouponError` (`modules/coupons/errors.ts`): `class CouponError extends Error { statusCode = 400;
constructor(message) }` (rendered by the existing error plugin).

## 5. Public preview endpoint (`modules/coupons/routes.ts`)

- `POST /api/coupons/validate` (rate-limited 30/min, preHandler `customerContext`). Body zod:
  `{ code: string; items: {slug, qty}[] }`. Computes `subtotal` via `priceItems`; calls
  `validateCoupon(prisma, code, { subtotal, customerId: req.customerClaims?.sub, email: undefined })`.
  Returns `{ valid: true, code, type, discount, subtotal, newTotal: round2(subtotal - discount),
  message }` on success, or `{ valid: false, message }` with HTTP 200 (so the storefront can show the
  reason inline; the `CouponError` message is surfaced in `message`). Guest email isn't known at
  preview time, so the per-customer/email limit is only fully enforced at redemption (documented).

## 6. Checkout integration

- `checkoutBody` (schemas) gains `couponCode: z.string().trim().min(1).optional()`.
- `priceItems(prisma, items)` (new `checkout/pricing.ts`) returns the resolved/priced lines + subtotal;
  `placeOrder` uses it (refactor — behavior unchanged for non-coupon orders).
- `placeOrder(prisma, input, customerId?)`: after pricing, if `input.couponCode` is set, call
  `redeemCoupon(tx, normalizeCode(input.couponCode), { subtotal, customerId, email: input.contact.email })`
  inside the existing transaction; set `discountTotal = discount`, `couponCode = normalized`, and pass
  `discount` to `computeTotals(...)`. On `CouponError` the transaction rolls back and the route returns
  the message (HTTP 400). Idempotent replay returns the existing order (redemption already recorded) —
  no double redemption.
- The order's `grandTotal = subtotal - discount` (shipping/tax remain 0).

## 7. Admin (`modules/admin/coupons.ts` + eta views)

`/admin/coupons` (list with `timesRedeemed` / `maxRedemptions`), `/admin/coupons/new` + create,
`/admin/coupons/:id/edit` + update, `/admin/coupons/:id/deactivate` (soft — sets `isActive=false`).
Validation: PERCENT value 0–100; FIXED value > 0; code uppercased + unique (409 on dup). CSRF +
audit-logged, session-guarded, in the existing admin nav. No hard delete (preserves redemption
history).

## 8. Storefront (on-brand, no redesign)

- **BFF**: `frontend/src/pages/api/coupons/validate.ts` (Astro endpoint) proxies to the backend,
  forwarding the `rr_session` cookie as Bearer for per-customer preview.
- **Checkout page** (`checkout.astro`): a "Discount code" input + **Apply** button above the order
  summary, a discount line (`Discount −৳X`) shown when a code is applied, and the recomputed total.
  Reuses existing classes (`input-minimal`, `btn-editorial`, `hairline-*`).
- **Coupon island** (`frontend/src/scripts/checkout.ts`, extended, or a small `coupon.ts`): on Apply,
  POST the cart items to `/api/coupons/validate`; on success store the code + discount and re-render the
  summary; on failure show the message. The validated `couponCode` is included in the `/api/checkout`
  payload. The discount preview is advisory; the server is authoritative on submit.
- **Order DTO** (`orders/dto.ts`): add `couponCode` and keep `totals.discount`. The confirmation page
  (`checkout/success.astro`) and account order detail (`account/orders/[orderNumber].astro`) show a
  discount line + code when `discount > 0`.

## 9. Security & correctness

- Server-side authority: the discount is always recomputed + re-validated server-side at submit; the
  client preview is never trusted. Codes are normalized (trim+uppercase) consistently.
- **Concurrency:** the global cap is enforced via `SELECT … FOR UPDATE` on the coupon row inside the
  ReadCommitted checkout transaction (same pattern as inventory). A concurrent-redemption test proves
  no over-redemption on `maxRedemptions = 1`.
- Discount clamped to subtotal (no negative totals). Rate-limited validate endpoint. Admin coupon
  mutations are CSRF-protected + audit-logged.
- Per-customer limit: authoritative at redemption (customerId for logged-in, email for guests).

## 10. Testing

- **Unit**: `computeDiscount` (percent, fixed, clamp-at-subtotal, rounding); `validateCoupon`
  (inactive, before-window, after-window, below-min-order, global cap reached, per-customer limit).
- **Concurrency**: N parallel `redeemCoupon` on `maxRedemptions=1` → exactly one succeeds.
- **Integration (`.inject()`)**: `POST /api/coupons/validate` preview (valid + each invalid reason);
  checkout applies a coupon (order `discountTotal` + `couponCode` set, `CouponRedemption` row created,
  `timesRedeemed` incremented, grand = subtotal − discount); checkout with an invalid/expired code →
  400, no order; idempotent replay → no second redemption; per-customer limit blocks a 2nd order.
- **Admin**: create (PERCENT + FIXED), list shows usage, deactivate hides from validation.
- Existing 102 backend + 43 frontend tests stay green.

## 11. File structure

**Backend (new):** `modules/coupons/{service,errors,schemas,routes}.ts`,
`modules/checkout/pricing.ts`, `modules/admin/coupons.ts` + `modules/admin/views/coupons-*.eta`.
**Backend (modified):** `prisma/schema.prisma` (+ migration), `modules/checkout/{service,schemas}.ts`,
`modules/orders/dto.ts`, `modules/admin/index.ts` + nav, `app.ts` (register coupon routes), seed
(a couple of demo coupons).
**Frontend (new):** `src/pages/api/coupons/validate.ts`. **Frontend (modified):**
`src/pages/checkout.astro`, `src/lib/checkout.ts` (coupon apply + summary), `checkout/success.astro`,
`account/orders/[orderNumber].astro`.

## 12. Rollout

Additive migration; guest + account checkout unchanged when no code is used. No new env vars. After
Phase 4: reviews & ratings, real SMTP + job worker, wishlist, then SEO/enhancements.
