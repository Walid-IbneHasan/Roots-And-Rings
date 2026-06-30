# Roots & Rings Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Roots & Rings artisan-ceramics e-commerce frontend in Astro, faithful to the Stitch "Slow Luxury Artisan" design, with a functional client-side cart and a clean seam for a later Fastify API.

**Architecture:** Astro 5 static site. Tailwind v4 (Vite plugin) with Stitch design tokens. Vanilla-JS islands + nanostores (persistent) for cart/wishlist/UI state — no UI framework runtime. Typed mock data behind a `catalog.ts` data-access module that later swaps to `fetch()`. Local optimized images via `astro:assets`. Self-hosted Fontsource fonts.

**Tech Stack:** Astro 5, Tailwind CSS v4, nanostores + @nanostores/persistent, Zod, Fontsource (EB Garamond + Inter), Vitest, @astrojs/sitemap, sharp.

## Global Constraints

- Project root for the frontend: `D:\Roots & Rings\frontend`. Future `backend/` is a sibling.
- Colors (exact): surface/background `#fef9f1`; on-surface `#1d1c17`; on-surface-variant `#4d4540`; outline `#7e7570`; outline-variant `#d0c4be`; primary `#000000`; on-primary `#ffffff`; secondary `#875134`; secondary-container `#feb693`; surface-container-low `#f8f3eb`, container `#f2ede5`, high `#ece8e0`, highest `#e7e2da`; inverse-surface `#32302b`; inverse-on-surface `#f5f0e8`. Hairline `rgba(140,131,120,0.3)`.
- Fonts: EB Garamond (display/headlines, italic for emphasis), Inter (body/labels). Self-hosted.
- Shape: 0px border-radius everywhere. No drop shadows — depth via tone + hairlines.
- Spacing tokens: container-max 1440px, margin-desktop 80px, margin-mobile 20px, gutter 32px, section-gap 160px.
- Brand copy: wordmark is `ROOTS & RINGS`. Tagline "Crafted with love, rooted in tradition."
- Currency: EUR shown as `€` (PDP uses €; catalog mockups used $ — standardize on € site-wide).
- Accessibility: keyboard-operable overlays (Esc to close, focus trap), visible focus rings, aria labels/roles, semantic landmarks, alt text on all images, honor `prefers-reduced-motion`.
- Performance: no React/Preact; per-island vanilla JS only; images AVIF/WebP responsive with explicit dimensions; CSS purged; fonts preloaded.

---

## File Structure

```
frontend/
  astro.config.mjs            # integrations: sitemap; vite: tailwind plugin
  tsconfig.json               # strict
  vitest.config.ts
  package.json
  public/favicon.svg, robots.txt
  src/
    styles/global.css         # @import tailwind; @theme tokens; base + utilities
    lib/
      schema.ts               # Zod product/collection schemas + inferred types
      catalog.ts              # getProducts/getProduct/getRelated/getCollections/getCategories
      format.ts               # formatPrice
      stores.ts               # nanostores: $cart,$wishlist,$ui + actions + derived
    data/
      products.ts             # mock products (validated)
      collections.ts          # mock collections
      navigation.ts           # nav + footer link config
      site.ts                 # site meta (title, desc, url, social)
    assets/images/...         # local optimized source images
    components/
      ui/        Icon.astro, Button.astro, Hairline.astro, SectionHeading.astro
      layout/    Header.astro, MobileMenu.astro, Footer.astro, Newsletter.astro
      cart/      CartDrawer.astro, CartButton.astro
      product/   ProductCard.astro, ProductGrid.astro, Badge.astro, Gallery.astro,
                 SpecTable.astro, AddToBag.astro, RelatedProducts.astro, WishlistButton.astro
      catalog/   FilterSidebar.astro, SortControl.astro, LoadMore.astro
      home/      Hero.astro, FeaturedCollection.astro, CategoryTiles.astro, AtelierQuote.astro
    scripts/
      reveal.ts               # IntersectionObserver fade-up (reduced-motion aware)
      cart-drawer.ts          # render drawer from $cart, qty/remove
      header.ts               # cart badge + mobile menu + drawer open
      filters.ts              # client filter/sort/load-more on PLP
    layouts/
      BaseLayout.astro
    pages/
      index.astro
      objects/index.astro
      objects/[slug].astro
      cart.astro
      collections.astro, atelier.astro, journal.astro, trade.astro, about.astro
      404.astro
  tests/
      schema.test.ts, catalog.test.ts, format.test.ts, stores.test.ts
```

