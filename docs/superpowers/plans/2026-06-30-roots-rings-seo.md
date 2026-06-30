# Roots & Rings Phase 8 — SEO & structured data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full JSON-LD structured data, a dynamic `/sitemap.xml`, and per-page meta polish so the storefront is rich-result eligible and fully crawlable.

**Architecture:** Pure builder functions (structured-data + sitemap XML) rendered by a tiny `JsonLd.astro` component; sitewide Org/WebSite JSON-LD in `BaseLayout`, page-specific Product/Breadcrumb/ItemList via the existing `<slot name="head" />`; an SSR `/sitemap.xml` endpoint over the live catalog. Frontend-only, no migration.

**Tech Stack:** Astro 5 SSR, Tailwind v4, Vitest. Real domain `https://rootsandrings.net`.

## Global Constraints

- **Branch `phase-8-seo`**, normal per-task commits (Conventional Commits; end the body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).
- **Ampersand-path gotcha:** project in `D:\Roots & Rings` — `&` breaks `npm run`. Call node entrypoints directly (never `npm run`):
  - Frontend build: `cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build`
  - Frontend tests: `cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run [tests/<file>]`
- **Frontend tests live in `frontend/tests/`** (vitest `include: ['tests/**/*.test.ts']`), importing from `../src/...`.
- **The new builder tests are pure** (no network) — runnable standalone. The FULL frontend suite (43) includes catalog tests that hit the backend, so a backend dev server must be UP for a full-suite run (the controller keeps one running); `astro build` does NOT need the backend.
- **Do NOT add or remove npm dependencies, and do NOT run `astro check`** (it would pull in new deps). Verification = `astro build` + the test suite.
- **DO NOT change the UI design.** This phase adds `<head>`/markup only; no visual changes.
- **Domain = `https://rootsandrings.net`**, sourced from `site.url` (overridable via `PUBLIC_SITE_URL`). Every JSON-LD/sitemap/canonical URL is **absolute**, built from `site.url`.
- **JSON-LD safety:** every embedded JSON is `<`-escaped (`.replace(/</g, '\\u003c')`) to prevent `</script>` breakout. `aggregateRating` is emitted **only when `ratingCount > 0`**.
- **seoTitle/seoDescription are NOT exposed** (not in the frontend `Product` type); the PDP uses `name`/`shortDescription` (YAGNI — can add later). The `@astrojs/sitemap` integration is removed from `astro.config` but its dep is left in `package.json` (harmless; uninstall later) to avoid npm churn.

---

### Task 1: Domain + robots + drop @astrojs/sitemap integration

**Files:**
- Modify: `frontend/src/data/site.ts`
- Modify: `frontend/astro.config.ts`
- Modify: `frontend/public/robots.txt`

**Interfaces:**
- Produces: `site.url === 'https://rootsandrings.net'` (or `PUBLIC_SITE_URL`); no `@astrojs/sitemap` integration; `robots.txt` pointing at `/sitemap.xml`.

- [ ] **Step 1: Set the domain in `frontend/src/data/site.ts`**

Change the `url` line to read the env override with the real default:
```ts
  url: import.meta.env.PUBLIC_SITE_URL ?? 'https://rootsandrings.net',
```

- [ ] **Step 2: Update `frontend/astro.config.ts`** — set the real `site` and remove the sitemap integration. The file becomes:

```ts
// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://rootsandrings.net',
  // SSR so catalog pages read live data from the backend API (no UI change).
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [],
  vite: {
    plugins: [tailwindcss()],
  },
  image: {
    responsiveStyles: true,
  },
});
```
(Removed the `import sitemap from '@astrojs/sitemap';` line and the `sitemap()` entry. The dep stays in `package.json` unused.)

- [ ] **Step 3: Update `frontend/public/robots.txt`** to:

```
User-agent: *
Allow: /

Sitemap: https://rootsandrings.net/sitemap.xml
```

- [ ] **Step 4: Build + verify the domain propagates**

```
cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build
```
Expected: build completes ("Complete!"), no error about the missing `@astrojs/sitemap` import.

