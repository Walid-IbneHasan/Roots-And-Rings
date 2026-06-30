# Roots & Rings — Phase 7 Design Spec (Wishlist sync)

**Date:** 2026-06-30
**Status:** Approved
**Builds on:** Phases 1–6. The storefront already has a client-only wishlist (a `localStorage`
array of product slugs, toggled by the heart `WishlistButton` on cards/PDP). This phase persists it
per customer and adds a view.

## 0. Decisions (confirmed)

- **Guest-local + account-synced + merge:** keep the current guest UX (localStorage). When signed in,
  the wishlist is backed by the account; on login the guest list **unions** into the account.
- **A `/wishlist` page** driven by the client wishlist store (works for guests + accounts), rendering
  saved products as cards from the same build-time product lookup the cart uses.
- **Header heart** entry point (icon → `/wishlist`) with a saved-count badge.
- **Workflow note:** Phase 7 is built in the working tree with NO git commits — the user handles all
  git at the end.

## 1. Goals & non-goals

**Goals**
- A `WishlistItem` model + owner-scoped account endpoints (list / add / remove / merge).
- Client sync: detect login via the API, merge local→account on first load, write-through on toggle.
- A `/wishlist` page + a header heart with a count badge.
- Tests for the backend (CRUD + merge + owner-scoping); existing suites stay green.

**Non-goals (later)**
- Wishlist sharing/links, "move all to cart", price-drop / back-in-stock alerts, an account-nav
  wishlist entry (the header heart is the entry), pagination.

## 2. Architecture

The client `$wishlist` (`@nanostores/persistent` atom of slugs in `lib/stores.ts`) stays the on-page
source of truth. A new backend `WishlistItem` table + endpoints in the **account module** sit behind
the existing `/api/account/[...path]` BFF proxy (cookie → Bearer). The client probes the wishlist
endpoint to learn whether it's signed in (200 vs 401) and to merge/load; toggles write through when
signed in. The `/wishlist` page renders from the build-time product lookup (`buildCartLookup` /
`lookupToJson`), exactly like the cart page renders its lines client-side.

## 3. Schema additions (Prisma)

- **WishlistItem**: id, `customerId`→Customer (onDelete Cascade), `productId`→Product (onDelete
  Cascade), `createdAt`. `@@unique([customerId, productId])`, `@@index([customerId])`. Customer gains
  the back-relation `wishlist WishlistItem[]`; Product gains `wishlistedBy WishlistItem[]`.

Additive migration only.

## 4. Endpoints (account module, all `requireCustomer`, owner-scoped)

- `GET /api/account/wishlist` → `string[]` — the customer's wishlisted product **slugs**, newest first.
- `POST /api/account/wishlist` `{ slug }` → resolve slug→product (404 if unknown/inactive); idempotent
  `upsert` by `(customerId, productId)`; returns `{ ok: true }`.
- `DELETE /api/account/wishlist/:slug` → resolve slug→product; `deleteMany` by `(customerId, productId)`;
  returns `{ ok: true }` (no-op if absent).
- `POST /api/account/wishlist/merge` `{ slugs: string[] }` → resolve all known slugs, upsert each into
  the account (union; unknown slugs silently ignored), then return the full merged `string[]` (slugs).
  This one call serves both **sync-on-login** and **load**.

Slug resolution uses `product.findFirst({ where: { slug, isActive: true }, select: { id, slug } })`.

## 5. Frontend (on-brand; reuses existing patterns)

- **`src/scripts/wishlist.ts`** (extend the existing island): on init, `POST` the local slugs to
  `/api/account/wishlist/merge`. If `200` → set `$wishlist` to the returned union and mark
  `loggedIn=true`; if `401` → guest, leave the local list. `toggleWishlist(slug)` updates `$wishlist`
  optimistically (as today) and, when `loggedIn`, writes through best-effort (`POST` on add, `DELETE`
  on remove; failures are logged, never block the UI). The existing heart wiring (the
  `[data-wishlist]` buttons + `is-active` class) is unchanged.
- **`src/pages/wishlist.astro`**: `BaseLayout`, the embedded product lookup
  (`lookupToJson(await buildCartLookup())`), and a client island (`src/scripts/wishlist-page.ts`) that
  reads `$wishlist` + the lookup and renders the saved items as cards (image, name, price, a
  remove-heart, link to the PDP), with an empty state ("Your wishlist is empty" → Browse Objects).
  Reuses existing classes only — same client-render-from-lookup approach as `cart.astro`.
- **`src/components/layout/Header.astro`**: add a wishlist heart icon (next to the cart/account icons)
  linking to `/wishlist`, with a `[data-wishlist-count]` badge. A tiny count updater (folded into
  `wishlist.ts` or a small header island) subscribes to `$wishlist` and shows the count (hidden at 0),
  mirroring how the cart-count badge works. Link target + badge only — no visual redesign.

## 6. Security & correctness

- All wishlist endpoints are `requireCustomer` + strictly owner-scoped (`customerId = me.id`); one
  customer can never see or mutate another's wishlist.
- Add/merge resolve slugs server-side (unknown/inactive slugs are ignored/404); duplicate adds are
  no-ops via the unique index.
- Guests never call the API (the island only syncs after a `200`); the httpOnly session cookie isn't
  readable by client JS, so login is inferred from the merge response (`200` vs `401`).
- Write-through failures are swallowed (the local store already reflects the change); no flow breaks on
  a wishlist API hiccup.

## 7. Testing

- **Backend integration (`.inject()`):** add → `GET` lists the slug; duplicate add stays one row;
  `DELETE` removes it; `merge` unions provided slugs (+ ignores an unknown slug) and returns the full
  list; a second customer's `GET` does not see the first's items (owner-scoping); unknown slug on add
  → 404.
- **Regression:** the existing account-orders/profile/address/review suites stay green (the wishlist
  routes are additive in the account module).
- Existing **146 backend + 43 frontend** tests stay green; the storefront build passes.
- **Browser pass:** heart an item as a guest → `/wishlist` shows it + the header badge increments;
  sign in → the guest item merges into the account (and an item saved server-side appears); remove on
  the page syncs to the server.

## 8. File structure

**Backend (new):** `modules/account/wishlist.ts` (the wishlist routes, registered from
`modules/account/routes.ts`), `tests/account.wishlist.test.ts`.
**Backend (modified):** `prisma/schema.prisma` (+ migration), `modules/account/routes.ts` (register
the wishlist routes), `modules/account/schemas.ts` (a small zod body for add/merge) — or inline zod.
**Frontend (new):** `src/pages/wishlist.astro`, `src/scripts/wishlist-page.ts`.
**Frontend (modified):** `src/scripts/wishlist.ts` (sync), `src/components/layout/Header.astro`
(heart + badge), possibly `src/lib/stores.ts` (no change expected — toggle already exists).

## 9. Rollout

Additive migration; no new env vars. Guests are unaffected (local wishlist as today). With the
endpoints live, signing in merges + syncs automatically. After Phase 7: SEO, bKash live, i18n,
enhancements, and the deferred polish items.
