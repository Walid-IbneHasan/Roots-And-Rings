# Roots & Rings — Phase 15 Design Spec (storefront content & taxonomy refresh)

**Date:** 2026-07-02
**Status:** Approved
**Builds on:** all prior phases. Repositions the storefront from a generic "collectible ceramics /
objects" studio to a **Bangladesh-based handcrafted clay home-décor** brand, renames the catalog from
"Objects" to "Products", renames the `clayBody` taxonomy to `bodyType`, removes the Firing/Glaze spec
fields, and adds home-page polish (Featured Products section, category heading, collection CTA wording).

## 0. Decisions (confirmed)

- **Objects → Products:** rename the catalog route + all links + copy. Frontend-only (backend already says
  "products"). Clean rename, **no `/objects` redirect** (pre-launch).
- **Clay Body → Body Type:** FULL rename of the field `clayBody → bodyType` (frontend + backend + Prisma
  column via a **data-preserving `CHANGE COLUMN` migration**, never drop/add) and all labels.
- **Remove Firing & Glaze from the model:** drop the two spec fields (schema + product spec table + admin
  form inputs + mock spec keys). Prose/collection names/product names are left as-is (managed via admin).
- **Content scope:** model changes + SITE-level copy only. The seeded product & collection DATA (mock
  products, "The First Firing" / "Porcelain & Light" collections) is NOT rewritten — the user manages it
  via the Products/Collections admin.
- **Atelier image:** reuse the existing `interior-kura` studio asset (About keeps `about-hero`).

## 1. Goals & non-goals

**Goals:** the storefront reads as a BD artisan clay home-décor brand; the catalog is "Products"; the body
taxonomy is "Body Type"; Firing/Glaze no longer appear in the model or UI; the home page gains a Featured
Products section + a clear Categories heading + a "View All Collections" CTA; the Atelier page is a real
page.

**Non-goals:** rewriting the ~33 mock products or the seeded collections; changing the pricing/catalog
engine; changing the admin's structure (only the product-form field labels + removing 2 inputs); adding a
`/objects` redirect; making the home CategoryTiles dynamic (they stay the 3 hardcoded tiles + a heading).

## 2. Part A — Objects → Products (frontend route rename)

- **Rename the directory** `frontend/src/pages/objects/` → `frontend/src/pages/products/` (its two files
  `index.astro` + `[slug].astro`), using `git mv` so history is preserved. This changes the routes to
  `/products` and `/products/[slug]`.
- **Update every `/objects` path** → `/products` and `/objects/${slug}` → `/products/${slug}`. Affected
  (from the surface map): `data/navigation.ts` (mainNav/footerNav/minimalFooterNav hrefs), `components/
  layout/Header.astro`, `components/layout/ComingSoon.astro`, `components/cart/CartDrawer.astro`,
  `components/home/{Hero,FlashSale,CategoryTiles,FeaturedCollection}.astro`, `components/product/
  ProductCard.astro`, `components/catalog/LoadMore.astro`, `pages/{cart,checkout,wishlist}.astro`,
  `pages/checkout/success.astro`, `pages/account/{index,orders}.astro`, `pages/account/orders/
  [orderNumber].astro`, `pages/collections/[slug].astro` (itemList JSON-LD product URLs), the renamed
  `pages/products/{index,[slug]}.astro` (canonical, breadcrumb, `?category=` link, login-`next`),
  `lib/cart-lookup.ts`, `lib/structured-data.ts` (`SearchAction` urlTemplate), `pages/sitemap.xml.ts`
  (`STATIC_PATHS` + product `loc`).
- **Update "Objects" copy** → "Products"/"Pieces" where user-facing: Hero H1/subhead (see Part C),
  products `index.astro` H1 "Objects" → "Products" + counter "{n} Objects" → "{n} Products" + empty state
  "No objects match…" → "No products match…", "Browse Objects" → "Browse Products" (CartDrawer, account,
  cart, ComingSoon), "Load More Objects" → "Load More Products", breadcrumb "Objects" → "Products",
  `404.astro` "return you to the objects" → "products", `Header` `aria-label="Search objects"` → "Search
  products". The nav **labels already say "Shop"** — only their hrefs change.

## 3. Part B — Body Type rename + remove Firing/Glaze

