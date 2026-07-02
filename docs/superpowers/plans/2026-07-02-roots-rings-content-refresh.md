# Roots & Rings Phase 15 — Storefront content & taxonomy refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reposition the storefront as a Bangladesh handcrafted clay home-décor brand: rename Objects→Products, `clayBody`→`bodyType`, remove Firing/Glaze from the model, refresh site copy, and add home-page polish (Featured Products, category heading, collection CTA) + a real Atelier page.

**Architecture:** Six sequential tasks — backend `bodyType` rename + migration, frontend `bodyType`/spec changes, the Objects→Products route rename, site copy, home-page additions, and verification. The `/api/facets` contract (`clayBodies`→`bodyTypes`) is changed on the backend (T1) then consumed on the frontend (T2).

**Tech Stack:** Astro 5 SSR + Tailwind (storefront), Fastify 5 + Prisma/MySQL 8 (backend), Vitest.

## Global Constraints

- **Branch `phase-15-content-refresh`** (base `main` @ `9550dcb`), per-task commits — Conventional Commits ending with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Ampersand-path gotcha:** project in `D:\Roots & Rings` — `&` breaks `npm run`. Call node directly:
  - Backend tests: `cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run [tests/<file>]`
  - Prisma: `cd "D:/Roots & Rings/backend"; node --env-file=.env node_modules/prisma/build/index.js migrate dev [...]`
  - Frontend build: `cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build`
  - Frontend tests: `cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run`
- **DB `rootsandrings-db` up** for backend tasks. **No new deps.** **No `astro check`, no dep installs.**
- **Migration is a data-preserving column rename** (`CHANGE COLUMN`), NEVER a drop/add. Use `--create-only` then edit the SQL.
- **Content scope:** model changes + SITE-level copy only. Do NOT rewrite the ~33 mock products or the seeded collections ("The First Firing"/"Porcelain & Light") — those (incl. `the-first-firing`/`kura-vessel`/etc. slugs used in tests) stay. Body-type VALUES ("Stoneware"/"Porcelain") stay; only the field KEY/label/firing+glaze change.
- Clean rename, **no `/objects` redirect**. Baseline: backend 201, frontend 53 — stay green (± renamed assertions).

---

### Task 1: Backend — `clayBody`→`bodyType` (+ migration) + remove Firing/Glaze inputs

**Files:**
- Modify: `backend/prisma/schema.prisma`, `backend/prisma/migrations/**` (new), `backend/src/lib/mappers.ts`, `backend/src/modules/catalog/service.ts`, `backend/src/modules/catalog/schemas.ts`, `backend/src/modules/admin/products.ts`, `backend/src/modules/admin/views/product-form.eta`, `backend/tests/catalog.api.test.ts`

**Interfaces:**
- Produces: `Product.bodyType` (was `clayBody`); `ProductDTO.bodyType`; `/api/facets` returns `bodyTypes` (was `clayBodies`); `/api/products?bodyType=` (was `clayBody`). Firing/Glaze no longer written by the admin form.

- [ ] **Step 1: Rename the field in `backend/prisma/schema.prisma`** — change `clayBody String?` on `model Product` to `bodyType String?`.

- [ ] **Step 2: Create the migration WITHOUT applying, then edit it to a rename**

```
cd "D:/Roots & Rings/backend"
node --env-file=.env node_modules/prisma/build/index.js migrate dev --create-only --name phase15_bodytype
```
Open the generated `backend/prisma/migrations/<ts>_phase15_bodytype/migration.sql`. Prisma will have written a DROP + ADD (data loss). **Replace its entire contents** with the data-preserving rename:
```sql
ALTER TABLE `Product` CHANGE `clayBody` `bodyType` VARCHAR(191) NULL;
```
Then apply it:
```
node --env-file=.env node_modules/prisma/build/index.js migrate dev --name phase15_bodytype
```
Expected: the migration applies, "✔ Generated Prisma Client". If it prompts to RESET, STOP and report — a `CHANGE COLUMN` never needs a reset.

