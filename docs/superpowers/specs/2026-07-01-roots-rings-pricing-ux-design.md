# Roots & Rings — Phase 11 Design Spec (category image upload + sale/flash price display + flash section)

**Date:** 2026-07-01
**Status:** Approved
**Builds on:** Phase 1 (catalog/admin + `uploadsService`), Phase 2 (pricing/`resolvePrice`). Three
admin/storefront gaps surfaced during a live walkthrough. The backend pricing engine is already correct;
these are presentation + admin-UX fixes.

## 0. Decisions (confirmed)

- **A — Category image upload:** a file picker on the category new/edit form that uploads via the
  existing `uploadsService` and fills the `imageUrl` field. Works on the create form itself.
- **B — Sale/flash price display:** show the struck-through original + sale price + a `−N%` badge on
  product cards and the PDP (the data already exists: `compareAt`/`isOnSale`/`isOnFlash`).
- **C — Flash-sale section:** a "⚡ Flash Sale" section on the **home page**, shown only when products
  are currently in their flash window.
- **All uploaded images are WebP** — already guaranteed by `uploadsService.processImage` (sniff → rotate
  → strip → resize ≤1600px → **WebP q80** → `.webp`); category uploads route through the same service.

## 1. Goals & non-goals

**Goals:** admins upload category images from device (WebP); shoppers see sale/flash discounts
(strike-through + %); a home flash-sale section surfaces active flash products.

**Non-goals:** a flash countdown timer, a dedicated `/flash` page, per-variant price display on cards,
changing the pricing engine, a general media library.

## 2. Part A — Category image upload

**New generic route `POST /admin/uploads/image`** (`preHandler: requireAdminSession`, no CSRF — mirrors
the existing `/admin/products/:id/images` multipart route): reads `req.file()`, `file.toBuffer()`,
validates `kind` (one of `products`/`categories`/`avatars`, default `categories`) from a query param,
calls `uploadsService.processImage(buffer, kind)` → returns `{ url }` JSON (400 on a non-image, via the
service's magic-byte sniff). This keeps the category create/edit handlers **unchanged** (they still read
`imageUrl` from the urlencoded body) and sidesteps CSRF-on-multipart.

**`category-form.eta`:** next to the existing "Image URL" field, add
`<input type="file" accept="image/*" data-upload>` + a small preview `<img>` + an inline script: on file
select, `POST` the file (as `FormData`) to `/admin/uploads/image?kind=categories`, then set the
`imageUrl` input to the returned `url` and show the preview. The URL field stays (editable / paste-able).

Result: pick a photo on the create or edit form → it uploads as WebP → the URL fills in → submit as
normal. (Product image upload is unchanged.)

## 3. Part B — Sale/flash price display

**Frontend `schema.ts`:** add to the product schema `compareAt: z.number().nullable().default(null)`,
`isOnSale: z.boolean().default(false)`, `isOnFlash: z.boolean().default(false)`.
**Frontend `api.ts`:** map the three fields through from the backend product response (defaults keep old
data safe); they already exist on the backend DTO (`resolvePrice`).
**`format.ts`:** add a pure `discountPercent(price: number, compareAt: number): number` =
`Math.round((compareAt - price) / compareAt * 100)`.
**`ProductCard.astro` + `objects/[slug].astro` (PDP):** where the price renders, when
`compareAt != null && compareAt > price` show `<s>compareAt</s>` (struck-through, muted) + the sale
`price` + a `−{discountPercent}%` badge; otherwise just the price (current behavior). Reuse existing
Tailwind classes (`line-through`, `opacity`, a small on-brand badge) — no layout redesign. This covers
both sale and flash (both set `compareAt`).

## 4. Part C — Flash-sale home section

**Backend `catalog/service.ts` `getFlashProducts(prisma, limit = 8)`:** query
`where: { isActive: true, flashPrice: { not: null }, flashStartAt: { lte: now }, flashEndAt: { gte: now } }`
(+ the shared `include`), `mapProduct` each, then keep only `p.isOnFlash` (so `resolvePrice`'s
`flashPrice < basePrice` rule is enforced), capped at `limit`. **Route** `GET /api/products/flash` →
returns the DTO array.
**Frontend `api.ts` `fetchFlash()` + `catalog.ts` `getFlash()`** → `GET /api/products/flash`.
**`components/home/FlashSale.astro`:** `await getFlash()`; if empty, render nothing; else a section with a
"⚡ Flash Sale" heading + the products via `ProductCard` (so Part B's `−%` shows). Added to
`index.astro` right after `<Hero />`.

## 5. Security & correctness

- The upload route is `requireAdminSession` + validates `kind` against the allowed set (no arbitrary
  directory); `processImage` validates the file by magic bytes (rejects non-images) and always outputs
  WebP. Same origin, admin-only.
- Price fields are server-derived; the frontend `default`s keep partial/older payloads safe.
- `getFlashProducts` filters by the live flash window server-side; an expired/future/no-flash product
  never appears; `isOnFlash` post-filter enforces `flashPrice < basePrice`.

## 6. Testing

- **Backend:** `getFlashProducts` — an active-flash product appears; an expired-window / no-flashPrice one
  doesn't. The `/admin/uploads/image` route — a valid image → `{url}` ending `.webp`; a non-image → 400.
- **Frontend:** `discountPercent` (500,300 → 40; equal → 0). Extend `structured-data`/price tests as
  needed.
- **Regression:** existing 159 backend + 52 frontend stay green; storefront build passes.
- **Live (running admin + storefront):** create a category, upload a photo → saved as `/uploads/categories/*.webp`;
  set a product `salePrice < basePrice` → card + PDP show `~~৳500~~ ৳300 −40%`; set a `flashPrice` with an
  active window → the product appears in the home Flash Sale section with its discount.

## 7. File structure

**Backend:** new `admin/uploads-route.ts` (or add the route to an existing admin file) for
`POST /admin/uploads/image`; modify `catalog/service.ts` (+ `getFlashProducts`), `catalog/routes.ts`
(+ `/api/products/flash`), `admin/views/category-form.eta`; tests `tests/admin.uploads.test.ts`,
`tests/catalog.flash.test.ts`.
**Frontend:** modify `lib/schema.ts`, `lib/api.ts`, `lib/catalog.ts`, `lib/format.ts`,
`components/product/ProductCard.astro`, `pages/objects/[slug].astro`, `pages/index.astro`; new
`components/home/FlashSale.astro`; test `tests/format.test.ts` (+ discountPercent).

## 8. Rollout

No migration (uses existing `salePrice`/`flashPrice`/`imageUrl`/variant columns). No new deps (sharp,
multipart, nanoid already present). After Phase 11: bKash live, i18n, order-status emails, Meilisearch,
infra.