**Backend (`clayBody → bodyType`, contract `clayBodies → bodyTypes`):**
- `prisma/schema.prisma`: `Product.clayBody` → `bodyType`. **Migration:** hand-written
  `ALTER TABLE `Product` CHANGE `clayBody` `bodyType` VARCHAR(191) NULL;` (rename, preserves data) — if
  Prisma generates a drop+add, replace it with the CHANGE statement.
- `lib/mappers.ts`: `ProductDTO.clayBody` → `bodyType`, mapped from `p.bodyType`.
- `modules/catalog/service.ts`: `CLAY_BODY_ORDER` → `BODY_TYPE_ORDER`; `Facets.clayBodies` → `bodyTypes`;
  the `select`, `getFacets` builder, and `where.clayBody` → `bodyType`.
- `modules/catalog/schemas.ts`: `clayBody` query param → `bodyType`.
- `modules/admin/products.ts`: form field `clayBody` → `bodyType`; spec `specClayBody` → `specBodyType`;
  **remove `specFiring` + `specGlaze`** (and their `specs.firing`/`specs.glaze` writes).
- `modules/admin/views/product-form.eta`: labels "Clay body" → "Body Type" (top-level + spec); **remove
  the Glaze + Firing inputs**.
- Update backend tests that reference `clayBody`/`clayBodies`/`firing`/`glaze`.

**Frontend (`clayBody → bodyType`, remove firing/glaze display):**
- `lib/schema.ts`: `CLAY_BODIES` → `BODY_TYPES`, `ClayBody` → `BodyType`; `specsSchema.clayBody` →
  `bodyType` and **remove `firing` + `glaze`**; `productSchema.clayBody` → `bodyType`.
- `lib/api.ts`: `ApiProduct.clayBody` → `bodyType`; `toProduct` map; `fetchFacets` return `clayBodies` →
  `bodyTypes`.
- `lib/catalog.ts`: `ProductQuery.clayBodies` → `bodyTypes`; the filter; `Facets.clayBodies` → `bodyTypes`.
- `components/catalog/FilterSidebar.astro`: group key `'clayBody'` → `'bodyType'`, heading "Clay Body" →
  "Body Type", values `facets.bodyTypes`.
- `components/product/SpecTable.astro`: **remove the Glaze + Firing rows**; "Clay Body" → "Body Type",
  value `specs.bodyType`.
- `pages/products/index.astro`: cell attr `data-clay` → `data-bodytype` (value `p.bodyType`).
- `scripts/filters.ts`: `selected('clayBody')` → `'bodyType'`; `cell.dataset.clay` → `dataset.bodytype`;
  update the group comment.
- `data/products.ts`: rename the `clayBody:` keys → `bodyType:` and **remove the `firing:`/`glaze:` keys**
  from each product's specs (VALUES like "Stoneware"/"Porcelain" stay — content is not rewritten).
- Update frontend tests referencing `clayBody`/`clayBodies`/firing/glaze.

The backend facets contract (`bodyTypes`) and the frontend consumer are changed together so `/api/facets`
stays consistent.

## 4. Part C — Site copy (clay home décor, Bangladesh, no porcelain)

Concrete copy (adjustable during spec review):

- **`data/site.ts`:**
  - `title`: `'Roots & Rings — Handcrafted Clay Home Décor'`
  - `description`: `'Handcrafted clay home décor, made with Bangladeshi artisans. Small-batch pottery and
    decorative pieces for the modern home — an ever-growing collection.'`
  - `tagline`: keep `'Crafted with love, rooted in tradition.'`
- **`components/home/Hero.astro`:**
  - H1: `'Shaped by hand, rooted in clay.'`
  - subhead: `'Handcrafted home décor, made with Bangladeshi artisans in small batches.'`
- **`pages/about.astro`** story (lines 42-43, 46-47):
  - `'Roots & Rings is a Bangladesh-based studio making handcrafted clay home décor in small batches.
    Every piece is shaped, finished, and checked by hand — no two are ever quite alike.'`
  - `'We work closely with local artisans, letting the clay and the hand lead. Our range of vessels,
    tableware, and decorative pieces keeps growing as we bring more of their craft into your home.'`
  - Care Guide (line 9): `'Clay surfaces may darken gently with use — this patina is part of a piece's
    character. Wipe clean with a damp cloth and avoid harsh detergents.'`
  - The About H1 (`'Crafted with love, rooted in tradition.'`) + `about-hero` image stay.
