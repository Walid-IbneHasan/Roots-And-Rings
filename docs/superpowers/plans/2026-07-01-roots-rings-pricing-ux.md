# Roots & Rings Phase 11 — Category image upload + sale/flash price display + flash section — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins upload category images (WebP) from their device, show sale/flash discounts (strike-through + −%) on the storefront, and add a home-page flash-sale section.

**Architecture:** Part A — a generic admin image-upload endpoint (`processImage` → WebP) + a file picker on the category form that fills `imageUrl`. Part B — map the already-computed `compareAt`/`isOnSale`/`isOnFlash` to the frontend and render the discount. Part C — a `getFlashProducts` query + `/api/products/flash` + a `FlashSale.astro` home section.

**Tech Stack:** Backend — Fastify 5, Prisma + MySQL 8, sharp, @fastify/multipart, Vitest. Frontend — Astro 5, zod, Vitest.

## Global Constraints

- **Branch `phase-11-pricing-ux`**, per-task commits (Conventional Commits; end the body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).
- **Ampersand-path gotcha:** project in `D:\Roots & Rings` — `&` breaks `npm run`. Call node entrypoints directly:
  - Backend tests: `cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run [tests/<file>]`
  - Frontend build: `cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build`
  - Frontend tests: `cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run`
- **No new deps, do NOT run `astro check`.** Frontend tests live in `frontend/tests/`; the full frontend suite (52) needs a backend dev server UP.
- **DB `rootsandrings-db` up** for backend tests.
- **All uploads are WebP** — always via `uploadsService.processImage` (which sniffs → resizes → re-encodes WebP q80 → `.webp`). Never write an upload path that bypasses it.
- **Only add the UI the spec describes** (discount rendering + flash section + the category file picker). Reuse existing Tailwind tokens (`text-on-surface`, `text-on-surface-variant`, `bg-on-surface`, `text-surface`, `text-label-caps`, `opacity-*`) — no redesign.

---

### Task 1: Backend — generic admin image-upload endpoint

**Files:**
- Modify: `backend/src/modules/admin/categories.ts` (add the route + imports)
- Test: `backend/tests/admin.uploads.test.ts`

**Interfaces:**
- Produces: `POST /admin/uploads/image?kind=<products|categories|avatars>` (session-auth, multipart, no CSRF) → `{ url, width, height }` (url ends `.webp`); 400 on missing/invalid file.

- [ ] **Step 1: Write the failing test — `backend/tests/admin.uploads.test.ts`**

First **read `backend/tests/uploads.test.ts`** to reuse its exact multipart-inject mechanics (constructing the `multipart/form-data` body + boundary for `app.inject`). Then write:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildApp } from '../src/app';
import { loginAdmin } from './helpers';

let app: FastifyInstance;
let cookie: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  cookie = await loginAdmin(app);
});
afterAll(async () => { await app.close(); });

// Build a real 2x2 PNG so processImage's magic-byte sniff accepts it.
async function pngBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 200, g: 180, b: 150 } } }).png().toBuffer();
}

