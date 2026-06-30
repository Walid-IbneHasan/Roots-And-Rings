# Roots & Rings — Frontend Design Spec

**Date:** 2026-06-29
**Status:** Approved
**Scope:** Frontend only (Astro). Fastify backend is a later, separate effort.

## 1. Overview

Roots & Rings is an e-commerce site for artisan pottery / ceramics. This spec covers
the **frontend**, built with **Astro** for a fast, lightweight, mostly-static site.
The visual design is taken verbatim from the provided Google Stitch export
("Slow Luxury Artisan" design system).

Brand essence: a private-gallery, "slow luxury" experience — editorial, calm, lots of
whitespace, sharp corners, hairline dividers, no drop shadows, photography as hero.

## 2. Goals & non-goals

**Goals**
- Faithfully implement the Stitch screens: Home, Objects (catalog/PLP), Product detail
  (PDP, incl. Archive Dossier fields), Cart/Checkout drawer.
- Fully responsive (mobile-first).
- Maximum performance: minimal JS, optimized images & fonts, ~100 Lighthouse target.
- Functional client-side cart + wishlist (localStorage), with a clean seam to swap to a
  Fastify API later.
- Accessible (keyboard nav, focus states, aria, reduced-motion).

**Non-goals (this pass)**
- Real backend, payments, auth, real checkout submission.
- Full editorial content for Collections/Atelier/Journal/Trade/About (branded stubs only).

## 3. Design system (from Stitch `DESIGN.md`)

**Colors** (key tokens)
- `surface` / `background`: `#fef9f1` (bone porcelain)
- `on-surface` / text: `#1d1c17` (charcoal ink)
- `on-surface-variant`: `#4d4540`
- `outline`: `#7e7570`; `outline-variant`: `#d0c4be`
- `primary`: `#000000`, `on-primary`: `#ffffff`
- `secondary` (burnt umber accent): `#875134`; `secondary-container`: `#feb693`
- surface containers: low `#f8f3eb`, `#f2ede5`, high `#ece8e0`, highest `#e7e2da`
- `inverse-surface`: `#32302b`, `inverse-on-surface`: `#f5f0e8`
- Hairline divider: `rgba(140,131,120,0.3)`

**Typography**
- **EB Garamond** — display & headlines (often italic for emphasis)
  - display-lg 64px / mobile 40px; headline-md 32px; headline-sm 24px
- **Inter** — body, labels, nav
  - body-lg 18px, body-md 15px, caption 13px
  - subheader 12px (tracking .15em), label-caps 10px uppercase (tracking .2em)

**Layout / shape**
- Sharp corners (0px radius) everywhere.
- Depth via tonal layers + hairline strokes, **never** drop shadows.
- Container max 1440px; desktop margin 80px, mobile 20px; gutter 32px; section gap 160px.
- Asymmetric "art-book" grids (e.g. 8-col image next to a 3-col text block).

## 4. Tech stack & decisions

- **Astro 5**, static output (SSG). Move to SSR/hybrid only when Fastify lands.
- **Tailwind CSS v4** via `@tailwindcss/vite` (not CDN). Stitch tokens in a CSS-first
  `@theme` block in `src/styles/global.css`. Unused CSS tree-shaken.
- **Interactivity:** vanilla-JS islands + **nanostores** (`@nanostores/persistent`).
  No React/Preact runtime shipped. Cart, drawer, wishlist, filters, mobile menu all run
  on small vanilla scripts subscribing to stores.
- **Fonts:** self-hosted via Fontsource (`@fontsource-variable/inter`,
  `@fontsource/eb-garamond`). `font-display: swap`, preloaded. No Google CDN.