---

### Task 1: Scaffold Astro project, Tailwind v4, tokens, tooling

**Files:**
- Create: `frontend/package.json`, `frontend/astro.config.mjs`, `frontend/tsconfig.json`, `frontend/vitest.config.ts`, `frontend/src/styles/global.css`, `frontend/src/env.d.ts`, `frontend/public/robots.txt`, `frontend/public/favicon.svg`

**Interfaces:**
- Produces: working dev server; `global.css` exposing Tailwind theme tokens (colors `surface`,`on-surface`,`secondary`,…; fonts `font-display`/`font-body`; spacing `section-gap`,`gutter`,`margin-desktop`,`margin-mobile`,`container`); utility classes `.hairline-t`/`.hairline-b`, `.btn-editorial`, `.fade-up`, `.input-minimal`.

- [ ] **Step 1: Create the project skeleton** with `npm create astro@latest` (empty, TypeScript strict, no sample), or hand-author `package.json` with deps: `astro`, `@astrojs/sitemap`, `tailwindcss`, `@tailwindcss/vite`, `nanostores`, `@nanostores/persistent`, `zod`, `@fontsource-variable/inter`, `@fontsource/eb-garamond`, `sharp`; devDeps: `vitest`. Run `npm install` in `frontend/`.

- [ ] **Step 2: `astro.config.mjs`** — `site: 'https://rootsandrings.example'`, `integrations: [sitemap()]`, `vite: { plugins: [tailwindcss()] }`.

- [ ] **Step 3: `src/styles/global.css`** — `@import "tailwindcss";` then `@theme { --color-surface:#fef9f1; --color-on-surface:#1d1c17; ... --font-display:"EB Garamond",serif; --font-body:"Inter",sans-serif; --spacing-section-gap:160px; ... }`. Add base layer: `body{background:var(--color-surface);color:var(--color-on-surface);font-family:var(--font-body)}`, import Fontsource CSS, define `.hairline-t/.hairline-b` (1px `rgba(140,131,120,.3)`), `.btn-editorial` (underline-from-left on hover), `.input-minimal` (bottom-border only), `.fade-up` (opacity/translateY, `.is-visible` resets), and a `@media (prefers-reduced-motion: reduce)` block disabling fade-up.

- [ ] **Step 4: Verify dev server** — Run: `npm run dev`. Expected: Astro serves on localhost with no errors; a temporary `index.astro` using `class="bg-surface text-on-surface font-display"` renders with bone background + Garamond.

- [ ] **Step 5: Commit** — `feat: scaffold Astro + Tailwind v4 + design tokens`.

---

### Task 2: Product/collection schema (TDD)

**Files:**
- Create: `frontend/src/lib/schema.ts`, `frontend/tests/schema.test.ts`

**Interfaces:**
- Produces: `productSchema` (Zod), `Product` (inferred type), `collectionSchema`, `Collection`. Product fields: `slug, name, subtitle, price:number, currency:'EUR', category:'Vessels'|'Bowls'|'Plates'|'Sculptural'|'Tableware', clayBody:'Stoneware'|'Porcelain'|'Earthenware', badges:('Limited Edition'|'Made to Order')[], shortDescription, description, curatorsNote, specs:{dimensions,weight,clayBody,firing,glaze}, edition?:{ref,count,certificate:boolean,leadTime?}, images:{src,alt}[] (≥1), relatedSlugs:string[], seenInInteriors?:{text,image:{src,alt}}, featured?:boolean, createdAt:string`.

- [ ] **Step 1: Write failing tests** — valid product parses; missing `name` throws; bad `category` enum throws; `images` empty array throws; `edition` optional.