// Encode a single-file multipart/form-data body (mirror tests/uploads.test.ts if it has a helper).
function multipart(field: string, filename: string, contentType: string, data: Buffer) {
  const boundary = '----rrtest' + Math.random().toString(16).slice(2);
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const post = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([pre, data, post]), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('POST /admin/uploads/image', () => {
  it('accepts an image and returns a .webp url', async () => {
    const { body, contentType } = multipart('image', 'photo.png', 'image/png', await pngBuffer());
    const res = await app.inject({
      method: 'POST', url: '/admin/uploads/image?kind=categories',
      headers: { cookie, 'content-type': contentType }, payload: body,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.url).toMatch(/^\/uploads\/categories\/.+\.webp$/);
  });

  it('rejects a non-image (400)', async () => {
    const { body, contentType } = multipart('image', 'note.txt', 'text/plain', Buffer.from('not an image'));
    const res = await app.inject({
      method: 'POST', url: '/admin/uploads/image?kind=categories',
      headers: { cookie, 'content-type': contentType }, payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires an admin session (redirects when unauthenticated)', async () => {
    const { body, contentType } = multipart('image', 'photo.png', 'image/png', await pngBuffer());
    const res = await app.inject({ method: 'POST', url: '/admin/uploads/image', headers: { 'content-type': contentType }, payload: body });
    expect(res.statusCode).toBe(302);
  });
});
```
(If `tests/uploads.test.ts` already exports a multipart helper, import that instead of re-defining `multipart`.)

- [ ] **Step 2: Run it — verify it fails**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/admin.uploads.test.ts
```
Expected: FAIL (route 404/redirect — not registered).

- [ ] **Step 3: Add the route in `backend/src/modules/admin/categories.ts`**

Add the import for `uploadsService` (alongside the existing imports) — mirror how `admin/products.ts` imports it:
```ts
import { uploadsService, type UploadKind } from '../uploads/service';
```
Inside the route-registration function (where `app.get('/admin/categories', …)` etc. are defined), add:
```ts
  const UPLOAD_KINDS: UploadKind[] = ['products', 'categories', 'avatars'];
  app.post('/admin/uploads/image', { preHandler: requireAdminSession }, async (req, reply) => {
    const raw = (req.query as { kind?: string }).kind;
    const kind: UploadKind = UPLOAD_KINDS.includes(raw as UploadKind) ? (raw as UploadKind) : 'categories';
    const file = await req.file();
    if (!file) return reply.status(400).send({ error: 'BadRequest', message: 'No image provided', statusCode: 400 });
    const out = await uploadsService.processImage(await file.toBuffer(), kind);
    return reply.send({ url: out.url, width: out.width, height: out.height });
  });
```
(`requireAdminSession` is already imported in this file — it's used by the other category routes. `processImage` throws a 400-tagged error on a non-image, which the app's error handler renders as 400.)

- [ ] **Step 4: Run the test — verify it passes**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/admin.uploads.test.ts
```
Expected: PASS (3 tests). If the multipart body isn't parsed, re-check the boundary/encoding against `tests/uploads.test.ts`.

- [ ] **Step 5: Full-suite checkpoint + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/admin/categories.ts backend/tests/admin.uploads.test.ts
git commit -m "feat(admin): generic image-upload endpoint (WebP via uploadsService)"
```
Expected: green (159 + uploads 3 = 162).

---

### Task 2: Category form — device image picker

**Files:**
- Modify: `backend/src/modules/admin/views/category-form.eta`

**Interfaces:**
- Consumes: `POST /admin/uploads/image?kind=categories` (Task 1).

- [ ] **Step 1: Add the file picker + preview + inline uploader**

In `category-form.eta`, replace the current Image URL line:
```html
  <label>Image URL <input name="imageUrl" value="<%= it.cat && it.cat.imageUrl ? it.cat.imageUrl : '' %>" placeholder="/uploads/categories/..." /></label>
```
with:
```html
  <label>Image
    <input type="file" accept="image/*" data-image-picker />
    <span data-image-status style="font-size:12px;opacity:.6"></span>
  </label>
  <label>Image URL <input name="imageUrl" data-image-url value="<%= it.cat && it.cat.imageUrl ? it.cat.imageUrl : '' %>" placeholder="Upload a photo, or paste /uploads/categories/..." /></label>
  <img data-image-preview src="<%= it.cat && it.cat.imageUrl ? it.cat.imageUrl : '' %>" alt="" style="max-width:160px;border-radius:6px;margin-top:4px;<%= it.cat && it.cat.imageUrl ? '' : 'display:none' %>" />
  <script>
    (function () {
      var picker = document.querySelector('[data-image-picker]');
      var urlInput = document.querySelector('[data-image-url]');
      var preview = document.querySelector('[data-image-preview]');
      var status = document.querySelector('[data-image-status]');
      if (!picker) return;
      picker.addEventListener('change', async function () {
        var f = picker.files && picker.files[0];
        if (!f) return;
        status.textContent = 'Uploading…';
        try {
          var fd = new FormData();
          fd.append('image', f);
          var r = await fetch('/admin/uploads/image?kind=categories', { method: 'POST', body: fd });
          if (!r.ok) throw new Error('Upload failed');
          var data = await r.json();
          urlInput.value = data.url;
          preview.src = data.url;
          preview.style.display = '';
          status.textContent = 'Uploaded ✓ (WebP)';
        } catch (e) {
          status.textContent = 'Upload failed — try another image';
        }
      });
    })();
  </script>
```
(The `<form>` stays `method="post"` urlencoded — the picker uploads via `fetch` and fills the `imageUrl` field, so the existing create/edit handler is unchanged. The upload is admin-session-authed; no CSRF needed on that endpoint.)

- [ ] **Step 2: Verify the backend still boots + serves the form**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/admin.categories.test.ts
```
Expected: PASS (the category CRUD test still passes — the form template change doesn't affect the urlencoded submit; `imageUrl` is still a named input). (The picker itself is verified live in Task 6 — it's a template + inline script, not unit-tested.)

- [ ] **Step 3: Commit**

```
git add backend/src/modules/admin/views/category-form.eta
git commit -m "feat(admin): upload category image from device on the category form"
```

---

### Task 3: Backend — flash-products query + route

**Files:**
- Modify: `backend/src/modules/catalog/service.ts` (add `getFlashProducts`)
- Modify: `backend/src/modules/catalog/routes.ts` (add `/api/products/flash`)
- Test: `backend/tests/catalog.flash.test.ts`

**Interfaces:**
- Produces: `getFlashProducts(prisma, limit?): Promise<ProductDTO[]>`; `GET /api/products/flash` → the DTO array.

- [ ] **Step 1: Write the failing test — `backend/tests/catalog.flash.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getFlashProducts } from '../src/modules/catalog/service';

const prisma = new PrismaClient();
const SKUS = ['RR-FLASH-ON-ZZ', 'RR-FLASH-OFF-ZZ'];

beforeAll(async () => {
  await prisma.product.deleteMany({ where: { sku: { in: SKUS } } });
  const now = Date.now();
  // active flash window, flashPrice < basePrice
  await prisma.product.create({ data: {
    name: 'Flash On ZZ', slug: 'flash-on-zz', sku: SKUS[0], shortDescription: 'x', description: 'x',
    basePrice: 1000, flashPrice: 600, flashStartAt: new Date(now - 3600_000), flashEndAt: new Date(now + 3600_000), isActive: true,
  } });
  // expired flash window
  await prisma.product.create({ data: {
    name: 'Flash Off ZZ', slug: 'flash-off-zz', sku: SKUS[1], shortDescription: 'x', description: 'x',
    basePrice: 1000, flashPrice: 600, flashStartAt: new Date(now - 7200_000), flashEndAt: new Date(now - 3600_000), isActive: true,
  } });
});
afterAll(async () => {
  await prisma.product.deleteMany({ where: { sku: { in: SKUS } } });
  await prisma.$disconnect();
});

describe('getFlashProducts', () => {
  it('returns products with an active flash window and excludes expired ones', async () => {
    const flash = await getFlashProducts(prisma);
    const slugs = flash.map((p) => p.slug);
    expect(slugs).toContain('flash-on-zz');
    expect(slugs).not.toContain('flash-off-zz');
    const on = flash.find((p) => p.slug === 'flash-on-zz')!;
    expect(on.isOnFlash).toBe(true);
    expect(on.price).toBe(600);
    expect(on.compareAt).toBe(1000);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/catalog.flash.test.ts
```
Expected: FAIL (`getFlashProducts` not exported).

- [ ] **Step 3: Add `getFlashProducts` to `backend/src/modules/catalog/service.ts`**

Add (near `getFeatured`; it uses the same module-level `include` const + `mapProduct`):
```ts
export async function getFlashProducts(prisma: PrismaClient, limit = 8): Promise<ProductDTO[]> {
  const now = new Date();
  const rows = await prisma.product.findMany({
    where: {
      isActive: true,
      flashPrice: { not: null },
      flashStartAt: { lte: now },
      flashEndAt: { gte: now },
    },
    orderBy: { flashEndAt: 'asc' },
    include,
  });
  return rows.map((r) => mapProduct(r, now)).filter((p) => p.isOnFlash).slice(0, limit);
}
```
(The `.filter((p) => p.isOnFlash)` enforces `resolvePrice`'s `flashPrice < basePrice` rule; `include` and `mapProduct` are already used by the other service functions.)

- [ ] **Step 4: Register the route in `backend/src/modules/catalog/routes.ts`**

Add `getFlashProducts` to the import from `./service`, and add the route **immediately after** the `app.get('/api/products', …)` line (so the static `/flash` path is registered before `'/api/products/:slug'`; Fastify matches static before parametric regardless, but keep them adjacent for clarity):
```ts
  app.get('/api/products/flash', async () => getFlashProducts(app.prisma));
```

- [ ] **Step 5: Run the test + a catalog regression**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/catalog.flash.test.ts tests/catalog.api.test.ts
```
Expected: PASS (flash 1; catalog API unaffected).

- [ ] **Step 6: Full-suite checkpoint + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/catalog/service.ts backend/src/modules/catalog/routes.ts backend/tests/catalog.flash.test.ts
git commit -m "feat(catalog): getFlashProducts + GET /api/products/flash (active flash window)"
```
Expected: green (162 + flash 1 = 163).

---

### Task 4: Frontend — sale/flash discount rendering

**Files:**
- Modify: `frontend/src/lib/schema.ts`, `frontend/src/lib/api.ts`, `frontend/src/lib/format.ts`
- Modify: `frontend/src/components/product/ProductCard.astro`, `frontend/src/pages/objects/[slug].astro`
- Test: `frontend/tests/format.test.ts`

**Interfaces:**
- Consumes: backend `compareAt`/`isOnSale`/`isOnFlash` (already on the product DTO).
- Produces: `Product.compareAt: number | null`, `Product.isOnSale`, `Product.isOnFlash`; `discountPercent(price, compareAt): number`.

- [ ] **Step 1: Write the failing test — extend `frontend/tests/format.test.ts`**

Add:
```ts
import { discountPercent } from '../src/lib/format';

describe('discountPercent', () => {
  it('computes the rounded percent off', () => {
    expect(discountPercent(300, 500)).toBe(40);
    expect(discountPercent(600, 1000)).toBe(40);
    expect(discountPercent(950, 1000)).toBe(5);
  });
});
```
(Match the existing import style at the top of the file — add `discountPercent` to the existing `../src/lib/format` import if there is one.)

- [ ] **Step 2: Run it — verify it fails**

```
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run tests/format.test.ts
```
Expected: FAIL (`discountPercent` not exported).

- [ ] **Step 3: Add `discountPercent` to `frontend/src/lib/format.ts`**

```ts
/** Whole-number percent off, e.g. discountPercent(300, 500) === 40. */
export function discountPercent(price: number, compareAt: number): number {
  if (compareAt <= 0 || price >= compareAt) return 0;
  return Math.round(((compareAt - price) / compareAt) * 100);
}
```

- [ ] **Step 4: Map the fields — `frontend/src/lib/schema.ts` + `frontend/src/lib/api.ts`**

In `schema.ts`, add to the product `z.object` (next to `price`):
```ts
  compareAt: z.number().nullable().default(null),
  isOnSale: z.boolean().default(false),
  isOnFlash: z.boolean().default(false),
```
In `api.ts`, add to the `ApiProduct` interface:
```ts
  compareAt?: number | null;
  isOnSale?: boolean;
  isOnFlash?: boolean;
```
and to `toProduct(p)`'s returned object (next to `price`):
```ts
    compareAt: p.compareAt ?? null,
    isOnSale: p.isOnSale ?? false,
    isOnFlash: p.isOnFlash ?? false,
```

- [ ] **Step 5: Render the discount — `ProductCard.astro`**

Add `discountPercent` to the format import:
```ts
import { formatPrice, discountPercent } from '../../lib/format';
```
Replace the price line:
```astro
      <p class="text-body-md text-on-surface-variant mt-1">{formatPrice(product.price)}</p>
```
with:
```astro
      <p class="text-body-md mt-1">
        {product.compareAt != null && product.compareAt > product.price ? (
          <>
            <s class="text-on-surface-variant opacity-50 mr-2">{formatPrice(product.compareAt, product.currency)}</s>
            <span class="text-on-surface">{formatPrice(product.price, product.currency)}</span>
            <span class="ml-2 align-middle inline-block bg-on-surface text-surface text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
              −{discountPercent(product.price, product.compareAt)}%
            </span>
          </>
        ) : (
          <span class="text-on-surface-variant">{formatPrice(product.price, product.currency)}</span>
        )}
      </p>
```

- [ ] **Step 6: Render the discount — `objects/[slug].astro` (PDP)**

Add `discountPercent` to the format import in the PDP frontmatter:
```ts
import { formatPrice, discountPercent } from '../../lib/format';
```
Replace the PDP price line:
```astro
      <p class="font-display text-headline-sm mt-3">{formatPrice(product.price)}</p>
```
with:
```astro
      <p class="font-display text-headline-sm mt-3">
        {product.compareAt != null && product.compareAt > product.price ? (
          <>
            <s class="text-on-surface-variant opacity-50 mr-3 font-sans text-body-lg">{formatPrice(product.compareAt, product.currency)}</s>
            <span>{formatPrice(product.price, product.currency)}</span>
            <span class="ml-3 align-middle inline-block bg-on-surface text-surface text-label-caps uppercase px-2 py-0.5 rounded-full">
              −{discountPercent(product.price, product.compareAt)}% {product.isOnFlash ? 'Flash' : 'Off'}
            </span>
          </>
        ) : (
          formatPrice(product.price, product.currency)
        )}
      </p>
```

- [ ] **Step 7: Test + build + full suite**

```
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run tests/format.test.ts
cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run
```
Expected: format passes; build OK; full suite green (52 + discountPercent = 53). Backend must be up.

- [ ] **Step 8: Commit**

```
git add frontend/src/lib/schema.ts frontend/src/lib/api.ts frontend/src/lib/format.ts frontend/src/components/product/ProductCard.astro frontend/src/pages/objects/[slug].astro frontend/tests/format.test.ts
git commit -m "feat(storefront): show sale/flash discount (strike-through + −%) on cards and PDP"
```

---

### Task 5: Frontend — home flash-sale section

**Files:**
- Modify: `frontend/src/lib/api.ts` (`fetchFlash`), `frontend/src/lib/catalog.ts` (`getFlash`)
- Create: `frontend/src/components/home/FlashSale.astro`
- Modify: `frontend/src/pages/index.astro`

**Interfaces:**
- Consumes: `GET /api/products/flash` (Task 3); `ProductCard` (with Task 4's discount render); `getProducts`-style fetch.

- [ ] **Step 1: Add the fetch — `frontend/src/lib/api.ts`**

Mirror `fetchFeatured`. Add:
```ts
export async function fetchFlash(): Promise<Product[]> {
  const res = await fetch(`${API_BASE}/api/products/flash`);
  if (!res.ok) return [];
  return (await res.json()).map(toProduct);
}
```
(Use the same `API_BASE` const and `toProduct` mapper the other fetchers use; return `[]` on a non-ok response so the section degrades gracefully.)

- [ ] **Step 2: Add `getFlash` — `frontend/src/lib/catalog.ts`**

Mirror `getFeatured`:
```ts
export async function getFlash(): Promise<Product[]> {
  return api.fetchFlash();
}
```

- [ ] **Step 3: Create `frontend/src/components/home/FlashSale.astro`**

```astro
---
import ProductCard from '../product/ProductCard.astro';
import { getFlash } from '../../lib/catalog';

const flash = await getFlash();
---
{flash.length > 0 && (
  <section class="wrap py-16 md:py-24">
    <div class="flex items-baseline justify-between mb-8 md:mb-12">
      <h2 class="font-display text-display-mobile md:text-display-lg">⚡ Flash Sale</h2>
      <a href="/objects?onSale=true" class="btn-editorial text-label-caps uppercase">Shop all offers</a>
    </div>
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-12">
      {flash.map((p) => <ProductCard product={p} sizes="(max-width: 768px) 50vw, 25vw" />)}
    </div>
  </section>
)}
```
(Renders nothing when there are no active flash products. The cards show Task 4's strike-through + −% automatically.)

- [ ] **Step 4: Add it to the home page — `frontend/src/pages/index.astro`**

Add the import in the frontmatter:
```ts
import FlashSale from '../components/home/FlashSale.astro';
```
and place `<FlashSale />` immediately after `<Hero />` in the layout:
```astro
  <Hero />
  <FlashSale />
  <FeaturedCollection />
```

- [ ] **Step 5: Build + full suite**

```
cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run
```
Expected: build OK; suite green (53). (The section is verified live in Task 6.)

- [ ] **Step 6: Commit**

```
git add frontend/src/lib/api.ts frontend/src/lib/catalog.ts frontend/src/components/home/FlashSale.astro frontend/src/pages/index.astro
git commit -m "feat(storefront): home Flash Sale section (active flash-window products)"
```

---

### Task 6: Verification sweep + memory

**Files:**
- Modify: `C:\Users\PC\.claude\projects\D--Roots---Rings\memory\MEMORY.md` + new `roots-rings-phase11-pricing-ux.md`

- [ ] **Step 1: Suites + build**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run
cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build
```
Expected: backend 163; frontend 53; build OK.

- [ ] **Step 2: Live verification (controller-run)** — restart the backend + the built SSR frontend, then:
  1. **Upload:** the `/admin/uploads/image` endpoint returns a `.webp` url (the Task 1 test already proves this); confirm the category form (`/admin/categories/new`) renders the file picker.
  2. **Discount:** pick a seeded product, set its `salePrice` below `basePrice` (via admin edit or a quick SQL/prisma update), then `curl` its PDP + a listing → the HTML shows the struck-through compareAt + the `−N%` badge. (`curl -s http://127.0.0.1:4321/objects/<slug> | grep -o '<s [^>]*>[^<]*</s>'`.)
  3. **Flash:** set a seeded product's `flashPrice` below base with `flashStartAt` in the past + `flashEndAt` in the future, then `curl -s http://127.0.0.1:4000/api/products/flash` → it's listed, and the home page (`curl -s http://127.0.0.1:4321/ | grep -i 'Flash Sale'`) shows the section.

- [ ] **Step 3: Update memory** — create `roots-rings-phase11-pricing-ux.md` (generic `/admin/uploads/image` → WebP via processImage; category form device picker; `compareAt`/`isOnSale`/`isOnFlash` mapped to frontend + `discountPercent` render on card/PDP; `getFlashProducts` + `/api/products/flash` + home FlashSale section) + a one-line pointer in `MEMORY.md`.

- [ ] **Step 4: Report** the final counts + the live-verification results.

---

## Self-Review

**1. Spec coverage** (spec §2–§6 → tasks):
- §2 Part A (generic upload route + category form picker; WebP via processImage) → Tasks 1, 2. ✅
- §3 Part B (frontend compareAt/isOnSale/isOnFlash + discountPercent + card/PDP render) → Task 4. ✅
- §4 Part C (getFlashProducts + /api/products/flash + fetchFlash/getFlash + FlashSale + home) → Tasks 3, 5. ✅
- §5 security (upload session-auth + kind allowlist + magic-byte validation; server-derived prices with safe defaults; server-side flash-window filter) → Tasks 1, 3, 4. ✅
- §6 testing (upload route; getFlashProducts; discountPercent; regression; live) → Tasks 1, 3, 4, 6. ✅

**2. Placeholder scan:** every code step has complete code; test steps have real assertions; the one intentional reference (mirror `tests/uploads.test.ts` for multipart mechanics) is because that pattern is codebase-specific and already exists. No TBD/TODO.

**3. Type consistency:** `getFlashProducts(prisma, limit?)` (Task 3) matches its route call + the test. `discountPercent(price, compareAt)` (Task 4) is used identically in ProductCard + PDP. `Product.compareAt/isOnSale/isOnFlash` (Task 4 schema) match `toProduct`'s output and the render guards (`compareAt != null && compareAt > price`). `fetchFlash`/`getFlash` (Task 5) return `Product[]` consumed by `FlashSale.astro` → `ProductCard`. `UploadKind` (Task 1) matches `uploadsService.processImage`'s param. The upload endpoint `/admin/uploads/image?kind=categories` (Task 1) is exactly what the category form posts to (Task 2). ✅
