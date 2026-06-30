# Roots & Rings — Backend (Fastify) · Phase 1

A Fastify + Prisma + MySQL backend that exposes a **public catalog API** (consumed by the
Astro storefront) and a **server-rendered admin panel**. Phase 1 covers the foundation,
catalog, and admin back-office; later phases add accounts, cart/orders, payments, etc.

> **Windows note:** the project path contains `&`, which breaks npm's `.cmd` script shims.
> Invoke node entrypoints directly (shown below) instead of `npm run …`.

## Stack

Fastify 5 · TypeScript (strict) · Prisma + MySQL 8 (Docker) · zod (DTO + env validation) ·
@fastify/{helmet, cookie, session, csrf-protection, rate-limit, cors, multipart, static,
swagger} · bcryptjs · sharp (WebP) · sanitize-html · eta (admin views) · Vitest.

## Setup

```bash
# 1) Start MySQL (from repo root)
docker compose up -d db

# 2) Install deps
cd "D:\Roots & Rings\backend"
npm install

# 3) Configure env  (copy .env.example → .env and adjust secrets)
#    DATABASE_URL, SESSION_SECRET (32+), COOKIE_SECRET (32+), ADMIN_EMAIL, ADMIN_PASSWORD, …

# 4) Migrate + seed
node node_modules/prisma/build/index.js migrate deploy
node --env-file=.env --import tsx prisma/seed.ts        # 16 products, 8 categories, admin

# 5) Run the API + admin  (http://localhost:4000, docs at /docs)
node --env-file=.env --import tsx src/server.ts
```

Storefront (separate app, `../frontend`) runs SSR and reads this API:

```bash
cd "..\frontend"
node node_modules/astro/astro.js dev      # http://localhost:4321
```

Admin panel: <http://localhost:4000/admin> (sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`).
Create an extra admin anytime: `node --env-file=.env --import tsx src/scripts/create-admin.ts`.

## Tests

```bash
node node_modules/vitest/vitest.mjs run    # 59 tests (needs the Docker DB running + seeded)
```

## Env vars (validated with zod at boot — see `src/env.ts`)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | MySQL connection string |
| `PORT` | API port (default 4000) |
| `APP_URL` | Backend base URL (used to build absolute image URLs) |
| `STOREFRONT_ORIGIN` | Allowed CORS origin (the Astro storefront) |
| `SESSION_SECRET` / `COOKIE_SECRET` | 32+ char secrets for signed admin sessions |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Bootstrap admin (seed + create-admin) |
| `CRON_TOKEN` | Guards `POST /cron/*` (header `X-Cron-Token`) |
| `BKASH_*` (optional) | bKash sandbox/merchant creds; payments scaffold activates only when all are set |
| `JWT_SECRET` | 32+ char secret for customer JWTs (must be byte-identical in the storefront `.env`) |
| `JWT_EXPIRES_IN` / `OTP_TTL_MIN` / `OTP_MAX_ATTEMPTS` | Customer token lifetime; OTP TTL (min) + attempt cap |

## Public API

`GET /api/health · /api/categories[?kind] · /api/categories/:slug · /api/collections ·
/api/collections/:slug · /api/products[?category,clayBody,attribute,minPrice,maxPrice,onSale,sort,q,page,pageSize] ·
/api/products/:slug · /api/products/:slug/related · /api/featured · /api/facets`
(OpenAPI at `/docs`). Prices resolve **flash → sale → base** at read time.

**Phase 2 (checkout):** `POST /api/checkout` (guest, server-priced, idempotent via
`idempotencyKey`; COD commits inventory immediately, bKash returns a redirect when configured)
· `GET /api/orders/:orderNumber?token=` (guest-safe order lookup) · `POST /cron/expire-orders`
(token-guarded: releases stale reservations, expires unpaid orders).

**Phase 3 (accounts):** `POST /api/auth/{register,login,verify-email,forgot-password,reset-password}`
· `GET /api/auth/me` · `GET /api/account` (dashboard) · `GET /api/account/orders[/:orderNumber]`
(owner-scoped, 404 if not yours) · `PATCH /api/account/profile` · `POST /api/account/avatar` ·
`GET/POST/PATCH/DELETE /api/account/addresses[/:id]` + `/:id/default` · OTP-guarded password change.
All `/api/account/*` and `/api/auth/me` require a customer Bearer token (JWT).

**Phase 4 (coupons):** `POST /api/coupons/validate` (preview — re-prices the cart server-side and
returns the discount, no side effects). Codes are applied at checkout via `couponCode` on
`POST /api/checkout` and redeemed inside the order transaction.