```ts
import { describe, it, expect } from 'vitest';
import { productSchema } from '../src/lib/schema';
const base = { slug:'kura', name:'The Kura Vessel', subtitle:'Stoneware Vessel', price:420, currency:'EUR', category:'Vessels', clayBody:'Stoneware', badges:['Limited Edition'], shortDescription:'x', description:'y', curatorsNote:'z', specs:{dimensions:'H 42 × W 28 × D 25cm', weight:'4.2 kg', clayBody:'High-iron stoneware', firing:'Wood-fired 72h', glaze:'Ash'}, images:[{src:'/a.jpg',alt:'a'}], relatedSlugs:[], createdAt:'2024-01-01' };
it('parses a valid product', () => expect(productSchema.parse(base).slug).toBe('kura'));
it('rejects bad category', () => expect(() => productSchema.parse({...base, category:'Nope'})).toThrow());
it('rejects empty images', () => expect(() => productSchema.parse({...base, images:[]})).toThrow());
```

- [ ] **Step 2: Run** `npx vitest run tests/schema.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `schema.ts` with the Zod schemas above; export inferred types.
- [ ] **Step 4: Run** tests → PASS.
- [ ] **Step 5: Commit** — `feat: product/collection Zod schema`.

---

### Task 3: Mock data (validated)

**Files:**
- Create: `frontend/src/data/products.ts`, `frontend/src/data/collections.ts`, `frontend/src/data/navigation.ts`, `frontend/src/data/site.ts`
- Test: extend `frontend/tests/schema.test.ts`

**Interfaces:**
- Produces: `products: Product[]` (≥12: incl. The Kura Vessel, Tsuki Basin, Enso Rings, Ash Glazed Vessel No.1, Tasting Plates Set, Tea Bowl No.14, Ash Incense Burner, The Slender Pitcher, Monolith Platter, plus a few more across Vessels/Bowls/Plates/Sculptural/Tableware and clay bodies). `collections: Collection[]` (incl. "The First Firing"). `nav` (Objects, Collections, Atelier, Journal, Trade, About) + footer columns. `site` meta.
- Each product validated by `productSchema.parse` at module load (map over raw array).

- [ ] **Step 1: Write failing test** — every product in `products` parses; slugs unique; `relatedSlugs` reference existing slugs.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the four data files; pipe raw arrays through `productSchema.parse`. Image `src` paths point at `src/assets/images/<slug>-1.jpg` etc. (added in Task 18; use a shared placeholder import until then).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat: mock catalog data`.

---

### Task 4: Catalog data-access API (TDD)

**Files:**
- Create: `frontend/src/lib/catalog.ts`, `frontend/tests/catalog.test.ts`

**Interfaces:**
- Produces (all async, so the Fastify swap is drop-in):
  - `getProducts(opts?:{categories?:string[];clayBodies?:string[];attributes?:string[];sort?:'newest'|'price-asc'|'price-desc'}):Promise<Product[]>`
  - `getProduct(slug):Promise<Product|undefined>`
  - `getRelated(slug):Promise<Product[]>` (from `relatedSlugs`, fallback same-category)
  - `getCollections():Promise<Collection[]>`, `getFeatured():Promise<Product[]>`
  - `getFacets():Promise<{categories:string[];clayBodies:string[];attributes:string[]}>`

