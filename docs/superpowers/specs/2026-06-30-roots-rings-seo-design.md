# Roots & Rings — Phase 8 Design Spec (SEO & structured data)

**Date:** 2026-06-30
**Status:** Approved
**Builds on:** Phases 1–7. The storefront already has good baseline meta in `BaseLayout.astro`
(per-page title/description, canonical, OG + Twitter cards, a `noindex` flag, and a `<slot name="head" />`).
This phase adds JSON-LD structured data, a working sitemap, and per-page meta polish.

## 0. Decisions (confirmed)

- **Full JSON-LD:** Organization + WebSite (sitewide), Product (PDP, with offers + aggregateRating +
  review snippets), BreadcrumbList (PDP + listings), ItemList (catalog/collections).
- **Dynamic `/sitemap.xml`** SSR endpoint querying the live catalog (replaces the inert
  `@astrojs/sitemap`, which only emits prerendered routes on this fully-SSR site).
- **Production domain `https://rootsandrings.net`** — set once (overridable via `PUBLIC_SITE_URL`),
  everything derives from it.
- **Frontend-only** (no migration). One small *optional* additive backend touch is allowed: exposing
  `seoTitle`/`seoDescription`/`updatedAt` on the product API if not already returned (the columns exist);
  if skipped, the PDP falls back to name/shortDescription and the sitemap omits `lastmod`.

## 1. Goals & non-goals

**Goals**
- Valid, rich JSON-LD on every page (Org/WebSite) + Product/Breadcrumb/ItemList where relevant.
- A complete, always-current `/sitemap.xml` covering static pages + all active products.
- `robots.txt` + canonical/OG pointing at the real domain; PDP OG image = product photo; `og:type=product`.
- Pure, unit-tested builders for the structured data and the sitemap XML.

**Non-goals (later)**
- hreflang/i18n, generated per-product OG images, FAQ/HowTo schema, a multi-file sitemap index,
  analytics/Search-Console wiring, per-collection dynamic routes (collections is one page today).

## 2. Domain configuration

- `src/data/site.ts`: `url` becomes `https://rootsandrings.net`, read from `PUBLIC_SITE_URL` when set
  (`import.meta.env.PUBLIC_SITE_URL ?? 'https://rootsandrings.net'`). All canonical/OG/sitemap/JSON-LD
  URLs derive from `site.url` (already the pattern in `BaseLayout`).
- `astro.config.ts`: `site: 'https://rootsandrings.net'`; **remove the `@astrojs/sitemap` integration**
  (and the dep) — the dynamic endpoint replaces it.

## 3. Structured data (JSON-LD)

**`src/lib/structured-data.ts`** — pure builder functions, each returns a complete schema object
(including `'@context': 'https://schema.org'`); no I/O, fully unit-testable:
- `organizationSchema()` → `Organization` (name, url, logo = absolute `site.ogImage`/logo, `sameAs` =
  the `site.social` links).
- `websiteSchema()` → `WebSite` (name, url, `potentialAction` = `SearchAction` targeting
  `${site.url}/objects?q={search_term_string}`).
- `siteSchema()` → `{ '@context', '@graph': [organization, website] }` (one script for the sitewide pair).
- `productSchema(product, canonicalUrl, ratings, reviews)` → `Product`: name, `image` (array of absolute
  URLs), description, sku, `brand` (`{ '@type':'Brand', name:'Roots & Rings' }`), `offers`
  (`{ '@type':'Offer', price, priceCurrency:'BDT', availability, url: canonicalUrl }`), `aggregateRating`
  (`{ ratingValue, reviewCount }`) **only when `ratingCount > 0`**, and `review` (a few recent
  `{ '@type':'Review', author, reviewRating, reviewBody }`) when present. `availability` =
  `https://schema.org/InStock` for an available product, `…/OutOfStock` if sold out.
- `breadcrumbSchema(items: {name,url}[])` → `BreadcrumbList` with positioned `ListItem`s.
- `itemListSchema(items: {name,url}[])` → `ItemList` with positioned `ListItem`s (url + name).

**`src/components/seo/JsonLd.astro`** — a dumb renderer: takes `schema` (object) and outputs
`<script type="application/ld+json" set:html={safeJson(schema)} />`, where `safeJson` is
`JSON.stringify(schema).replace(/</g, '\\u003c')` (prevents `</script>` breakout — same trick as
`lookupToJson`).

**Injection points:**
- `BaseLayout.astro` renders `<JsonLd schema={siteSchema()} />` in `<head>` → Org + WebSite on every page.
- PDP (`objects/[slug].astro`) renders, via the `head` slot, `<JsonLd slot="head" schema={productSchema(...)} />`
  + `<JsonLd slot="head" schema={breadcrumbSchema([Home, Objects, product])} />`.