- **`components/layout/Newsletter.astro`** default heading: `'Subscribe for early access to new pieces
  and collections.'`
- **`pages/404.astro`:** `'…Let's return you to the products.'`

## 5. Part D — Home page

- **`components/home/FeaturedCollection.astro`:** CTA text `'View All Pieces'` → `'View All Collections'`.
- **`components/home/CategoryTiles.astro`:** add a section header above the tiles — an eyebrow
  `'Shop by Category'` (styled like the FeaturedCollection eyebrow, `text-label-caps uppercase`) + keep the
  3 tiles; update their `href` `?category=…` to `/products?category=…`.
- **New `components/home/FeaturedProducts.astro`:** mirrors `FlashSale.astro` — `const featured = await
  getFeatured();` (already wired end-to-end); if empty, render nothing; else a section with an eyebrow +
  heading (`'Featured'` / `'Featured Pieces'`) and the products via `ProductCard` in the same responsive
  grid FlashSale uses. Added to `pages/index.astro` **after `FeaturedCollection`, before `CategoryTiles`**.

## 6. Part E — Atelier page

Replace the `ComingSoon` placeholder in `pages/atelier.astro` with a real page (reusing the About page's
section styling):
- A hero band using `Img src="interior-kura"` + eyebrow `'The Atelier'` + H1 `'Where clay meets the
  hand.'`.
- A short story (3 short paragraphs): a Bangladesh-based studio partnering with local artisan potters,
  small-batch handmade clay home décor, an ever-growing collection as more makers join.
- Keep the `Newsletter` block.
- `atelier.astro` `<BaseLayout>` description updated to match (no "kiln" language).

## 7. Security & correctness

- Frontend-only for A/C/D/E; B touches backend + a Prisma migration. The migration is a **column rename
  (CHANGE), data-preserving** — existing `clayBody` values survive as `bodyType`. No data loss, no reset.
- The facets API contract (`clayBodies` → `bodyTypes`) is updated on both sides in the same phase so the
  storefront filter keeps working.
- No user input handling changes; no new routes; no new deps.

## 8. Testing

- **Backend:** the catalog facets test + any product/admin test referencing `clayBody`/`firing`/`glaze`
  updated to `bodyType` / no-firing-glaze; a test asserting `/api/facets` returns `bodyTypes` (not
  `clayBodies`); the migration applies without reset (existing values preserved). Full suite green.
- **Frontend:** `astro build` passes (routes `/products`, `/products/[slug]` resolve; no dangling
  `/objects` import/link); unit suite green (update any test referencing `clayBody`/facets/`/objects`).
  `FeaturedProducts` renders when featured products exist and nothing when empty.
- **Regression:** backend 201 baseline + frontend 53 baseline stay green (± renamed assertions).
- **Live:** `/products` + `/products/[slug]` load; the filter shows "Body Type"; the product spec table has
  no Glaze/Firing rows; the admin product form has no Firing/Glaze inputs and shows "Body Type"; the home
  page shows the Featured Products section (if any featured products) + a "Shop by Category" heading + "View
  All Collections"; About/Atelier read as the BD clay-décor brand; old `/objects` URLs 404 (expected).

## 9. File structure

**Frontend (renamed):** `pages/objects/` → `pages/products/`. **Frontend (new):**
`components/home/FeaturedProducts.astro`. **Frontend (modified):** ~25 files across pages/components/lib/
data (links, copy, `bodyType`, sitemap, structured-data) + `pages/atelier.astro` rewrite. **Backend
(modified):** `prisma/schema.prisma` (+ migration), `lib/mappers.ts`, `modules/catalog/{service,schemas}.ts`,
`modules/admin/products.ts`, `modules/admin/views/product-form.eta` + affected tests.

## 10. Rollout

One additive/rename migration (column CHANGE, no data loss). No new deps. Backend admin structure
unchanged apart from the product-form field labels + removing 2 inputs. Seeded product/collection data is
untouched — the user curates it via the admin. After Phase 15: (candidates) bKash live, order-status
emails, i18n, infra.
