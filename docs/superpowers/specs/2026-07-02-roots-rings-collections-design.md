# Roots & Rings — Phase 14 Design Spec (collections: separate admin section + storefront collection pages)

**Date:** 2026-07-02
**Status:** Approved
**Builds on:** Phase 1 (catalog + admin categories + `Category.kind`), Phase 11 (category image upload).
Surfaced during a live walkthrough: collections were hard to find in the admin (buried under Categories),
and clicking a collection on the storefront dumped the user into the full catalog (no per-collection page).

## 0. Decisions (confirmed)

- **Category vs Collection are two separate things.** A **Category** is a product *type* (`Category.kind =
  PRODUCT_TYPE`); a product has exactly one primary category (`Product.categoryId`). A **Collection**
  (`Category.kind = COLLECTION`) is a curated grouping; a product **optionally** belongs to zero or more
  collections (the existing M:N `Product.collections` — kept multi-select).
- **Admin:** a dedicated **Collections** section, separate from Categories, so collections are
  discoverable and creatable on their own. (Collection creation already works today via Categories → Kind;
  this makes it findable. It is NOT a code bug — verified: the CSRF-protected create flow works in the
  browser; a curl reproduction only 403s due to session-CSRF handling.)
- **Collection image** already supported by the category form (Phase 11) — reused unchanged.
- **Storefront:** each collection gets its own page `/collections/[slug]` — a hero + that collection's
  products, with a **filter by category** within the collection. Layout: hero + product grid (not the full
  `/objects` sidebar).
- Phase 13 (analytics) already merged to `main`. Phase 14 builds on a fresh branch.

## 1. Goals & non-goals

**Goals:** collections are a first-class, discoverable admin section; every collection has a real
storefront page showing its products, filterable by category; the collections list links to those pages.

**Non-goals:** collection nesting/tree; reducing collections to single-select per product; per-collection
sort/pagination; storefront filters beyond category; changing the pricing/catalog engine; changing the
product form's existing category/collection controls (only verified).

## 2. Data model (no schema change)

Uses the existing `Category` model (`kind: PRODUCT_TYPE | COLLECTION`, `name`, `slug`, `imageUrl`,
`tagline`, `description`, `sortOrder`, `isActive`) and the existing relations: `Product.category`
(`ProductType`, the primary product-type) and `Product.collections` (`ProductCollections`, M:N). No
migration.

## 3. Admin — separate Collections section

The existing `admin/categories.ts` handlers are generalized to be **kind-scoped**, serving two parallel
route groups that share the same logic + form (DRY):

- **Categories** (`/admin/categories*`) — scoped to `kind = PRODUCT_TYPE`. List shows only product types;
  create/edit fix `kind = PRODUCT_TYPE`.
- **Collections** (`/admin/collections*`) — scoped to `kind = COLLECTION`. `GET /admin/collections`
  (list), `GET /admin/collections/new`, `POST /admin/collections/new`, `GET /admin/collections/:id/edit`,
  `POST /admin/collections/:id/edit`, `POST /admin/collections/:id/delete`. Create/edit fix
  `kind = COLLECTION`.
- Shared `category-form.eta`: the **Kind `<select>` is replaced by a hidden field** whose value is set by
  the route context (PRODUCT_TYPE vs COLLECTION); the **parent** field is shown only for categories
  (collections aren't a tree). All other fields (name, slug, image upload, tagline, description, sortOrder,
  isActive, SEO) unchanged. Form `action` and the "Cancel"/redirect targets point back to the correct
  section.
- **Nav:** add a **"Collections"** link in `layout.eta` (after Categories); it is `active` on
  `/admin/collections*`. The Categories list keeps its own active state.
- **Delete guard:** deleting a collection just removes the `Category` row + its M:N links (existing
  `onDelete` behavior); products are unaffected.
- **Product form:** unchanged — confirm the category `<select>` lists only `PRODUCT_TYPE` and the
  collections multi-select lists only `COLLECTION` (already the case). No edits unless the category
  dropdown currently shows all kinds, in which case scope it to `PRODUCT_TYPE`.

The kind-scoping keeps one implementation; a reviewer must confirm no route/redirect crosses kinds (a
collection edit redirects to `/admin/collections`, a category edit to `/admin/categories`).

## 4. Storefront — individual collection pages

**Backend (`catalog/service.ts` + `catalog/routes.ts`):**
- `getProductsByCollection(prisma, slug): Promise<ProductDTO[]>` — active products in the collection:
  `product.findMany({ where: { isActive: true, collections: { some: { slug, kind: 'COLLECTION' } } },
  include: <shared include>, orderBy: … })` → `mapProduct` each. Returns `[]` for an unknown/empty
  collection.