- [ ] **Step 5: Commit**

```
git add frontend/src/data/site.ts frontend/astro.config.ts frontend/public/robots.txt
git commit -m "feat(seo): real domain + robots sitemap; drop inert @astrojs/sitemap"
```

---

### Task 2: Structured-data builders + JsonLd component

**Files:**
- Create: `frontend/src/lib/structured-data.ts`
- Create: `frontend/src/components/seo/JsonLd.astro`
- Test: `frontend/tests/structured-data.test.ts`

**Interfaces:**
- Consumes: `site` (`../data/site`), `Product` (`./schema`).
- Produces: `organizationSchema()`, `websiteSchema()`, `siteSchema()`, `productSchema(product, canonicalUrl, reviews?)`, `breadcrumbSchema(items)`, `itemListSchema(items)`; `interface ReviewLite { authorName: string; rating: number; title: string | null; body: string | null }`; component `JsonLd.astro` (prop `schema: unknown`).

- [ ] **Step 1: Write the failing test — `frontend/tests/structured-data.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { siteSchema, productSchema, breadcrumbSchema, itemListSchema } from '../src/lib/structured-data';
import type { Product } from '../src/lib/schema';

const baseProduct = {
  slug: 'kura-vessel', name: 'Kura Vessel', subtitle: 'Stoneware', price: 800, currency: 'BDT',
  category: 'vessels', clayBody: 'stoneware', badges: [], shortDescription: 'A quiet vessel.',
  description: 'desc', curatorsNote: 'note', specs: {}, images: [{ src: 'https://cdn.x/kura.webp', alt: 'Kura' }],
  relatedSlugs: [], createdAt: '2026-06-01T00:00:00.000Z', ratingAvg: null, ratingCount: 0,
} as unknown as Product;

describe('siteSchema', () => {
  it('emits an Organization + WebSite graph with @context', () => {
    const s = siteSchema() as any;
    expect(s['@context']).toBe('https://schema.org');
    const types = s['@graph'].map((n: any) => n['@type']);
    expect(types).toContain('Organization');
    expect(types).toContain('WebSite');
  });
});

describe('productSchema', () => {
  it('builds a Product with absolute image + offers, and NO aggregateRating when unrated', () => {
    const s = productSchema(baseProduct, 'https://rootsandrings.net/objects/kura-vessel') as any;
    expect(s['@type']).toBe('Product');
    expect(s.image).toEqual(['https://cdn.x/kura.webp']);
    expect(s.offers.price).toBe(800);
    expect(s.offers.priceCurrency).toBe('BDT');
    expect(s.offers.availability).toContain('InStock');
    expect(s.offers.url).toBe('https://rootsandrings.net/objects/kura-vessel');
    expect(s.aggregateRating).toBeUndefined();
  });

  it('includes aggregateRating only when ratingCount > 0', () => {
    const rated = { ...baseProduct, ratingAvg: 4.5, ratingCount: 3 } as Product;
    const s = productSchema(rated, 'https://rootsandrings.net/objects/kura-vessel') as any;
    expect(s.aggregateRating.ratingValue).toBe(4.5);
    expect(s.aggregateRating.reviewCount).toBe(3);
  });

  it('includes review snippets when provided', () => {
    const s = productSchema(baseProduct, 'https://x/p', [{ authorName: 'Mira', rating: 5, title: 'Lovely', body: 'Great' }]) as any;
    expect(s.review[0]['@type']).toBe('Review');
    expect(s.review[0].author.name).toBe('Mira');
    expect(s.review[0].reviewRating.ratingValue).toBe(5);
  });
});

describe('breadcrumbSchema / itemListSchema', () => {
  it('positions breadcrumb items from 1 and absolutizes urls', () => {
    const s = breadcrumbSchema([{ name: 'Home', url: '/' }, { name: 'Objects', url: '/objects' }]) as any;
    expect(s['@type']).toBe('BreadcrumbList');
    expect(s.itemListElement[0].position).toBe(1);
    expect(s.itemListElement[1].item).toBe('https://rootsandrings.net/objects');
  });

  it('itemList positions items from 1', () => {
    const s = itemListSchema([{ name: 'A', url: '/objects/a' }, { name: 'B', url: '/objects/b' }]) as any;
    expect(s['@type']).toBe('ItemList');
    expect(s.itemListElement.map((e: any) => e.position)).toEqual([1, 2]);
    expect(s.itemListElement[0].url).toBe('https://rootsandrings.net/objects/a');
  });
});
```
(The test assumes `site.url` resolves to `https://rootsandrings.net` — true once Task 1 lands and no `PUBLIC_SITE_URL` is set in the test env.)