- Catalog (`objects/index.astro`): `itemListSchema` of the listed products + `breadcrumbSchema([Home, Objects])`.
- Collections (`collections.astro`): `breadcrumbSchema([Home, Collections])` (+ `itemListSchema` of
  collections if it lists them).

## 4. Dynamic sitemap

**`src/lib/sitemap.ts`** — `buildSitemapXml(entries: {loc, lastmod?}[]): string` — a pure function that
renders a valid urlset XML (xml-escaping `loc`), unit-testable.
**`src/pages/sitemap.xml.ts`** — an SSR `GET` endpoint: builds the entry list = static indexable routes
(`/`, `/about`, `/atelier`, `/collections`, `/objects`) + every active product (`/objects/<slug>`,
`lastmod` = `updatedAt` when available) from `getProducts()`, calls `buildSitemapXml`, returns it with
`Content-Type: application/xml; charset=utf-8`. Excludes utility/private routes (`cart`, `checkout`,
`wishlist`, `404`, `account/*`, `api/*`). All `loc`s are absolute via `site.url`.

## 5. robots.txt + per-page meta

- `public/robots.txt`: `Sitemap: https://rootsandrings.net/sitemap.xml` (allow-all otherwise, unchanged).
- `BaseLayout.astro`: add an `ogType` prop (default `'website'`) driving `<meta property="og:type">`.
- PDP: pass `title = seoTitle ?? product.name`, `description = seoDescription ?? product.shortDescription`,
  `image = product.images[0].src` (OG image = product photo), `ogType = 'product'`. (`seoTitle`/
  `seoDescription` used only if exposed on the product — see §0; otherwise the fallbacks apply.)
- Catalog/collections/about/atelier: ensure a tailored `title` + `description` where currently generic.

## 6. Security & correctness

- All embedded JSON-LD is `<`-escaped to prevent `</script>` breakout; values come from server-side
  catalog data, never raw user input (review bodies are already sanitized server-side in Phase 5).
- All URLs in JSON-LD + sitemap are absolute (built from `site.url`), required by the specs.
- `aggregateRating` is emitted only when `ratingCount > 0` (Google rejects empty ratings → avoids a
  Search-Console error).
- The sitemap lists only indexable, active, public pages; `noindex` pages (cart/checkout/wishlist) are
  excluded and already carry `<meta robots noindex>`.

## 7. Testing

- **Unit (frontend, Vitest):** `structured-data.ts` — `productSchema` shape (offers price/currency,
  `availability`, `aggregateRating` present iff `ratingCount>0`, absolute image URLs); `breadcrumbSchema`
  positions; `itemListSchema` positions; `siteSchema` graph. `sitemap.ts` — `buildSitemapXml` produces a
  valid urlset, includes a product `loc`, xml-escapes special chars.
- **Verification (curl):** `/sitemap.xml` → valid XML listing product URLs + the real domain;
  a PDP → the `ld+json` Product parses and has offers + (when rated) aggregateRating; the home page →
  Org/WebSite JSON-LD; `robots.txt` → the new sitemap URL; `astro build` clean.
- Existing **150 backend + 43 frontend** stay green; this phase adds the new frontend unit tests.
- No backend test changes unless the optional DTO field-exposure is taken (then a small DTO assertion).

## 8. File structure

**Frontend (new):** `src/lib/structured-data.ts`, `src/lib/sitemap.ts`,
`src/components/seo/JsonLd.astro`, `src/pages/sitemap.xml.ts`, and the matching test files
(`src/lib/structured-data.test.ts`, `src/lib/sitemap.test.ts`).
**Frontend (modified):** `src/data/site.ts` (domain), `astro.config.ts` (site + drop sitemap integration),
`public/robots.txt`, `src/layouts/BaseLayout.astro` (siteSchema + `ogType`),
`src/pages/objects/[slug].astro` (Product/Breadcrumb JSON-LD + OG image + ogType),
`src/pages/objects/index.astro` + `src/pages/collections.astro` (ItemList/Breadcrumb + titles),
optionally `src/lib/schema.ts` + `src/lib/api.ts` (+ backend product DTO) if exposing `seoTitle`/
`seoDescription`/`updatedAt`.

## 9. Rollout

No migration; `@astrojs/sitemap` removed. With the real domain in `site.url`, all canonical/OG/sitemap/
JSON-LD switch to `rootsandrings.net` immediately (or override per-environment via `PUBLIC_SITE_URL`).
After deploy: submit `https://rootsandrings.net/sitemap.xml` in Google Search Console and validate the
PDP with the Rich Results Test. After Phase 8: bKash live, i18n/multi-currency, infra enhancements.