- Route `GET /api/collections/:slug/products` → the DTO array (200; `[]` if none). The existing
  `GET /api/collections/:slug` (collection meta) stays.

**Frontend:**
- `api.ts` `fetchCollectionProducts(slug)` → `GET /api/collections/:slug/products` (maps via `toProduct`).
  `catalog.ts` `getCollectionProducts(slug)`. `getCollection(slug)` (meta) already exists.
- **`pages/collections/[slug].astro`** (SSR): loads collection meta + products. If the collection doesn't
  exist → return Astro 404. Renders:
  - a **hero** band (collection `image` + `name` + `tagline`/`description`) — reusing the `/objects`/
    `/collections` hero styling; degrade gracefully when tagline/description are empty.
  - a **category filter**: the distinct product-`category` values among the collection's products, as
    filter chips ("All" + each). Clicking filters the visible grid **client-side** (each product cell
    carries `data-category`; a small inline script toggles visibility + updates an "N pieces" count) —
    mirroring the existing `/objects` client-side filter pattern. If ≤1 category is present, the filter row
    is hidden.
  - a **product grid** of `ProductCard`s (same card + `sizes` as `/objects`).
  - **empty collection** → a centered "No pieces in this collection yet." message (no grid).
  - `breadcrumbSchema` (Home → Collections → <name>) + `itemListSchema` of the products (consistent with
    `/objects`).
- **`pages/collections.astro`** (listing): change each card's `href` from `/objects` to
  `/collections/${c.slug}`.
- **`pages/sitemap.xml.ts`:** add each collection's `/collections/<slug>` URL (fetch collections; append
  to the URL set) alongside the existing static + product paths.

## 5. Security & correctness

- Admin collections routes are admin-only (`requireAdminSession`) + CSRF-protected on writes
  (`authedWrite`), identical to the existing categories routes. Kind is forced server-side by the route
  (a client cannot create a `PRODUCT_TYPE` via the collections form or vice-versa).
- `getProductsByCollection` filters `isActive: true` + `kind: 'COLLECTION'` server-side; an inactive
  product or a product not in the collection never appears. Unknown slug → `[]` (page 404s on missing
  collection meta, not on empty products).
- The storefront category filter is client-side over already-fetched, already-safe DTO data; product/
  category names are rendered through Astro's default escaping.
- No user input reaches raw SQL (Prisma query builder only). No schema/migration.

## 6. Testing

- **Backend:** `getProductsByCollection` — returns active products in the collection; excludes a product
  not in it and an inactive product; `[]` for an unknown slug. Route `GET /api/collections/:slug/products`
  → 200 + array; unknown slug → 200 + `[]`. Admin: `GET /admin/collections` lists only COLLECTION rows +
  has a "New collection" action; `POST /admin/collections/new` creates a row with `kind = COLLECTION` and
  redirects; `GET /admin/categories` lists only PRODUCT_TYPE rows; a collection create cannot set
  PRODUCT_TYPE (kind forced).
- **Frontend:** `astro build` passes; a unit test for `toProduct` mapping via the new fetch if useful.
  (No `astro check`, no new deps — per standing constraints.)
- **Regression:** existing 194 backend + 53 frontend stay green.
- **Live:** in the admin, open the new **Collections** section → create a collection with an image → tag a
  couple of products into it (product form) → visit `/collections` (card links to the collection) →
  `/collections/<slug>` shows the hero + products → filter by category narrows the grid → an empty
  collection shows the friendly message.

## 7. File structure

**Backend (modified):** `modules/admin/categories.ts` (kind-scoping + collections route group),
`modules/admin/views/category-form.eta` (hidden kind + conditional parent), `modules/admin/views/
categories.eta` (kind-scoped list / "New" label), `modules/admin/views/layout.eta` (Collections nav link),
`modules/admin/index.ts` (register the collections routes if split), `modules/catalog/service.ts`
(`getProductsByCollection`), `modules/catalog/routes.ts` (`/api/collections/:slug/products`).
**Backend (new tests):** `tests/catalog.collection-products.test.ts`, `tests/admin.collections.test.ts`.
**Frontend (modified):** `lib/api.ts` (+`fetchCollectionProducts`), `lib/catalog.ts`
(+`getCollectionProducts`), `pages/collections.astro` (card links), `pages/sitemap.xml.ts` (+collection
URLs). **Frontend (new):** `pages/collections/[slug].astro`.

## 8. Rollout

No migration, no new deps, no change to the pricing/catalog engine or the product form's controls (only
verification). Existing collections in the DB automatically appear in the new admin section and get
storefront pages. After Phase 14: (candidates) bKash live, order-status emails, i18n, infra.