- [ ] **Step 2: Run it — verify it fails**

```
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run tests/structured-data.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `frontend/src/lib/structured-data.ts`**

```ts
import { site } from '../data/site';
import type { Product } from './schema';

const CONTEXT = 'https://schema.org';

/** Absolutize a URL/path against the site origin (leaves already-absolute http(s) URLs intact). */
const abs = (pathOrUrl: string): string =>
  /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : new URL(pathOrUrl, site.url).href;

export function organizationSchema() {
  return {
    '@type': 'Organization',
    name: site.name,
    url: site.url,
    logo: abs(site.ogImage),
    sameAs: Object.values(site.social),
  };
}

export function websiteSchema() {
  return {
    '@type': 'WebSite',
    name: site.name,
    url: site.url,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${site.url}/objects?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

/** Sitewide pair, one script. */
export function siteSchema() {
  return { '@context': CONTEXT, '@graph': [organizationSchema(), websiteSchema()] };
}

export interface ReviewLite {
  authorName: string;
  rating: number;
  title: string | null;
  body: string | null;
}

export function productSchema(product: Product, canonicalUrl: string, reviews: ReviewLite[] = []) {
  const schema: Record<string, unknown> = {
    '@context': CONTEXT,
    '@type': 'Product',
    name: product.name,
    image: product.images.map((i) => abs(i.src)),
    description: product.shortDescription,
    sku: product.slug,
    brand: { '@type': 'Brand', name: site.name },
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: product.currency,
      availability: 'https://schema.org/InStock',
      url: canonicalUrl,
    },
  };
  if (product.ratingCount > 0 && product.ratingAvg != null) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: product.ratingAvg,
      reviewCount: product.ratingCount,
    };
  }
  if (reviews.length) {
    schema.review = reviews.slice(0, 5).map((r) => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: r.authorName },
      reviewRating: { '@type': 'Rating', ratingValue: r.rating },
      ...(r.title ? { name: r.title } : {}),
      ...(r.body ? { reviewBody: r.body } : {}),
    }));
  }
  return schema;
}

export function breadcrumbSchema(items: { name: string; url: string }[]) {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: it.name,
      item: abs(it.url),
    })),
  };
}

export function itemListSchema(items: { name: string; url: string }[]) {
  return {
    '@context': CONTEXT,
    '@type': 'ItemList',
    itemListElement: items.map((it, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: it.name,
      url: abs(it.url),
    })),
  };
}
```

- [ ] **Step 4: Create `frontend/src/components/seo/JsonLd.astro`**

```astro
---
interface Props {
  schema: unknown;
}
const { schema } = Astro.props;
// Escape `<` so a stray "</script>" in any field can't break out of the tag.
const json = JSON.stringify(schema).replace(/</g, '\\u003c');
---
<script type="application/ld+json" set:html={json} />
```

- [ ] **Step 5: Run the test — verify it passes**

```
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run tests/structured-data.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 6: Build + commit**

```
cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build
git add frontend/src/lib/structured-data.ts frontend/src/components/seo/JsonLd.astro frontend/tests/structured-data.test.ts
git commit -m "feat(seo): JSON-LD structured-data builders + JsonLd component (TDD)"
```
Expected: build OK; tests green.

---

### Task 3: Dynamic sitemap (builder + endpoint)