- **Icons:** inline SVG (replacing Stitch's Material Symbols font).
- **Images:** `astro:assets` `<Image>`/`<Picture>` over local curated photos →
  AVIF/WebP, responsive `srcset`, explicit dimensions, lazy by default; hero priority.
- **TypeScript** strict.
- **SEO:** per-page meta + Open Graph, `@astrojs/sitemap`, semantic HTML.

## 5. Data layer (Fastify-later seam)

`src/lib/catalog.ts` exposes async functions:
- `getProducts(filters?)`, `getProduct(slug)`, `getCollections()`, `getRelated(slug)`.

Today these read typed mock data in `src/data/products.ts` (and `collections.ts`),
validated by a **Zod** schema. To go live with Fastify, replace the function bodies with
`fetch()` calls — no consumer changes.

**Product schema (fields):** `slug`, `name`, `subtitle/category-label`, `price`,
`currency`, `category` (Vessels|Bowls|Plates|Sculptural|Tableware), `clayBody`
(Stoneware|Porcelain|Earthenware), `badges` (Limited Edition|Made to Order),
`shortDescription`, `description`, `curatorsNote`, `specs` (dimensions, weight, clayBody,
firing, glaze), `edition` (optional: ref, count, certificate), `images[]` (primary +
gallery), `relatedSlugs[]`, `seenInInteriors` (optional editorial block).

## 6. Pages

- `/` **Home** — fixed top nav; cinematic hero (priority image, italic display headline);
  "The First Firing" featured asymmetric grid; 3 category tiles (Vessels / Tableware /
  Sculptural Objects); atelier philosophy quote; minimal footer.
- `/objects` **Catalog (PLP)** — hero band ("Objects"); count + Sort control; filter
  sidebar (Category / Clay Body / Attributes) that collapses to a drawer on mobile;
  responsive product grid with badges; "Load More" (progressive reveal of mock set).
- `/objects/[slug]` **Product detail (PDP)** — breadcrumb; stacked image gallery;
  info column (edition line, title, price, made-to-order note, description, spec table,
  **Add to Bag**, "Request concierge advice"); curator's note; "Seen in Interiors"
  editorial band; "Complete the Setting" related products; newsletter footer. For
  limited-edition products, render Archive Dossier extras (archive ref, edition count,
  certificate-of-authenticity, made-to-order lead time).
- `/cart` **Cart page** + global **slide-in cart drawer** — line items, qty +/-, remove,
  subtotal, "proceed to checkout" (stub). Persisted to localStorage.
- **Stubs:** `/collections`, `/atelier`, `/journal`, `/trade`, `/about`,
  plus `/404` — branded, same shell.

## 7. Components

- **layout:** `BaseLayout.astro`, `Header.astro` (centered wordmark, opacity-hover nav,
  icon group, live cart-count badge), `MobileMenu` (full-screen overlay), `Footer.astro`,
  `Newsletter.astro`.
- **cart:** `CartDrawer.astro` + `cart-drawer.ts` island, `CartButton`.
- **product:** `ProductCard.astro`, `ProductGrid.astro`, `Badge.astro`, `Gallery.astro`,
  `SpecTable.astro`, `AddToBag` (island), `RelatedProducts.astro`, wishlist toggle.
- **catalog:** `FilterSidebar` (island), `SortControl`, `LoadMore`.
- **ui:** `Button.astro`, `Hairline.astro`, `SectionHeading.astro`, SVG `Icon.astro`.
- **home:** `Hero`, `FeaturedCollection`, `CategoryTiles`, `AtelierQuote`.

## 8. State (nanostores)

- `$cart` (persistent): `{ items: { slug, qty }[] }`; derived `$cartCount`, `$cartSubtotal`.
- `$wishlist` (persistent): `string[]` of slugs.
- `$ui`: `{ cartOpen, mobileMenuOpen, filtersOpen }` (ephemeral).
- Actions: `addToCart`, `removeFromCart`, `setQty`, `toggleWishlist`, drawer open/close.
- Vanilla scripts subscribe and update DOM (count badges, drawer contents, toggles).

## 9. Responsiveness

Mobile-first. Breakpoints via Tailwind (`md` ~768, `lg` ~1024). Mobile menu = full-screen
overlay; catalog filters = bottom/side drawer; multi-col grids reflow to 1–2 cols;
section gaps and margins scale down (160→ smaller, 80→20px).

## 10. Motion & accessibility

- IntersectionObserver-driven `fade-up` reveals (y-shift + opacity), **disabled** under
  `prefers-reduced-motion`.
- Cart drawer slide (`cubic-bezier(0.16,1,0.3,1)`), image hover scale.
- Keyboard-operable drawer/menu/filters (focus trap, Esc to close), visible focus rings,
  aria labels/roles, semantic landmarks, alt text on all images.

## 11. Performance budget

- No UI framework runtime. Per-island JS only, hydrated lazily where possible.
- Self-hosted fonts preloaded; images AVIF/WebP responsive; CSS purged.
- Target ~100 Lighthouse (perf/a11y/best-practices/SEO); zero CLS via explicit media dims.

## 12. Risks

- **Image sourcing** needs network access. Plan: download curated free ceramic photos to
  `src/assets/images/`. Fallback if blocked: elegant tonal placeholders at correct aspect
  ratios; real photos drop into the same paths later.
