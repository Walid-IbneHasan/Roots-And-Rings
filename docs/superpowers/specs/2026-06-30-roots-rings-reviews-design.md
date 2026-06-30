# Roots & Rings — Phase 5 Design Spec (Reviews & ratings)

**Date:** 2026-06-30
**Status:** Approved
**Builds on:** Phases 1–4 (catalog + admin, checkout, customer accounts, coupons). This phase adds
purchase-gated product reviews + a denormalized rating shown across the storefront.

## 0. Decisions (confirmed)

- **Eligibility:** only **delivered-order buyers** — a logged-in customer may review a product only
  if they have an `OrderItem` for it in an `Order` with status `DELIVERED` and their `customerId`.
- **Moderation:** **auto-publish + take-down** — a submitted review is `PUBLISHED` immediately; an
  admin can `HIDDEN` (toggle) or delete it. No pending queue.
- **Content:** 1–5 **star rating (required)** + optional **title** + optional **body** (sanitized).
- **Entry points:** the **product page** (rating summary + reviews list + write form) AND a
  **"Review this item"** link on each line of the account order-detail page (which deep-links to the
  PDP write form — one form, no duplication).

## 1. Goals & non-goals

**Goals**
- `Review` model (one per customer per product, editable) + denormalized `ratingAvg`/`ratingCount`
  on `Product`.
- Server-enforced purchase gate; sanitized body; rate-limited submit.
- Public reviews list + ratings in the product DTO (detail and list).
- Account submit + can-review endpoints (through the existing `/api/account/*` BFF proxy).
- Admin moderation: list, hide/unhide, delete (recompute aggregate; CSRF + audit).
- Storefront (on-brand): PDP rating summary + list + gated write form; product-card stars; account
  order-detail review links.
- Tests incl. eligibility (delivered vs not vs other-customer), aggregate recompute, hide-drops-from-public.

**Non-goals (later phases)**
- Helpful/"was this useful" votes, photo reviews, replies/Q&A, review reminder emails, sort/filter
  of reviews, a verified-purchase badge beyond the gate itself.

## 2. Architecture

- New backend module `backend/src/modules/reviews/` — `service.ts` (eligibility, aggregate,
  upsert), `errors.ts` (`ReviewError`), `schemas.ts` (zod), `routes.ts` (public list + account
  submit/can-review).
- Admin in `backend/src/modules/admin/reviews.ts` + eta views.
- Ratings denormalized on `Product` so catalog list + PDP reads stay single-query.
- Storefront: PDP (`frontend/src/pages/objects/[slug].astro`) + the product card component + the
  account order-detail page; a `reviews.ts` client island. Submit/can-review go through the existing
  Phase-3 `/api/account/[...path].ts` BFF proxy (cookie → Bearer); the public reviews list is
  SSR-fetched from the backend.

## 3. Schema additions (Prisma)

Enum `ReviewStatus { PUBLISHED HIDDEN }`.

- **Review**: id, `productId` (→Product, cascade), `customerId` (→Customer, cascade), `rating`
  (Int, 1–5), `title` (String?), `body` (String?, sanitized), `authorName` (String — snapshot of the
  customer's display name at submit time), `status` (ReviewStatus @default PUBLISHED), createdAt,
  updatedAt. **`@@unique([productId, customerId])`** (one review per customer per product). Indexes
  `(productId, status)`, `(customerId)`.
- **Product**: add `ratingAvg Decimal? @db.Decimal(3, 2)` and `ratingCount Int @default 0`, plus the
  back-relation `reviews Review[]`.
- **Customer**: add the back-relation `reviews Review[]`.

Additive migration only.

## 4. Reviews service (`modules/reviews/service.ts`)

- `canReview(db, customerId, productId): Promise<boolean>` — `true` iff
  `db.orderItem.findFirst({ where: { productId, order: { customerId, status: 'DELIVERED' } } })`
  returns a row.
- `recomputeProductRating(db, productId): Promise<void>` — aggregates PUBLISHED reviews
  (`_avg.rating`, `_count`) and writes `Product.ratingAvg` (rounded to 2dp, or null when count 0) +
  `Product.ratingCount`. Called after every create/edit/hide/unhide/delete.
- `upsertReview(db, customerId, productId, authorName, input): Promise<Review>` — throws
  `ReviewError(403)` if `!canReview`; sanitizes `body` (existing `lib/sanitize`); upserts by
  `(productId, customerId)` setting `status = PUBLISHED`, `rating`, `title`, `body`, `authorName`;
  then `recomputeProductRating`. (Re-submitting an existing review edits it and re-publishes.)

`ReviewError` (`modules/reviews/errors.ts`): `class ReviewError extends Error { statusCode; constructor(statusCode, message) }`.

## 5. Endpoints

**Public** (`modules/reviews/routes.ts`):
- `GET /api/products/:slug/reviews?page&pageSize` — PUBLISHED reviews for the product, newest first,
  paginated (pageSize ≤ 50). Returns `{ items: [{ id, rating, title, body, authorName, createdAt }],
  total, ratingAvg, ratingCount }`.
- `ratingAvg` (number|null) + `ratingCount` are added to the existing product DTO in
  `modules/catalog/service.ts` — both the detail mapper and the list mapper (for card stars).

**Customer** (authed; reached via the existing `/api/account/*` proxy, so they live under
`/api/account/reviews`):
- `POST /api/account/reviews` `{ productSlug, rating(1–5), title?, body? }` → resolves the product,
  `upsertReview` with the customer's id + name → returns the review (or 403 if not eligible, 404 if
  the slug is unknown, 400 on a bad rating).