**Files:**
- Create: `frontend/src/lib/sitemap.ts`
- Create: `frontend/src/pages/sitemap.xml.ts`
- Test: `frontend/tests/sitemap.test.ts`

**Interfaces:**
- Consumes: `getProducts()` (`../lib/catalog`), `site` (`../data/site`).
- Produces: `interface SitemapEntry { loc: string; lastmod?: string }`; `buildSitemapXml(entries): string`; the SSR route `GET /sitemap.xml`.

- [ ] **Step 1: Write the failing test — `frontend/tests/sitemap.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildSitemapXml } from '../src/lib/sitemap';

describe('buildSitemapXml', () => {
  it('renders a valid urlset with loc + optional lastmod', () => {
    const xml = buildSitemapXml([
      { loc: 'https://rootsandrings.net/' },
      { loc: 'https://rootsandrings.net/objects/kura-vessel', lastmod: '2026-06-01' },
    ]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset');
    expect(xml).toContain('<loc>https://rootsandrings.net/objects/kura-vessel</loc>');
    expect(xml).toContain('<lastmod>2026-06-01</lastmod>');
    expect(xml.match(/<url>/g)?.length).toBe(2);
  });

  it('xml-escapes special characters in loc', () => {
    const xml = buildSitemapXml([{ loc: 'https://rootsandrings.net/objects?q=a&b' }]);
    expect(xml).toContain('q=a&amp;b');
    expect(xml).not.toContain('q=a&b<');
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run tests/sitemap.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `frontend/src/lib/sitemap.ts`**

```ts
export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