**Phase 5 (reviews):** `GET /api/products/:slug/reviews` (PUBLISHED only + the aggregate); ratings
ride the product DTO (`ratingAvg`/`ratingCount`). Customers submit via `POST /api/account/reviews`
+ `GET /api/account/reviews/can-review?slug=` (purchase-gated, behind the account Bearer).

## Admin (server-rendered, session-guarded, CSRF, audit-logged)

`/admin/login` · `/admin` (dashboard) · `/admin/products` (CRUD + WebP upload + flash/featured +
**stock**) · `/admin/orders` (**list/detail, status transitions, refund→restock, COD settle on
delivered**) · `/admin/categories` (tree CRUD) · `/admin/team` (Admin-only add/delete/role; Staff blocked).

## Phase 2 — implemented vs. deferred

**Implemented (this phase)**
- Schema: Order, OrderItem, Shipment, Payment, PaymentEvent, InventoryMovement,
  InventoryReservation, LowStockNotification, Job. Default variant + stock seeded per product.
- **Concurrency-safe inventory**: `reserveForOrder` uses `SELECT … FOR UPDATE` inside
  ReadCommitted transactions; commit/release/restock/adjust + signed movement ledger.
  Proven by a concurrent-checkout test (exactly one of N wins on stock=1 → no oversell).
- **Checkout**: `POST /api/checkout` — server-side re-pricing, min/max enforcement, idempotency,
  immutable order + shipping snapshots. COD → PROCESSING + commit inventory + confirmation job
  (logged no-op email). bKash → AWAITING_PAYMENT + `PaymentProvider.createSession` (scaffold).
- **Orders API**: `GET /api/orders/:orderNumber?token=` (guest-safe).
- **Order state machine** (validated transitions); **payments** (COD + bKash scaffold,
  markPaymentPaid, refund→restock, PaymentEvent log).
- **Admin orders** back-office + product stock field + inventory movements.
- **Cron**: token-guarded `expire-orders`.
- **Storefront** (on-brand, no redesign): `/checkout` (contact + shipping + COD/bKash, submits
  the localStorage cart to the API) and `/checkout/success` (SSR confirmation). Cart "Proceed to
  Checkout" routes to `/checkout`.

**bKash:** fully built against the Tokenized Checkout API but inactive until `BKASH_*` env is set
(returns `CREDENTIALS_MISSING`, no network calls). Set the vars to activate.

**Deferred to Phase 3+:** customer accounts (JWT/OAuth/OTP)/addresses, backend-persisted
cart/merge, coupons, reviews (purchase-gated), wishlist sync, an always-on job worker (cron loop)
+ real SMTP, SEO/CMS, i18n, redirects, and the enhancements list.

## Phase 3 — implemented vs. deferred

**Implemented (this phase)**
- Schema: Customer, CustomerOtp, Address (additive migration; `Order.customerId` now populated).
- **Customer auth**: register/login/me + email-verify, forgot/reset password. JWT (HS256,
  `JWT_SECRET`), bcrypt. Customer DTO never exposes `passwordHash`; login is generic (no
  enumeration); forgot-password always 200.
- **OTP system**: 6-digit codes, bcrypt-hashed, `OTP_TTL_MIN` expiry, `OTP_MAX_ATTEMPTS` cap,
  single-use, prior-code invalidation. Emails are logged no-ops until SMTP (read codes from the log).
- **Account API** (`requireCustomer`): dashboard, **owner-scoped** order history + detail (404 if
  not yours), profile, avatar (reuses the WebP pipeline @512px), address CRUD + default, OTP-guarded
  password change.
- **Checkout** attaches `customerId` when authenticated (optional `customerContext`); guest
  checkout is unchanged. Storefront pre-fills contact/shipping from the default address.
- **Storefront BFF** (no redesign): Astro `/api/*` endpoints own an httpOnly `rr_session` cookie and
  forward a Bearer to the API — the browser never calls the API directly for authed actions. On-brand
  `/account/*` pages (login, register, dashboard, orders, order detail, profile, addresses, forgot,
  reset, verify). Header Account icon → `/account`.
- Tests: 102 backend + 43 frontend. End-to-end verified (register → OTP-verify → authed order →
  owner-scoped history).

**Security:** httpOnly session cookie (token never exposed to client JS; storefront validates the
JWT server-side for SSR gating, the API re-verifies as the authority), strict owner-scoping (404 on
non-owned), rate-limited auth, hardened login redirect (no open redirect).