- [ ] **Step 3: `backend/src/lib/mappers.ts`** — line ~52 `clayBody: string | null;` → `bodyType: string | null;`; line ~117 `clayBody: p.clayBody ?? null,` → `bodyType: p.bodyType ?? null,`.

- [ ] **Step 4: `backend/src/modules/catalog/service.ts`**
  - `const CLAY_BODY_ORDER = ['Stoneware', 'Porcelain', 'Earthenware'];` → `const BODY_TYPE_ORDER = ['Stoneware', 'Porcelain', 'Earthenware'];`
  - `Facets` type: `clayBodies: string[];` → `bodyTypes: string[];`
  - facets `select: { clayBody: true, ... }` → `select: { bodyType: true, ... }`
  - `if (p.clayBody) clays.add(p.clayBody);` → `if (p.bodyType) clays.add(p.bodyType);`
  - `clayBodies: order(clays, CLAY_BODY_ORDER),` → `bodyTypes: order(clays, BODY_TYPE_ORDER),`
  - `if (q.clayBody) where.clayBody = q.clayBody;` → `if (q.bodyType) where.bodyType = q.bodyType;`

- [ ] **Step 5: `backend/src/modules/catalog/schemas.ts`** — `clayBody: z.string().optional()` → `bodyType: z.string().optional()`.

- [ ] **Step 6: `backend/src/modules/admin/products.ts`**
  - field `clayBody: optStr,` → `bodyType: optStr,`
  - `specClayBody: optStr,` → `specBodyType: optStr,`
  - **remove** `specFiring: optStr,` and `specGlaze: optStr,`
  - in the `specs` object build: `clayBody: d.specClayBody ?? '',` → `bodyType: d.specBodyType ?? '',`; **remove** `firing: d.specFiring ?? '',` and `glaze: d.specGlaze ?? '',`
  - top-level `clayBody: d.clayBody ?? null,` → `bodyType: d.bodyType ?? null,`

- [ ] **Step 7: `backend/src/modules/admin/views/product-form.eta`**
  - line ~5 top-level: `<label>Clay body <input name="clayBody" value="<%= p && p.clayBody ? p.clayBody : '' %>" placeholder="Stoneware / Porcelain / Earthenware" /></label>` → `<label>Body Type <input name="bodyType" value="<%= p && p.bodyType ? p.bodyType : '' %>" placeholder="Stoneware / Terracotta / …" /></label>`
  - line ~49 spec: `<label>Clay body <input name="specClayBody" value="<%= specs.clayBody || '' %>" /></label>` → `<label>Body Type <input name="specBodyType" value="<%= specs.bodyType || '' %>" /></label>`
  - **remove** the Glaze input line (`<label>Glaze <input name="specGlaze" ...>`) and the Firing input line (`<label>Firing <input name="specFiring" ...>`).