export function buildSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map((e) => {
      const lastmod = e.lastmod ? `\n    <lastmod>${xmlEscape(e.lastmod)}</lastmod>` : '';
      return `  <url>\n    <loc>${xmlEscape(e.loc)}</loc>${lastmod}\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
```

- [ ] **Step 4: Implement the endpoint `frontend/src/pages/sitemap.xml.ts`**

```ts
import type { APIRoute } from 'astro';
import { getProducts } from '../lib/catalog';
import { buildSitemapXml, type SitemapEntry } from '../lib/sitemap';
import { site } from '../data/site';

const STATIC_PATHS = ['/', '/objects', '/collections', '/about', '/atelier'];

export const GET: APIRoute = async () => {
  const entries: SitemapEntry[] = STATIC_PATHS.map((p) => ({ loc: new URL(p, site.url).href }));
  try {
    const products = await getProducts();
    for (const p of products) {
      entries.push({
        loc: new URL(`/objects/${p.slug}`, site.url).href,
        lastmod: typeof p.createdAt === 'string' ? p.createdAt.slice(0, 10) : undefined,
      });
    }
  } catch {
    // Catalog unreachable → still serve the static sitemap.
  }
  return new Response(buildSitemapXml(entries), {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
};
```

- [ ] **Step 5: Run the test — verify it passes**

```
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run tests/sitemap.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 6: Build + commit**

```
cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build
git add frontend/src/lib/sitemap.ts frontend/src/pages/sitemap.xml.ts frontend/tests/sitemap.test.ts
git commit -m "feat(seo): dynamic /sitemap.xml over the live catalog (TDD)"
```
Expected: build OK (a `sitemap.xml` route is emitted); tests green.

---

### Task 4: Sitewide JSON-LD + og:type in BaseLayout

**Files:**
- Modify: `frontend/src/layouts/BaseLayout.astro`

**Interfaces:**
- Consumes: `siteSchema` (`../lib/structured-data`), `JsonLd` (`../components/seo/JsonLd.astro`).
- Produces: every page carries Org + WebSite JSON-LD; `BaseLayout` accepts an `ogType` prop (default `'website'`).

- [ ] **Step 1: Add the imports + prop in `BaseLayout.astro`**

In the frontmatter, add to the imports:
```ts
import JsonLd from '../components/seo/JsonLd.astro';
import { siteSchema } from '../lib/structured-data';
```
Add `ogType` to the `Props` interface and destructuring:
```ts
  ogType?: string;
```
```ts
  ogType = 'website',
```
(Add `ogType = 'website'` alongside the other destructured props with defaults.)

- [ ] **Step 2: Use `ogType` + render the sitewide JSON-LD**

Change the hardcoded og:type line:
```astro
    <meta property="og:type" content={ogType} />
```
And immediately before the `<slot name="head" />` line in `<head>`, add:
```astro
    <JsonLd schema={siteSchema()} />
```

- [ ] **Step 3: Build + run the full frontend suite (backend up)**

```
cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run
```
Expected: build OK; 43 + 8 (Tasks 2-3) = 51 passed. (If catalog tests fail with a network error, the backend dev server isn't up — the controller starts one.)

- [ ] **Step 4: Commit**

```
git add frontend/src/layouts/BaseLayout.astro
git commit -m "feat(seo): sitewide Organization/WebSite JSON-LD + configurable og:type"
```

---

### Task 5: Product + listing JSON-LD & PDP meta

**Files:**
- Modify: `frontend/src/pages/objects/[slug].astro`
- Modify: `frontend/src/pages/objects/index.astro`
- Modify: `frontend/src/pages/collections.astro`

**Interfaces:**
- Consumes: `JsonLd`, `productSchema`/`breadcrumbSchema`/`itemListSchema`/`ReviewLite` (structured-data), `site`.

- [ ] **Step 1: PDP — `frontend/src/pages/objects/[slug].astro`**

In the frontmatter, add imports + compute the canonical + review list. Add near the other imports:
```ts
import JsonLd from '../../components/seo/JsonLd.astro';
import { productSchema, breadcrumbSchema, type ReviewLite } from '../../lib/structured-data';
import { site } from '../../data/site';
```
After `reviews` is fetched, add:
```ts
const canonical = new URL(`/objects/${slug}`, site.url).href;
const reviewsForLd: ReviewLite[] = reviews.items.map((r) => ({ authorName: r.authorName, rating: r.rating, title: r.title, body: r.body }));
const crumbs = [
  { name: 'Home', url: '/' },
  { name: 'Objects', url: '/objects' },
  { name: product.name, url: `/objects/${slug}` },
];
```
Change the `<BaseLayout …>` opening tag to add the OG image + product type:
```astro
<BaseLayout title={product.name} description={product.shortDescription} image={product.images[0].src} ogType="product">
```
Immediately after the `<BaseLayout …>` opening tag, add the JSON-LD (it lands in the head via the named slot):
```astro
  <JsonLd slot="head" schema={productSchema(product, canonical, reviewsForLd)} />
  <JsonLd slot="head" schema={breadcrumbSchema(crumbs)} />
```

- [ ] **Step 2: Catalog — `frontend/src/pages/objects/index.astro`**

Add imports near the top of the frontmatter:
```ts
import JsonLd from '../../components/seo/JsonLd.astro';
import { itemListSchema, breadcrumbSchema } from '../../lib/structured-data';
```
Immediately after the `<BaseLayout …>` opening tag, add:
```astro
  <JsonLd slot="head" schema={breadcrumbSchema([{ name: 'Home', url: '/' }, { name: 'Objects', url: '/objects' }])} />
  <JsonLd slot="head" schema={itemListSchema(products.map((p) => ({ name: p.name, url: `/objects/${p.slug}` })))} />
```

- [ ] **Step 3: Collections — `frontend/src/pages/collections.astro`**

Add imports near the top of the frontmatter:
```ts
import JsonLd from '../components/seo/JsonLd.astro';
import { breadcrumbSchema } from '../lib/structured-data';
```
Immediately after the `<BaseLayout …>` opening tag, add:
```astro
  <JsonLd slot="head" schema={breadcrumbSchema([{ name: 'Home', url: '/' }, { name: 'Collections', url: '/collections' }])} />
```

- [ ] **Step 4: Build + full suite**

```
cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run
```
Expected: build OK; suite green (51). The new JSON-LD is rendered server-side (verified by curl in Task 6).

- [ ] **Step 5: Commit**

```
git add frontend/src/pages/objects/[slug].astro frontend/src/pages/objects/index.astro frontend/src/pages/collections.astro
git commit -m "feat(seo): Product/Breadcrumb/ItemList JSON-LD + PDP OG image & og:type=product"
```

---

### Task 6: Verification sweep + memory

**Files:**
- Modify: `C:\Users\PC\.claude\projects\D--Roots---Rings\memory\MEMORY.md` + new `roots-rings-phase8-seo.md`

- [ ] **Step 1: Suites + build**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run
cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build
```
Expected: backend 150; frontend 51 (43 + structured-data 6 + sitemap 2); build OK.

- [ ] **Step 2: Live curl verification (controller-run)** — with the backend (`:4000`) and the SSR frontend (`PORT=4321 node dist/server/entry.mjs`) running:
  1. `curl -s http://127.0.0.1:4321/sitemap.xml | head` → valid `<urlset>` with `https://rootsandrings.net/...` static + product `loc`s.
  2. `curl -s http://127.0.0.1:4321/robots.txt` → `Sitemap: https://rootsandrings.net/sitemap.xml`.
  3. `curl -s http://127.0.0.1:4321/` → an `application/ld+json` script containing `"Organization"` + `"WebSite"`.
  4. `curl -s http://127.0.0.1:4321/objects/<slug>` → a Product `ld+json` with `"offers"` (and `"aggregateRating"` if the product is rated), plus a BreadcrumbList; `og:type` = `product`; `og:image` = the product photo. Parse each `ld+json` block to confirm it's valid JSON.

- [ ] **Step 3: Update memory** — create `roots-rings-phase8-seo.md` (SEO BUILT: structured-data builders + JsonLd; sitewide Org/WebSite; PDP Product+offers+aggregateRating+reviews; Breadcrumb/ItemList; dynamic /sitemap.xml; domain rootsandrings.net via PUBLIC_SITE_URL; @astrojs/sitemap integration dropped) + a one-line pointer in `MEMORY.md`.

- [ ] **Step 4: Report** the final counts + the curl-verification results.

---

## Self-Review

**1. Spec coverage** (spec §2–§7 → tasks):
- §2 domain config (site.ts + astro.config) → Task 1. ✅
- §3 structured data (builders + JsonLd + sitewide in BaseLayout + per-page injection) → Tasks 2, 4, 5. ✅
- §4 dynamic sitemap (builder + endpoint) → Task 3. ✅
- §5 robots + meta (robots.txt, ogType, PDP OG image/type) → Tasks 1, 4, 5. ✅
- §6 security (escaping, absolute URLs, aggregateRating gating) → Tasks 2, 3 (asserted in tests). ✅
- §7 testing (builder + sitemap unit tests; curl verification; regression) → Tasks 2, 3, 6. ✅
- §8 file structure → matches Tasks 1–5. (`seoTitle` exposure intentionally skipped per Global Constraints; `@astrojs/sitemap` dep left installed-but-unused.) ✅

**2. Placeholder scan:** every code step has complete code; every unit-test step has real assertions; frontend verification is explicit (`astro build` + the test suite + curl). No TBD/TODO.

**3. Type consistency:** `siteSchema()`/`productSchema(product, canonicalUrl, reviews?)`/`breadcrumbSchema(items)`/`itemListSchema(items)`/`ReviewLite` (Task 2) are consumed with matching signatures in Tasks 4 (siteSchema) and 5 (productSchema with `(product, canonical, reviewsForLd)`, breadcrumb/itemList with `{name,url}[]`). `JsonLd` takes `schema` and is used identically in BaseLayout + the pages. `buildSitemapXml(SitemapEntry[])` (Task 3) matches the endpoint's call. `ReviewLite {authorName,rating,title,body}` matches the PDP's `reviews.items` shape (`{authorName, rating, title, body}`). `site.url` (Task 1) feeds the `abs()` helper + the endpoint + the PDP canonical. The `ogType` prop (Task 4) is passed by the PDP (Task 5). ✅