- `GET /api/account/reviews/can-review?slug=` → `{ eligible: boolean, review: {rating,title,body}|null }`
  so the PDP renders the correct state (write / edit / "available once delivered" / "sign in").

These two are added to the existing `modules/account/routes.ts` (so they sit in the `/api/account/*`
namespace behind `requireCustomer`, consistent with Phase 3) and call the reviews service. The
storefront reaches them through the existing `/api/account/[...path]` BFF proxy.

**Admin** (`modules/admin/reviews.ts`): `GET /admin/reviews` (list, filter by status + product
search), `POST /admin/reviews/:id/hide`, `POST /admin/reviews/:id/unhide`,
`POST /admin/reviews/:id/delete` — each recomputes the product aggregate, CSRF-protected +
audit-logged, in the admin nav.

## 6. Storefront (on-brand, no redesign)

- **PDP** (`objects/[slug].astro`): a rating summary (a star row from `ratingAvg` + the count) near
  the title; a **Reviews** section that SSR-fetches `GET /api/products/:slug/reviews` and lists them
  (author, stars, title, body, date); and a write area driven by a `reviews.ts` island:
  - If a session exists, the island calls `GET /api/account/reviews/can-review?slug=` and shows
    either an editable form (rating select + title + body) or "You can review this once your order is
    delivered." If editing, the form is pre-filled.
  - If no session, a "Sign in to review" link.
  - Submitting POSTs to `/api/account/reviews` (proxy attaches the Bearer); on success the section
    reloads. Reuses existing classes (`input-minimal`, `btn-solid`, `hairline-*`, `text-*`).
- **Product card** (the component used by `objects/index.astro` and related lists): a compact star +
  `ratingCount` when `ratingCount > 0`.
- **Account order detail** (`account/orders/[orderNumber].astro`): when the order is `DELIVERED`,
  each line shows a "Review this item" link to `/objects/<slug>#reviews` (deep-link to the PDP write
  form). The order-detail backend route (`GET /api/account/orders/:orderNumber`) `include`s each
  item's product to expose `slug` on the order-item DTO; an item whose product can't be resolved
  (legacy/null `productId`) simply omits the link.

## 7. Security & correctness

- **Purchase gate is server-side** in `upsertReview`/`canReview`; the client cannot bypass it (the
  PDP form is a convenience; the POST re-checks).
- Body sanitized (`sanitize-html`); title stored/escaped as plain text; rating clamped to 1–5 by zod.
- Submit rate-limited (e.g., 20/min); one review per `(product, customer)` enforced by the unique
  index (upsert edits rather than duplicates).
- Admin moderation CSRF-protected + audit-logged. `HIDDEN` reviews never appear in the public list or
  the aggregate (`recomputeProductRating` counts PUBLISHED only).

## 8. Testing

- **Unit**: `canReview` (delivered order → true; PROCESSING/other status → false; other customer →
  false); `recomputeProductRating` (avg + count over PUBLISHED only).
- **Integration (`.inject()`)**: eligible submit → review PUBLISHED + `Product.ratingAvg/Count`
  updated; ineligible submit → 403; bad rating (0 or 6) → 400; re-submit → edits (one row, not two);
  `GET /api/products/:slug/reviews` returns only PUBLISHED; can-review reflects eligibility + existing
  review; admin hide → drops from the public list and the aggregate, unhide restores; delete removes
  + recomputes.
- **Admin**: list + hide/unhide/delete.
- Existing 122 backend + 43 frontend tests stay green.
- **Browser pass**: admin marks a COD order `DELIVERED` → that customer reviews the product on the PDP
  → review + stars show → product card shows the rating → admin hides it → it disappears.

## 9. File structure

**Backend (new):** `modules/reviews/{service,errors,schemas,routes}.ts`,
`modules/admin/reviews.ts` + `modules/admin/views/reviews-list.eta`.
**Backend (modified):** `prisma/schema.prisma` (+ migration), `modules/catalog/service.ts` (ratings in
the product DTO), `modules/account/routes.ts` (the two customer review endpoints), the account
order-detail route + `modules/orders/dto.ts` (item `slug`), `modules/admin/index.ts` + nav, `app.ts`
(register the public review routes), seed (optional demo review on a delivered demo order).
**Frontend (new):** `src/scripts/reviews.ts`. **Frontend (modified):** `src/pages/objects/[slug].astro`,
the product-card component, `src/pages/account/orders/[orderNumber].astro`.

## 10. Rollout

Additive migration; no new env vars. Catalog/checkout are unchanged except for the added rating
fields (default null/0 until reviews exist). Because eligibility requires a `DELIVERED` order, the
browser pass marks a demo order delivered first. After Phase 5: real SMTP + job worker, wishlist,
then SEO/enhancements.