- [ ] **Step 8: Update the backend test** `backend/tests/catalog.api.test.ts` — line ~24 `expect(body.facets.clayBodies).toContain('Porcelain');` → `expect(body.facets.bodyTypes).toContain('Porcelain');`. (Leave the `the-first-firing` collection assertions — that's collection data, not a spec field.)

- [ ] **Step 9: Full suite + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/prisma backend/src/lib/mappers.ts backend/src/modules/catalog backend/src/modules/admin/products.ts backend/src/modules/admin/views/product-form.eta backend/tests/catalog.api.test.ts
git commit -m "refactor(catalog): rename clayBody->bodyType (+migration) and drop Firing/Glaze admin fields"
```
Expected: green (201). A lone `jobs.test.ts` retry-timing test is known-flaky — re-run standalone if it fails.

---

### Task 2: Frontend — `clayBody`→`bodyType` + remove Firing/Glaze display

**Files:**
- Modify: `frontend/src/lib/schema.ts`, `frontend/src/lib/api.ts`, `frontend/src/lib/catalog.ts`, `frontend/src/components/catalog/FilterSidebar.astro`, `frontend/src/components/product/SpecTable.astro`, `frontend/src/pages/objects/index.astro`, `frontend/src/scripts/filters.ts`, `frontend/src/data/products.ts`, `frontend/tests/catalog.test.ts`, `frontend/tests/schema.test.ts`, `frontend/tests/structured-data.test.ts`

**Interfaces:**
- Consumes: the backend `/api/facets` now returns `bodyTypes` (Task 1).
- Produces: `Product.bodyType` (frontend type); `ProductQuery.bodyTypes`; `Facets.bodyTypes`. No `firing`/`glaze` on the specs type.

- [ ] **Step 1: `frontend/src/lib/schema.ts`**
  - `CLAY_BODIES` const → `BODY_TYPES`; `ClayBody` type → `BodyType`.
  - `specsSchema`: `clayBody: z.string().min(1)` → `bodyType: z.string().min(1)`; **remove** `firing: z.string().min(1)` and `glaze: z.string().min(1)`.
  - `productSchema`: `clayBody: z.string().default('')` → `bodyType: z.string().default('')`.

- [ ] **Step 2: `frontend/src/lib/api.ts`** — `ApiProduct.clayBody: string | null` → `bodyType: string | null`; `toProduct` `clayBody: p.clayBody ?? ''` → `bodyType: p.bodyType ?? ''`; `fetchFacets` return type + body `clayBodies` → `bodyTypes` (map from the API's `bodyTypes`).

- [ ] **Step 3: `frontend/src/lib/catalog.ts`** — `ProductQuery.clayBodies?` → `bodyTypes?`; the filter `if (bodyTypes?.length) list = list.filter((p) => bodyTypes.includes(p.bodyType));`; `Facets.clayBodies` → `bodyTypes`.

- [ ] **Step 4: `frontend/src/components/catalog/FilterSidebar.astro`** — the group type `'clayBody'` → `'bodyType'`; the group object `{ key: 'clayBody', heading: 'Clay Body', values: facets.clayBodies }` → `{ key: 'bodyType', heading: 'Body Type', values: facets.bodyTypes }`.

- [ ] **Step 5: `frontend/src/components/product/SpecTable.astro`** — change `{ label: 'Clay Body', value: specs.clayBody }` → `{ label: 'Body Type', value: specs.bodyType }`; **remove** the `{ label: 'Glaze', value: specs.glaze }` and `{ label: 'Firing', value: specs.firing }` rows.

- [ ] **Step 6: `frontend/src/pages/objects/index.astro`** — the product cell attribute `data-clay={p.clayBody}` → `data-bodytype={p.bodyType}`.

- [ ] **Step 7: `frontend/src/scripts/filters.ts`** — `selected('clayBody')` → `selected('bodyType')`; `cell.dataset.clay` → `cell.dataset.bodytype`; update the header comment `(category / clay body / attribute)` → `(category / body type / attribute)`.

- [ ] **Step 8: `frontend/src/data/products.ts`** — rename every `clayBody:` object key to `bodyType:` (32 occurrences, keep the string values) and **remove** every `firing:` and `glaze:` key from the `specs` objects (16 each). Do NOT touch descriptions/curatorsNote/alt/names/slugs (content stays).

- [ ] **Step 9: Update the frontend tests**
  - `frontend/tests/catalog.test.ts`: `getProducts({ clayBodies: ['Porcelain'] })` → `{ bodyTypes: ['Porcelain'] }` and `p.clayBody` → `p.bodyType` (lines ~24-25, 53-54); `facets.clayBodies` → `facets.bodyTypes` (line ~101). Leave the `the-first-firing` collection assertion.
  - `frontend/tests/schema.test.ts`: `clayBody:` → `bodyType:` in the fixtures (lines ~11, 19, 42); **remove** the `firing:`/`glaze:` fixture lines (~20-21) and any assertion on them. Leave the `the-first-firing` collection fixture/assertions.
  - `frontend/tests/structured-data.test.ts`: line ~7 `clayBody: 'stoneware'` → `bodyType: 'stoneware'`. (Leave the `/objects/kura-vessel` URL for Task 3.)

- [ ] **Step 10: Build + unit suite + commit**

```
cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run
git add frontend/src frontend/tests
git commit -m "refactor(storefront): rename clayBody->bodyType and remove Firing/Glaze spec rows"
```
Expected: `astro build` succeeds; unit suite green (53). If a test still references `clayBody`/`firing`/`glaze`, update it (only rename/align, do not delete meaningful assertions).

---

### Task 3: Objects → Products (route rename + all links + copy)

**Files:**
- Rename: `frontend/src/pages/objects/` → `frontend/src/pages/products/` (git mv)
- Modify (links `/objects`→`/products`): `frontend/src/data/navigation.ts`, `frontend/src/components/layout/Header.astro`, `frontend/src/components/layout/ComingSoon.astro`, `frontend/src/components/cart/CartDrawer.astro`, `frontend/src/components/home/{Hero,FlashSale,CategoryTiles,FeaturedCollection}.astro`, `frontend/src/components/product/ProductCard.astro`, `frontend/src/components/catalog/LoadMore.astro`, `frontend/src/pages/{cart,checkout,wishlist}.astro`, `frontend/src/pages/checkout/success.astro`, `frontend/src/pages/account/{index,orders}.astro`, `frontend/src/pages/account/orders/[orderNumber].astro`, `frontend/src/pages/collections/[slug].astro`, the renamed `frontend/src/pages/products/{index,[slug]}.astro`, `frontend/src/lib/cart-lookup.ts`, `frontend/src/lib/structured-data.ts`, `frontend/src/pages/sitemap.xml.ts`
- Modify (tests): `frontend/tests/sitemap.test.ts`, `frontend/tests/structured-data.test.ts`

**Interfaces:**
- Produces: routes `/products` and `/products/[slug]` (were `/objects`). No `/objects` path remains anywhere.

- [ ] **Step 1: Rename the route directory (preserve history)**

```
cd "D:/Roots & Rings"
git mv "frontend/src/pages/objects" "frontend/src/pages/products"
```

- [ ] **Step 2: Replace every `/objects` path with `/products`** across the files listed above. Rules (apply to hrefs, template literals, canonical/breadcrumb/sitemap/JSON-LD):
  - `/objects/${...}` → `/products/${...}` (product detail links: ProductCard, FeaturedCollection, cart-lookup, collections/[slug] itemList, account orders, products/[slug] canonical + login-`next`).
  - `/objects?...` → `/products?...` (FlashSale `?onSale=true`, CategoryTiles `?category=…`, products/[slug] `?category=` link, structured-data `SearchAction` urlTemplate).
  - bare `/objects` → `/products` (navigation.ts ×3, Header, ComingSoon, CartDrawer, Hero, cart.astro, checkout.astro, checkout/success.astro ×2, wishlist.astro, account/index, account/orders, products/index breadcrumb, products/[slug] breadcrumb).
  - `sitemap.xml.ts`: `STATIC_PATHS` `'/objects'` → `'/products'` and the product `loc` `\`/objects/${p.slug}\`` → `\`/products/${p.slug}\``.

- [ ] **Step 3: Replace user-facing "Objects" copy** (exact strings):
  - `products/index.astro`: `<h1>Objects</h1>` → `<h1>Products</h1>`; `<BaseLayout title="Objects" ...>` → `title="Products"`; the description prop text if it says "objects"; `{count} Objects` → `{count} Products`; `No objects match these filters.` → `No products match these filters.`
  - `products/[slug].astro`: breadcrumb text `Objects` → `Products`.
  - `components/home/Hero.astro`: leave the H1/subhead text for Task 4 (it rewrites Hero copy) — only its `href` changed in Step 2.
  - `components/cart/CartDrawer.astro`: `Browse Objects` → `Browse Products`.
  - `components/layout/ComingSoon.astro`: `Browse the Objects` → `Browse the Products`.
  - `components/catalog/LoadMore.astro`: `Load More Objects` → `Load More Products`.
  - `components/layout/Header.astro`: `aria-label="Search objects"` → `aria-label="Search products"`.
  - `pages/cart.astro`, `pages/account/index.astro`, `pages/account/orders.astro`: `Browse Objects` → `Browse Products`.
  - `pages/404.astro`: leave (Task 4 rewrites the 404 copy).

- [ ] **Step 4: Update the two tests**
  - `frontend/tests/sitemap.test.ts`: `/objects/kura-vessel` → `/products/kura-vessel` (lines ~8, 12) and `/objects?q=a&b` → `/products?q=a&b` (line ~18).
  - `frontend/tests/structured-data.test.ts`: line ~24 `/objects/kura-vessel` → `/products/kura-vessel`.

- [ ] **Step 5: Verify no `/objects` remains + build + tests**

```
cd "D:/Roots & Rings/frontend"
grep -rniE "/objects|Browse Objects|Load More Objects|Search objects|<h1>Objects|Objects</" src tests
```
Expected: NO matches (empty). Then:
```
node node_modules/astro/astro.js build
node node_modules/vitest/vitest.mjs run
```
Expected: build succeeds; unit suite green (53).

- [ ] **Step 6: Commit**

```
git add -A frontend/src frontend/tests
git commit -m "refactor(storefront): rename Objects->Products (routes /products, links, copy, sitemap)"
```

---

### Task 4: Site copy — clay home décor / Bangladesh / no porcelain

**Files:**
- Modify: `frontend/src/data/site.ts`, `frontend/src/pages/about.astro`, `frontend/src/pages/atelier.astro`, `frontend/src/pages/404.astro`, `frontend/src/components/layout/Newsletter.astro`, `frontend/src/components/home/Hero.astro`

- [ ] **Step 1: `frontend/src/data/site.ts`**
  - `title:` → `'Roots & Rings — Handcrafted Clay Home Décor'`
  - `description:` → `'Handcrafted clay home décor, made with Bangladeshi artisans. Small-batch pottery and decorative pieces for the modern home — an ever-growing collection.'`
  - `tagline:` unchanged.

- [ ] **Step 2: `frontend/src/components/home/Hero.astro`** copy
  - H1 → `'Shaped by hand, rooted in clay.'`
  - subhead → `'Handcrafted home décor, made with Bangladeshi artisans in small batches.'`

- [ ] **Step 3: `frontend/src/pages/about.astro`** story
  - Replace the two story paragraphs with:
    - `'Roots & Rings is a Bangladesh-based studio making handcrafted clay home décor in small batches. Every piece is shaped, finished, and checked by hand — no two are ever quite alike.'`
    - `'We work closely with local artisans, letting the clay and the hand lead. Our range of vessels, tableware, and decorative pieces keeps growing as we bring more of their craft into your home.'`
  - Care Guide detail → `'Clay surfaces may darken gently with use — this patina is part of a piece's character. Wipe clean with a damp cloth and avoid harsh detergents.'`
  - Leave the About H1 + `about-hero` image.

- [ ] **Step 4: `frontend/src/pages/atelier.astro`** — replace the `ComingSoon` placeholder with a real page. Mirror `about.astro`'s hero + prose structure:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import Img from '../components/ui/Img.astro';
import Newsletter from '../components/layout/Newsletter.astro';
---

<BaseLayout title="Atelier" description="Inside the Roots & Rings atelier — handcrafted clay home décor, made with Bangladeshi artisans.">
  <section class="relative h-[52vh] min-h-[360px] flex items-center justify-center overflow-hidden">
    <Img fill src="interior-kura" alt="A quiet clay studio with shelves of drying handmade pottery." priority widths={[768, 1280, 1920]} sizes="100vw" />
    <div class="absolute inset-0 bg-surface/40"></div>
    <div class="relative text-center fade-up px-6">
      <span class="text-label-caps uppercase opacity-60 mb-4 block">The Atelier</span>
      <h1 class="font-display text-display-mobile md:text-display-lg">Where clay meets the hand.</h1>
    </div>
  </section>

  <section class="wrap py-16 md:py-24 max-w-2xl">
    <div class="space-y-6 text-body-lg text-on-surface-variant fade-up">
      <p>Roots & Rings began with a simple belief — that the clay traditions of Bangladesh belong in the modern home.</p>
      <p>We partner with local artisans, potters whose families have worked clay for generations, and bring their craft to a wider audience. Every piece is made in small batches, by hand, with care.</p>
      <p>This is a growing story. As we work with more makers, our collection of clay home décor grows with them.</p>
    </div>
  </section>

  <Newsletter />
</BaseLayout>
```
(If `interior-kura` does not resolve to an asset, `Img` falls back to a tonal placeholder — acceptable; the file `frontend/src/assets/images/interior-kura.jpg` exists per the surface map.)

- [ ] **Step 5: `frontend/src/pages/404.astro`** — `"…Let's return you to the objects."` → `"…Let's return you to the products."`

- [ ] **Step 6: `frontend/src/components/layout/Newsletter.astro`** — default heading prop `'Subscribe to our dispatch for early access to new firings.'` → `'Subscribe for early access to new pieces and collections.'`

- [ ] **Step 7: Build + commit**

```
cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run
git add frontend/src
git commit -m "content(storefront): BD clay home-decor copy (site/about/atelier/hero/404/newsletter)"
```
Expected: build succeeds; unit suite green (53).

---

### Task 5: Home page — Featured Products + Categories heading + collection CTA

**Files:**
- Create: `frontend/src/components/home/FeaturedProducts.astro`
- Modify: `frontend/src/pages/index.astro`, `frontend/src/components/home/FeaturedCollection.astro`, `frontend/src/components/home/CategoryTiles.astro`

- [ ] **Step 1: Create `frontend/src/components/home/FeaturedProducts.astro`** (mirrors `FlashSale.astro`; uses the already-wired `getFeatured()`)

```astro
---
import ProductCard from '../product/ProductCard.astro';
import { getFeatured } from '../../lib/catalog';

const featured = await getFeatured();
---
{featured.length > 0 && (
  <section class="wrap py-16 md:py-24">
    <div class="flex items-baseline justify-between mb-8 md:mb-12">
      <div>
        <span class="text-label-caps uppercase opacity-60 mb-2 block">Featured</span>
        <h2 class="font-display text-display-mobile md:text-display-lg">Featured Pieces</h2>
      </div>
      <a href="/products" class="btn-editorial text-label-caps uppercase">View All Products</a>
    </div>
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-12">
      {featured.map((p) => <ProductCard product={p} sizes="(max-width: 768px) 50vw, 25vw" />)}
    </div>
  </section>
)}
```

- [ ] **Step 2: Add it to `frontend/src/pages/index.astro`** — import + place after `<FeaturedCollection />` and before `<CategoryTiles />`:
```astro
import FeaturedProducts from '../components/home/FeaturedProducts.astro';
```
```astro
  <FeaturedCollection />
  <FeaturedProducts />
  <CategoryTiles />
```

- [ ] **Step 3: `frontend/src/components/home/FeaturedCollection.astro`** — the CTA text `View All Pieces` → `View All Collections` (the `href="/collections"` is already correct).

- [ ] **Step 4: `frontend/src/components/home/CategoryTiles.astro`** — add a section header above the tiles. Inside `<div class="wrap fade-up">`, before the `<div class="grid ...">`, insert:
```astro
    <div class="mb-8 md:mb-12">
      <span class="text-label-caps uppercase opacity-60 mb-2 block">Shop by Category</span>
      <h2 class="font-display text-display-mobile md:text-display-lg">Browse by Category</h2>
    </div>
```
(The tile `href`s were already updated to `/products?category=…` in Task 3. Optionally shorten the `'Sculptural Objects'` tile `title` to `'Sculptural'` for consistency — do so.)

- [ ] **Step 5: Build + commit**

```
cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run
git add frontend/src
git commit -m "feat(home): Featured Products section + category heading + View All Collections"
```
Expected: build succeeds; unit suite green (53).

---

### Task 6: Verification sweep + memory

**Files:**
- Modify: `C:\Users\PC\.claude\projects\D--Roots---Rings\memory\MEMORY.md` + new `roots-rings-phase15-content-refresh.md`

- [ ] **Step 1: Full suites** — backend `node node_modules/vitest/vitest.mjs run` (201, green); frontend `astro build` passes + `vitest run` (53, green). Confirm `grep -rniE "/objects|clayBody|specFiring|specGlaze" frontend/src backend/src` returns nothing (the rename is complete; `firing`/`glaze` may still appear ONLY in untouched product/collection prose + `the-first-firing` slug, which is allowed).

- [ ] **Step 2: Live verification (controller-run)** — backend + frontend up:
  1. `/products` + `/products/[slug]` load; old `/objects` 404s. Nav "Shop" → `/products`.
  2. The catalog filter sidebar shows **"Body Type"** (not "Clay Body"); a product's spec table has **no Glaze/Firing** rows and shows "Body Type".
  3. Admin product form: field labelled **"Body Type"**, and **no Firing/Glaze** inputs; saving a product keeps its body-type value (migration preserved data).
  4. Home page: **Featured Products** section appears (if any products are marked featured), the category section has a **"Shop by Category"** heading, and the Featured Collection CTA says **"View All Collections"**.
  5. About + Atelier read as the BD clay home-décor brand (Atelier has a hero image + story, no more "Coming Soon").

- [ ] **Step 3: Update memory** — create `roots-rings-phase15-content-refresh.md` (Objects→Products route rename; clayBody→bodyType full rename + CHANGE-COLUMN migration + facets contract bodyTypes; Firing/Glaze removed from model/spec-table/admin; BD clay-decor copy; home FeaturedProducts + category heading + View All Collections; Atelier real page) + a one-line pointer in `MEMORY.md`.

- [ ] **Step 4: Report** final counts + live-verification results.

---

## Self-Review

**1. Spec coverage** (spec §2–§9 → tasks): §2 Objects→Products → Task 3. §3 bodyType rename + firing/glaze → Tasks 1 (backend) + 2 (frontend). §4 site copy → Task 4. §5 home page → Task 5. §6 Atelier → Task 4. §7 security/migration (CHANGE COLUMN) → Task 1 Step 2. §8 testing → each task's tests + Task 6. §9 file structure → matches Tasks 1–5. ✅

**2. Placeholder scan:** every code step shows the exact change or complete code; the mechanical rename (Task 3) has explicit rules + a grep gate; copy steps have the literal new strings. No TBD/TODO.

**3. Type consistency:** `bodyType` replaces `clayBody` consistently across the backend (`Product.bodyType`, `ProductDTO.bodyType`, `Facets.bodyTypes`, `?bodyType=`) in Task 1 and the frontend (`Product.bodyType`, `ProductQuery.bodyTypes`, `Facets.bodyTypes`, `data-bodytype`, `dataset.bodytype`, `selected('bodyType')`) in Task 2 — the `/api/facets` contract key `bodyTypes` is produced in Task 1 Step 4 and consumed in Task 2 Steps 2-3. The removed `firing`/`glaze` are dropped from both the schema (T2 Step 1) and the display (T2 Step 5) and the admin (T1 Steps 6-7), with no remaining reader. `getFeatured()` (existing) is consumed by the new `FeaturedProducts.astro` (T5). Route `/products` produced by T3 is linked from `FeaturedProducts` (T5) and every updated link (T3). ✅