**Deferred to Phase 4+:** Google OAuth, real SMTP delivery, claiming guest orders by email,
backend-persisted cart/merge, reviews, wishlist sync, SEO/CMS, and the enhancements list.

## Phase 4 — implemented vs. deferred

**Implemented (this phase)**
- Schema: Coupon, CouponRedemption; `Order.couponCode`. Demo seeds: SAVE20, WELCOME100.
- Coupon service: `computeDiscount` (clamped to subtotal), `validateCoupon` (active, window,
  min-order, global cap, per-customer limit), `redeemCoupon` (**SELECT … FOR UPDATE** — proven by a
  concurrent-redemption test: exactly one wins on cap=1).
- `POST /api/coupons/validate` (preview, no side effects) + checkout integration: `couponCode`
  redeemed inside the order transaction; `discountTotal`/`couponCode` set, payment amount discounted;
  idempotent replay never double-redeems; invalid/expired/cap-reached → order fails cleanly.
- Admin `/admin/coupons` CRUD + deactivate (CSRF + audit). Storefront: apply-at-checkout with live
  preview + discount line on checkout, confirmation, and account order detail (on-brand).
- Tests: 122 backend + 43 frontend. End-to-end verified (preview SAVE20 → COD order with the discount
  applied → discount shown on the confirmation).

**Deferred to later phases**
- Free-shipping coupons (needs a shipping-fee model), product/collection-targeted coupons, stacking,
  automatic/cart-level promotions, BOGO, gift cards/store credit.

## Phase 5 — implemented vs. deferred

**Implemented (this phase)**
- Schema: Review (one per product+customer, PUBLISHED/HIDDEN); denormalized `Product.ratingAvg`/`ratingCount`.
- Reviews service: `canReview` (DELIVERED-order purchase gate), `recomputeProductRating`,
  `upsertReview` (gate + sanitize + recompute). Auto-publish; admin take-down.
- Public `GET /api/products/:slug/reviews` + ratings in the product DTO. Account
  `POST /api/account/reviews` + `GET /api/account/reviews/can-review` (purchase-gated server-side).
- Admin `/admin/reviews` hide/unhide/delete (recompute + CSRF + audit). Storefront: PDP rating summary
  + list + gated write form, product-card stars, "Review this item" links on delivered orders.
- Tests: 138 backend + 43 frontend. End-to-end verified (delivered order → review → shown on the PDP
  + product card → admin hide drops it).

**Deferred to later phases**
- Helpful/"was this useful" votes, photo reviews, replies/Q&A, review reminder emails, sort/filter of reviews.

## Phase 1 — implemented vs. deferred

**Implemented (this phase)**
- Fastify app + plugins; zod env validation; structured errors; `/health`.
- Prisma schema + migrations (User, Category[tree, kind=PRODUCT_TYPE|COLLECTION], Product,
  ProductVariant, ProductImage, AdminAuditLog, Setting); **FULLTEXT(name, shortDescription)**.
- Public catalog API + pricing engine + facets + full-text search.
- Server-rendered admin: session auth (bcrypt), RBAC (ADMIN/STAFF), dashboard, Products CRUD,
  Categories CRUD, Team management with the Admin-vs-Staff boundary + last-admin protection.
- WebP upload pipeline (magic-byte validation, EXIF-rotate, ≤1600px, q80, random names).
- Security: Helmet CSP, rate-limit (tighter on admin login), signed/httpOnly cookies, CSRF on
  admin forms, sanitize-html on rich text, CORS allow-list, cross-origin uploads.
- Audit logging of admin mutations; idempotent seed + create-admin.
- Storefront wired to the live API via SSR (no UI change); currency BDT (৳).

**Deferred to later phases (per the master spec)**
- Customer accounts (JWT/httpOnly cookie), Google OAuth, OTP codes, addresses.
- Cart persistence/merge, checkout & orders (state machine, idempotency), shipments.
- Payments (COD + bKash hosted checkout, PaymentEvent ledger, refunds, reconciliation).
- Coupons, reviews (purchase-gated), wishlist, inventory ledger + concurrency-safe reservations.
- DB-backed job queue + token-guarded cron endpoints; nodemailer notifications.
- SEO (JSON-LD, dynamic sitemap), PageContent CMS, i18n/translations, redirects.
- Enhancements: Redis/BullMQ queue, caching, Meili/Typesense search, observability, couriers,
  more payment providers, etc.

Currency note: products were seeded with their existing numeric prices and `currency = BDT`
(displayed as ৳), adjustable per-product in the admin.