- [ ] **Step 1: Write failing tests** — filter by category returns only that category; `price-asc` sorts ascending; `getProduct('kura')` returns it; `getProduct('nope')` undefined; `getRelated` excludes self.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** over `products`/`collections` arrays.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat: catalog data-access layer`.

---

### Task 5: Price formatting (TDD)

**Files:** Create `frontend/src/lib/format.ts`, `frontend/tests/format.test.ts`

**Interfaces:** Produces `formatPrice(amount:number, currency?='EUR'):string` → `€420`.

- [ ] **Step 1: Failing test** — `formatPrice(420)==='€420'`, `formatPrice(1850)==='€1,850'`.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement with `Intl.NumberFormat('en-IE',{style:'currency',currency,maximumFractionDigits:0})` (normalize symbol). **Step 4:** Run → PASS. **Step 5:** Commit `feat: price formatter`.

---

### Task 6: State stores (TDD)

**Files:** Create `frontend/src/lib/stores.ts`, `frontend/tests/stores.test.ts`

**Interfaces:**
- Produces: `$cart` (persistent `{items:{slug,qty}[]}`), `$wishlist` (persistent `string[]`), `$ui` (`{cartOpen,mobileMenuOpen,filtersOpen}`); actions `addToCart(slug,qty=1)`, `removeFromCart(slug)`, `setQty(slug,qty)`, `clearCart()`, `toggleWishlist(slug)`, `openCart/closeCart/toggleMenu/...`; derived `cartCount(items)` and `cartSubtotal(items, products)` helpers (pure functions, also exported for testing).

- [ ] **Step 1: Failing tests** — `addToCart` twice increments qty; `setQty(...,0)` removes; `cartCount` sums qty; `toggleWishlist` adds then removes. (Use computed helpers over plain arrays to avoid persistence env issues; mock localStorage if needed.)
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement with `nanostores` + `@nanostores/persistent`. **Step 4:** Run → PASS. **Step 5:** Commit `feat: cart/wishlist/ui stores`.

---

### Task 7: BaseLayout + SEO + global wiring

**Files:** Create `frontend/src/layouts/BaseLayout.astro`, `frontend/src/components/ui/Icon.astro`

**Interfaces:**
- Produces: `BaseLayout` props `{title,description?,image?,noindex?}` rendering `<html lang=en>` head (charset, viewport, title, meta description, canonical, OG/Twitter, font preloads, `global.css` import) and `<slot/>` between `Header` and `Footer`, plus `CartDrawer` + `MobileMenu` once. `Icon` props `{name:'search'|'account'|'heart'|'bag'|'close'|'menu'|'minus'|'plus'|'arrow', size?}` returning inline `<svg>` (1px stroke line icons).

- [ ] **Step 1:** Implement `Icon.astro` with an SVG map.
- [ ] **Step 2:** Implement `BaseLayout.astro` (Header/Footer/drawer slots referenced even if built next — use placeholders, replace as built). Import `reveal.ts`, `header.ts`, `cart-drawer.ts` via `<script>`.
- [ ] **Step 3: Verify** a page using BaseLayout builds (`npm run build`) with valid `<head>`.
- [ ] **Step 4: Commit** — `feat: base layout, SEO head, icon set`.

---

### Task 8: UI primitives

**Files:** Create `Button.astro`, `Hairline.astro`, `SectionHeading.astro` in `src/components/ui/`

**Interfaces:**
- `Button` props `{variant:'solid'|'ghost'|'editorial', href?, type?, class?}` + slot. Solid = charcoal fill / bone text, sharp; ghost = hairline border; editorial = underline-grow link. `Hairline` = `<hr>` styled. `SectionHeading` props `{eyebrow?, title, align?}` using label-caps eyebrow + Garamond title.

- [ ] **Step 1:** Implement the three components matching Stitch button/hairline styles.
- [ ] **Step 2: Verify** on a scratch page: solid/ghost/editorial render with sharp corners, correct hover.
- [ ] **Step 3: Commit** — `feat: UI primitives (button, hairline, section heading)`.

---

### Task 9: Header + MobileMenu

**Files:** Create `src/components/layout/Header.astro`, `src/components/layout/MobileMenu.astro`, `src/scripts/header.ts`

**Interfaces:**
- Consumes: `nav` from `data/navigation.ts`; `$cart`/`cartCount`, `$ui` from stores; `Icon`.
- Produces: fixed top nav — left link group (desktop) / Menu button (mobile), centered `ROOTS & RINGS` wordmark (Garamond), right icon group (Search, Account, Wishlist heart, Cart with live count badge). `header.ts` subscribes to `$cart` to update the badge, opens the cart drawer on bag-click, toggles `MobileMenu` (full-screen overlay, Esc/focus-trap). Active link gets full opacity; others 50%→100% on hover. Backdrop-blur on scroll.

- [ ] **Step 1:** Implement `Header.astro` per Stitch markup (lines 109–134 of home), swapping Material Symbols for `Icon`.
- [ ] **Step 2:** Implement `MobileMenu.astro` (full-screen bone overlay, nav links large Garamond, close button) + `header.ts` (badge, drawer open, menu toggle, Esc, focus trap, body scroll lock).
- [ ] **Step 3: Verify** — badge reflects `addToCart` calls; menu opens/closes via keyboard; responsive (links hidden < md, Menu button shown).
- [ ] **Step 4: Commit** — `feat: header + mobile menu`.

---

### Task 10: Footer + Newsletter

**Files:** Create `src/components/layout/Footer.astro`, `src/components/layout/Newsletter.astro`

**Interfaces:**
- Produces: centered minimal footer (wordmark, link row Journal/Atelier/Trade/Contact, © line) used site-wide; `Newsletter` (label-caps prompt + `.input-minimal` email + editorial Submit; no real submit — `preventDefault`, show inline thanks). PDP/Archive footer variant includes Newsletter + Instagram/Pinterest.

- [ ] **Step 1:** Implement both per Stitch (home footer lines 250–264; PDP footer with newsletter).
- [ ] **Step 2: Verify** renders; newsletter shows inline confirmation, no navigation.
- [ ] **Step 3: Commit** — `feat: footer + newsletter`.

---

### Task 11: Cart drawer

**Files:** Create `src/components/cart/CartDrawer.astro`, `src/scripts/cart-drawer.ts`, `src/components/cart/CartButton.astro`

**Interfaces:**
- Consumes: `$cart`,`$ui`,`removeFromCart`,`setQty`,`closeCart`, `getProducts`/product map, `formatPrice`.
- Produces: right slide-in drawer (`translateX` + `cubic-bezier(0.16,1,0.3,1)`), dim overlay, header "Your Bag (n)", line items (thumb, name, price, qty −/+, remove), subtotal, "Proceed to Checkout" → `/cart`, "Continue shopping". Empty state. `cart-drawer.ts` renders items reactively from `$cart` (needs a slug→product lookup injected as JSON `<script type="application/json">`), handles qty/remove, Esc/overlay close, focus trap.

- [ ] **Step 1:** Implement drawer markup + styles (from checkout `code.html` drawer CSS lines 112–115) and embed a JSON product lookup for client rendering.
- [ ] **Step 2:** Implement `cart-drawer.ts` (subscribe, render, events, a11y).
- [ ] **Step 3: Verify** — add items → drawer lists them, qty/remove update subtotal & badge, persists across reload, Esc closes.
- [ ] **Step 4: Commit** — `feat: functional cart drawer`.

---

### Task 12: Home page

**Files:** Create `src/components/home/Hero.astro`, `FeaturedCollection.astro`, `CategoryTiles.astro`, `AtelierQuote.astro`, `src/scripts/reveal.ts`, `src/pages/index.astro`

**Interfaces:**
- Consumes: `getFeatured`, `getCollections`, `Image`, `Button`, `SectionHeading`.
- Produces: Home composed of Hero (full-viewport priority image, italic display headline "Objects shaped by earth, fire, hand, and time.", subcopy, "Explore the Atelier" editorial link), FeaturedCollection ("The First Firing" asymmetric 12-col grid: 8-col large image + 3-col offset text/quote + small image), CategoryTiles (Vessels/Tableware/Sculptural, 3:4 images, staggered `md:mt-24`, saturate-on-hover), AtelierQuote (large italic Garamond quote). `reveal.ts` = IntersectionObserver adding `.is-visible` to `.fade-up`, no-op under reduced motion.

- [ ] **Step 1:** Implement the four sections matching Stitch home (lines 136–249) with `Image` placeholders.
- [ ] **Step 2:** Implement `reveal.ts` + `index.astro` using BaseLayout.
- [ ] **Step 3: Verify** — home renders top-to-bottom; fade-up triggers on scroll; responsive (grid stacks, gaps shrink) at 375/768/1440.
- [ ] **Step 4: Commit** — `feat: home page`.

---

### Task 13: Product card + grid + badge

**Files:** Create `src/components/product/ProductCard.astro`, `ProductGrid.astro`, `Badge.astro`, `WishlistButton.astro`

**Interfaces:**
- Consumes: `Product`, `Image`, `formatPrice`, `$wishlist`/`toggleWishlist`, `addToCart`.
- Produces: borderless `ProductCard` (image hero w/ optional badge overlay + wishlist heart; subtitle label-caps; Garamond name; price; hover scale; links to `/objects/[slug]`). `Badge` (Limited Edition / Made to Order — celadon/secondary-container chip). `ProductGrid` props `{products, columns?}`. `WishlistButton` toggles store + reflects active state.

- [ ] **Step 1:** Implement components per Stitch objects grid (lines for cards in `objects_roots_rings/code.html`).
- [ ] **Step 2: Verify** card renders with badge + price; wishlist heart toggles & persists.
- [ ] **Step 3: Commit** — `feat: product card, grid, badge, wishlist`.

---

### Task 14: Catalog page (filters/sort/load-more)

**Files:** Create `src/components/catalog/FilterSidebar.astro`, `SortControl.astro`, `LoadMore.astro`, `src/scripts/filters.ts`, `src/pages/objects/index.astro`

**Interfaces:**
- Consumes: `getProducts`,`getFacets`,`ProductGrid`,`ProductCard`.
- Produces: `/objects` — hero band ("Objects" / "Small-batch ceramic works for quiet interiors."), result count + `SortControl`, `FilterSidebar` (Category/Clay Body/Attributes checkboxes; desktop sticky sidebar, mobile = toggle drawer via `$ui.filtersOpen`), responsive grid, `LoadMore` button. `filters.ts` does client-side filtering/sorting/pagination over a JSON-embedded product list (data attrs or embedded JSON), updates count, and reveals in pages of 9.

- [ ] **Step 1:** Implement page + sidebar + sort + load-more (Stitch objects refined/non-refined).
- [ ] **Step 2:** Implement `filters.ts` (checkbox + sort → filter; Load More; mobile drawer open/close).
- [ ] **Step 3: Verify** — filtering narrows grid + count; sort reorders; Load More reveals; mobile filter drawer works; a11y on controls.
- [ ] **Step 4: Commit** — `feat: catalog page with filters/sort/load-more`.

---

### Task 15: Product detail page (+ Archive Dossier)

**Files:** Create `src/components/product/Gallery.astro`, `SpecTable.astro`, `AddToBag.astro`, `RelatedProducts.astro`, `src/pages/objects/[slug].astro`

**Interfaces:**
- Consumes: `getProduct`,`getRelated`,`Image`,`Badge`,`SpecTable`,`AddToBag`,`Button`,`Newsletter`,`formatPrice`.
- Produces: `getStaticPaths` over all product slugs. Layout: breadcrumb (Objects / Category / Name); left stacked `Gallery` (primary + gallery images, varied aspect ratios); right info column (edition line e.g. "EDITION OF 40 · LIMITED" when `edition`/badge present, Garamond title, price, made-to-order note, description, `SpecTable` from `specs`, `AddToBag` island, "Request concierge advice" ghost). For limited editions also render Archive Dossier rows (archive ref, edition count, certificate-of-authenticity, lead time) + checkmark assurances. Below: curator's note; "Seen in Interiors" editorial band (offset card over lifestyle image); "Complete the Setting" `RelatedProducts` row; newsletter footer. `AddToBag` calls `addToCart(slug)` then `openCart()`.

- [ ] **Step 1:** Implement gallery/spec-table/add-to-bag/related per Stitch PDP + archive dossier screens.
- [ ] **Step 2:** Implement `[slug].astro` with `getStaticPaths`.
- [ ] **Step 3: Verify** — visiting `/objects/the-kura-vessel` renders full PDP; Add to Bag adds + opens drawer; limited-edition product shows dossier rows; responsive (columns stack on mobile).
- [ ] **Step 4: Commit** — `feat: product detail page + archive dossier`.

---

### Task 16: Cart page

**Files:** Create `src/pages/cart.astro`

**Interfaces:**
- Consumes: `$cart`,`setQty`,`removeFromCart`, product lookup JSON, `formatPrice`.
- Produces: full-page cart — line-item table (image, name, unit price, qty, line total, remove), order summary (subtotal, shipping note, total), "Proceed to Checkout" (stub → inline "Checkout connects once the store is live"), empty state linking to `/objects`. Reuses the drawer's client render logic where practical.

- [ ] **Step 1:** Implement `/cart` reading from `$cart`.
- [ ] **Step 2: Verify** — reflects drawer state; qty/remove update totals; empty state shows when cart cleared.
- [ ] **Step 3: Commit** — `feat: cart page`.

---

### Task 17: Stub pages + 404

**Files:** Create `src/pages/collections.astro`, `atelier.astro`, `journal.astro`, `trade.astro`, `about.astro`, `404.astro`

**Interfaces:** Consumes `BaseLayout`, `SectionHeading`, `Button`.
- Produces: branded pages using the shared shell. `collections.astro` lists collections from `getCollections()` as editorial tiles (real-ish). Others: tasteful "Coming soon — dispatch notes from the atelier" hero + back-to-Objects link + newsletter. `404`: branded not-found.

- [ ] **Step 1:** Implement the six pages.
- [ ] **Step 2: Verify** — every header/footer link resolves (no 404 except intended); pages match brand.
- [ ] **Step 3: Commit** — `feat: editorial stub pages + 404`.

---

### Task 18: Images — source, optimize, wire

**Files:** Add `frontend/src/assets/images/*`; modify components/data to import local assets via `astro:assets`.

**Interfaces:** Produces optimized responsive imagery across hero, featured, category tiles, product cards, galleries, lifestyle bands.

- [ ] **Step 1:** Attempt to download curated free ceramic/pottery photos (Unsplash source URLs) into `src/assets/images/` with descriptive names per product/section. Verify network works; if blocked, generate tonal placeholder images (solid earth-tone with subtle grain) at correct aspect ratios (4:5, 2:3, 1:1, 16:9) so layout is final.
- [ ] **Step 2:** Replace placeholder image refs with real imports; set `widths`/`sizes`, `loading` (hero eager+`fetchpriority=high`, rest lazy), `alt` from data.
- [ ] **Step 3: Verify** — `npm run build` emits AVIF/WebP; pages show images; no CLS (explicit dimensions); Network panel shows modern formats.
- [ ] **Step 4: Commit** — `feat: optimized local imagery`.

---

### Task 19: Final polish, a11y, perf, build

**Files:** Touch as needed across components; add `public/robots.txt`, confirm sitemap.

- [ ] **Step 1:** Accessibility pass — run through keyboard only (nav, menu, drawer, filters, add-to-bag), confirm focus rings/traps/aria/landmarks/alt; check color contrast on muted text.
- [ ] **Step 2:** Motion — confirm `prefers-reduced-motion` disables reveals/drawer easing nicety.
- [ ] **Step 3:** Run full test suite `npx vitest run` → all PASS. Run `npm run build` → success; check no unused-CSS bloat, fonts preloaded, sitemap generated.
- [ ] **Step 4:** Responsive QA at 375 / 768 / 1024 / 1440 across Home, Objects, PDP, Cart.
- [ ] **Step 5: Commit** — `chore: a11y, perf, responsive polish`.

---

## Self-Review

**Spec coverage:** Design system → Task 1 tokens. Data layer/seam → Tasks 2–4. Cart/wishlist state → Task 6. Home → Task 12. Catalog/filters → Tasks 13–14. PDP + Archive Dossier → Task 15. Cart drawer + page → Tasks 11, 16. Stubs → Task 17. Images → Task 18. Fonts/icons/SEO → Tasks 1,7. Responsiveness/motion/a11y/perf → Tasks 9–15 inline + Task 19. All spec sections covered.

**Placeholder scan:** Image refs intentionally staged (placeholder → real in Task 18) — this is sequencing, not a plan placeholder. No TBD/TODO logic steps.

**Type consistency:** `Product`/`Collection` from Task 2 used consistently; store action names (`addToCart`,`removeFromCart`,`setQty`,`toggleWishlist`,`openCart`) consistent across Tasks 6/9/11/13/15/16; `getProducts/getProduct/getRelated/getFacets/getFeatured/getCollections` consistent across Tasks 4/12/14/15.

**Note on TDD:** Logic units (schema, catalog, format, stores) are TDD with Vitest. Visual Astro components use build-and-verify gates (render + responsive + interaction checks) since they have no meaningful unit-test surface — appropriate for this layer.
