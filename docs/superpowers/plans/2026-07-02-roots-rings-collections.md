# Roots & Rings Phase 14 — Collections (separate admin section + storefront pages) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make collections a first-class, discoverable admin section (separate from Categories) and give each collection its own storefront page (`/collections/[slug]`) showing its products with a filter-by-category.

**Architecture:** The existing `admin/categories.ts` handlers are generalized into a kind-scoped `mount()` helper called twice — for `/admin/categories` (PRODUCT_TYPE) and `/admin/collections` (COLLECTION) — sharing one form template. A new `getProductsByCollection` catalog query + `/api/collections/:slug/products` route feed a new SSR `/collections/[slug]` page. No schema change, no new deps.

**Tech Stack:** Fastify 5, Prisma + MySQL 8, eta admin views, Astro 5 SSR, Tailwind, Vitest.

## Global Constraints

- **Branch `phase-14-collections`** (base `main` @ `d67a992`), per-task commits — Conventional Commits, body ending with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Ampersand-path gotcha:** project in `D:\Roots & Rings` — `&` breaks `npm run`. Call node directly:
  - Backend tests: `cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run [tests/<file>]`
  - Frontend build: `cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build`
  - Frontend unit tests: `cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run`
- **DB `rootsandrings-db` up** for backend tasks. No new deps. No schema/migration. **No `astro check`, no dep installs** (frontend gate is `astro build` + the unit suite).
- **Category vs Collection:** `Category.kind` = `PRODUCT_TYPE` (product type; `Product.categoryId`) vs `COLLECTION` (curated group; M:N `Product.collections`, kept multi-select). Kind is forced server-side by the route group — a client cannot cross kinds.
- **DO NOT change the storefront UI beyond what this plan adds** (new collection page + fixing the collection-card links). No pricing/catalog-engine change. The product form's category/collection controls are **already correct** (category `<select>` = PRODUCT_TYPE, collections multi-select = COLLECTION) — do not edit them.
- Full backend suite green before each backend commit (194 baseline). Frontend: `astro build` passes + unit suite green (53 baseline).

---

### Task 1: Backend — `getProductsByCollection` + route

**Files:**
- Modify: `backend/src/modules/catalog/service.ts` (add `getProductsByCollection`)
- Modify: `backend/src/modules/catalog/routes.ts` (add `GET /api/collections/:slug/products`)
- Test: `backend/tests/catalog.collection-products.test.ts`

**Interfaces:**
- Consumes: the module-level `include` (`{ category, images, collections, variants }`) + `mapProduct(row, now)` + `ProductDTO` already in `catalog/service.ts`.
- Produces: `getProductsByCollection(prisma, slug): Promise<ProductDTO[]>`; route `GET /api/collections/:slug/products` → `ProductDTO[]`.

- [ ] **Step 1: Write the failing test — `backend/tests/catalog.collection-products.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { getProductsByCollection } from '../src/modules/catalog/service';

let app: FastifyInstance;
const TAG = 'colp-zz';
let collSlug = '';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await app.prisma.product.deleteMany({ where: { sku: { startsWith: TAG } } });
  await app.prisma.category.deleteMany({ where: { slug: { startsWith: TAG } } });
  const coll = await app.prisma.category.create({ data: { kind: 'COLLECTION', name: 'ZZ ColP', slug: `${TAG}-coll`, isActive: true } });
  collSlug = coll.slug;
  await app.prisma.product.create({ data: { name: 'ZZ In Active', slug: `${TAG}-in-active`, sku: `${TAG}-1`, shortDescription: 'x', description: 'x', basePrice: 100, isActive: true, collections: { connect: [{ id: coll.id }] }, variants: { create: [{ sku: `${TAG}-1v`, name: 'Std', stock: 5, isActive: true, position: 0 }] } } });
  await app.prisma.product.create({ data: { name: 'ZZ In Inactive', slug: `${TAG}-in-inactive`, sku: `${TAG}-2`, shortDescription: 'x', description: 'x', basePrice: 100, isActive: false, collections: { connect: [{ id: coll.id }] } } });
  await app.prisma.product.create({ data: { name: 'ZZ Out Active', slug: `${TAG}-out-active`, sku: `${TAG}-3`, shortDescription: 'x', description: 'x', basePrice: 100, isActive: true } });
});
afterAll(async () => {
  await app.prisma.product.deleteMany({ where: { sku: { startsWith: TAG } } });
  await app.prisma.category.deleteMany({ where: { slug: { startsWith: TAG } } });
  await app.close();
});

describe('getProductsByCollection', () => {
  it('returns only active products in the collection', async () => {
    const slugs = (await getProductsByCollection(app.prisma, collSlug)).map((p) => p.slug);
    expect(slugs).toContain(`${TAG}-in-active`);
    expect(slugs).not.toContain(`${TAG}-in-inactive`);
    expect(slugs).not.toContain(`${TAG}-out-active`);
  });
  it('returns [] for an unknown collection', async () => {
    expect(await getProductsByCollection(app.prisma, 'no-such-collection-zz')).toEqual([]);
  });
  it('route GET /api/collections/:slug/products returns the array', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/collections/${collSlug}/products` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.map((p: { slug: string }) => p.slug)).toContain(`${TAG}-in-active`);
  });
  it('route returns [] for an unknown slug', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/collections/no-such-zz/products' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

`cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/catalog.collection-products.test.ts` → FAIL (`getProductsByCollection` not exported).

- [ ] **Step 3: Add `getProductsByCollection` to `backend/src/modules/catalog/service.ts`**

Add near `getCollectionBySlug` (reuses the module-level `include` + `mapProduct`):
```ts
export async function getProductsByCollection(prisma: PrismaClient, slug: string): Promise<ProductDTO[]> {
  const now = new Date();
  const rows = await prisma.product.findMany({
    where: { isActive: true, collections: { some: { slug, kind: 'COLLECTION' } } },
    include,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => mapProduct(r, now));
}
```
(If `PrismaClient`/`ProductDTO` are not already imported in the file, they are — `getCollections` uses `PrismaClient` and the file imports `ProductDTO` from `../../lib/mappers`. Reuse the existing imports.)

- [ ] **Step 4: Add the route in `backend/src/modules/catalog/routes.ts`**

Add `getProductsByCollection` to the existing import from `./service`, and register the route right after `GET /api/collections/:slug`:
```ts
  app.get('/api/collections/:slug/products', async (request) => {
    const { slug } = request.params as { slug: string };
    return getProductsByCollection(app.prisma, slug);
  });
```

- [ ] **Step 5: Run the test — verify it passes**

`cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/catalog.collection-products.test.ts` → PASS (4 tests).

- [ ] **Step 6: Full suite + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/catalog/service.ts backend/src/modules/catalog/routes.ts backend/tests/catalog.collection-products.test.ts
git commit -m "feat(catalog): getProductsByCollection + GET /api/collections/:slug/products"
```
Expected: green (194 + 4 = 198).

---

### Task 2: Admin — kind-scoped Categories + Collections sections

**Files:**
- Modify: `backend/src/modules/admin/categories.ts` (generalize to a kind-scoped `mount()` helper; register both route groups)
- Modify: `backend/src/modules/admin/views/category-form.eta` (drop the Kind selector; kind fixed by route; conditional parent; kind-scoped action/cancel)
- Modify: `backend/src/modules/admin/views/categories.eta` (parameterized heading / "New" button / count / links; drop Kind column)
- Modify: `backend/src/modules/admin/views/layout.eta` (add a "Collections" nav link)
- Test: `backend/tests/admin.collections.test.ts`

**Interfaces:**
- Produces: route groups `/admin/categories*` (PRODUCT_TYPE) and `/admin/collections*` (COLLECTION), all admin-only; writes CSRF-protected. `registerAdminCategories(app)` still the single registration entrypoint (already called in `admin/index.ts` — no `index.ts` change).

- [ ] **Step 1: Replace `backend/src/modules/admin/categories.ts` with the kind-scoped version**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CategoryKind } from '@prisma/client';
import { renderPage } from '../../lib/render';
import { getUser, requireAdminSession } from './guards';
import { uniqueSlug } from '../../lib/slug';
import { writeAudit } from '../../lib/audit';
import { invalidateMenu } from '../../lib/menu-cache';
import { uploadsService, type UploadKind } from '../uploads/service';

// kind is NOT part of the form — it is fixed by the route group (categories vs collections).
const bodySchema = z.object({
  name: z.string().trim().min(1),
  slug: z.string().trim().optional(),
  parentId: z.string().trim().optional(),
  tagline: z.string().trim().optional(),
  description: z.string().trim().optional(),
  imageUrl: z.string().trim().optional(),
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.string().optional().transform((v) => v === 'on'),
  seoTitle: z.string().trim().optional(),
  seoDescription: z.string().trim().optional(),
});

interface CrudCfg {
  basePath: string;
  kind: CategoryKind;
  active: string;
  showParent: boolean;
  countField: 'typeProducts' | 'collectionProducts';
  entity: string;
  label: string;
  heading: string;
  newLabel: string;
  sub: string;
}

export function registerAdminCategories(app: FastifyInstance) {
  const authed = { preHandler: requireAdminSession };
  const authedWrite = { preHandler: [requireAdminSession, app.csrfProtection] };

  function mount(cfg: CrudCfg) {
    app.get(cfg.basePath, authed, async (req, reply) => {
      const user = getUser(req)!;
      const csrf = reply.generateCsrf();
      const cats = await app.prisma.category.findMany({
        where: { kind: cfg.kind },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { typeProducts: true, collectionProducts: true } } },
      });
      return renderPage(reply, { template: 'categories', title: cfg.heading, user, active: cfg.active, csrf, data: { cats, cfg } });
    });

    app.get(cfg.basePath + '/new', authed, async (req, reply) => {
      const user = getUser(req)!;
      const csrf = reply.generateCsrf();
      const parents = cfg.showParent ? await app.prisma.category.findMany({ where: { kind: cfg.kind }, orderBy: { name: 'asc' } }) : [];
      return renderPage(reply, { template: 'category-form', title: 'New ' + cfg.label, user, active: cfg.active, csrf, data: { cat: null, parents, cfg } });
    });

    app.post(cfg.basePath + '/new', authedWrite, async (req, reply) => {
      const user = getUser(req)!;
      const d = bodySchema.parse(req.body);
      const slug = await uniqueSlug(d.slug || d.name, async (s) => Boolean(await app.prisma.category.findUnique({ where: { slug: s } })));
      const created = await app.prisma.category.create({
        data: {
          kind: cfg.kind, name: d.name, slug,
          parentId: cfg.showParent ? (d.parentId || null) : null,
          tagline: d.tagline || null, description: d.description || null,
          imageUrl: d.imageUrl || null, sortOrder: d.sortOrder, isActive: d.isActive,
          seoTitle: d.seoTitle || null, seoDescription: d.seoDescription || null,
        },
      });
      invalidateMenu();
      await writeAudit(app.prisma, { actor: user, action: 'create', entity: cfg.entity, entityId: created.id, after: created, req });
      return reply.redirect(cfg.basePath);
    });

    app.get(cfg.basePath + '/:id/edit', authed, async (req, reply) => {
      const user = getUser(req)!;
      const { id } = req.params as { id: string };
      const cat = await app.prisma.category.findFirst({ where: { id, kind: cfg.kind } });
      if (!cat) return reply.redirect(cfg.basePath);
      const csrf = reply.generateCsrf();
      const parents = cfg.showParent ? await app.prisma.category.findMany({ where: { kind: cfg.kind }, orderBy: { name: 'asc' } }) : [];
      return renderPage(reply, { template: 'category-form', title: 'Edit ' + cfg.label, user, active: cfg.active, csrf, data: { cat, parents, cfg } });
    });

    app.post(cfg.basePath + '/:id/edit', authedWrite, async (req, reply) => {
      const user = getUser(req)!;
      const { id } = req.params as { id: string };
      const before = await app.prisma.category.findFirst({ where: { id, kind: cfg.kind } });
      if (!before) return reply.redirect(cfg.basePath);
      const d = bodySchema.parse(req.body);
      let slug = d.slug ? d.slug : before.slug;
      if (slug !== before.slug) {
        slug = await uniqueSlug(slug, async (s) => Boolean(await app.prisma.category.findFirst({ where: { slug: s, id: { not: id } } })));
      }
      const updated = await app.prisma.category.update({
        where: { id },
        data: {
          name: d.name, slug,
          parentId: cfg.showParent && d.parentId && d.parentId !== id ? d.parentId : null,
          tagline: d.tagline || null, description: d.description || null, imageUrl: d.imageUrl || null,
          sortOrder: d.sortOrder, isActive: d.isActive, seoTitle: d.seoTitle || null, seoDescription: d.seoDescription || null,
        },
      });
      invalidateMenu();
      await writeAudit(app.prisma, { actor: user, action: 'update', entity: cfg.entity, entityId: id, before, after: updated, req });
      return reply.redirect(cfg.basePath);
    });

    app.post(cfg.basePath + '/:id/delete', authedWrite, async (req, reply) => {
      const user = getUser(req)!;
      const { id } = req.params as { id: string };
      const before = await app.prisma.category.findFirst({ where: { id, kind: cfg.kind } });
      if (before) {
        await app.prisma.category.delete({ where: { id } });
        invalidateMenu();
        await writeAudit(app.prisma, { actor: user, action: 'delete', entity: cfg.entity, entityId: id, before, req });
      }
      return reply.redirect(cfg.basePath);
    });
  }

  mount({ basePath: '/admin/categories', kind: 'PRODUCT_TYPE', active: 'categories', showParent: true, countField: 'typeProducts', entity: 'Category', label: 'Category', heading: 'Categories', newLabel: 'New category', sub: 'Product types.' });
  mount({ basePath: '/admin/collections', kind: 'COLLECTION', active: 'collections', showParent: false, countField: 'collectionProducts', entity: 'Collection', label: 'Collection', heading: 'Collections', newLabel: 'New collection', sub: 'Curated groupings of products.' });

  const UPLOAD_KINDS: UploadKind[] = ['products', 'categories', 'avatars'];
  app.post('/admin/uploads/image', { preHandler: requireAdminSession }, async (req, reply) => {
    const raw = (req.query as { kind?: string }).kind;
    const kind: UploadKind = UPLOAD_KINDS.includes(raw as UploadKind) ? (raw as UploadKind) : 'categories';
    const file = await req.file();
    if (!file) return reply.status(400).send({ error: 'BadRequest', message: 'No image provided', statusCode: 400 });
    const out = await uploadsService.processImage(await file.toBuffer(), kind);
    return reply.send({ url: out.url, width: out.width, height: out.height });
  });
}
```

- [ ] **Step 2: Update `backend/src/modules/admin/views/categories.eta`** (parameterized via `it.cfg`; drop the Kind column)

```html
<div class="toolbar">
  <div><h1><%= it.cfg.heading %></h1><p class="sub"><%= it.cfg.sub %></p></div>
  <a class="btn" href="<%= it.cfg.basePath %>/new"><%= it.cfg.newLabel %></a>
</div>
<table>
  <thead><tr><th>Name</th><th>Slug</th><th>Products</th><th>Active</th><th></th></tr></thead>
  <tbody>
    <% if (!it.cats.length) { %><tr><td colspan="5" class="muted">None yet.</td></tr><% } %>
    <% it.cats.forEach(function (c) { %>
      <tr>
        <td><%= c.name %></td>
        <td class="muted"><%= c.slug %></td>
        <td><%= c._count[it.cfg.countField] %></td>
        <td><%= c.isActive ? 'Yes' : 'No' %></td>
        <td style="text-align:right;white-space:nowrap">
          <a class="btn ghost sm" href="<%= it.cfg.basePath %>/<%= c.id %>/edit">Edit</a>
          <form method="post" action="<%= it.cfg.basePath %>/<%= c.id %>/delete" style="display:inline" onsubmit="return confirm('Delete this <%= it.cfg.label.toLowerCase() %>?')">
            <input type="hidden" name="_csrf" value="<%= it.csrf %>" />
            <button class="btn danger sm" type="submit">Delete</button>
          </form>
        </td>
      </tr>
    <% }) %>
  </tbody>
</table>
```

- [ ] **Step 3: Update `backend/src/modules/admin/views/category-form.eta`** — drop the Kind selector; make the action/cancel/title kind-scoped; show parent only when `it.cfg.showParent`

Replace the opening `<h1>`, `<form>`, and the Kind `<label>` block:
```html
<h1><%= it.cat ? 'Edit' : 'New' %> <%= it.cfg.label %></h1>
<form class="stack" method="post" action="<%= it.cat ? it.cfg.basePath + '/' + it.cat.id + '/edit' : it.cfg.basePath + '/new' %>">
  <input type="hidden" name="_csrf" value="<%= it.csrf %>" />
  <label>Name <input name="name" required value="<%= it.cat ? it.cat.name : '' %>" /></label>
  <label>Slug (optional) <input name="slug" value="<%= it.cat ? it.cat.slug : '' %>" placeholder="auto from name" /></label>
```
(The old `<label>Kind … </label>` block is removed entirely — kind is set server-side.)

Wrap the existing Parent `<label>` in a conditional:
```html
  <% if (it.cfg.showParent) { %>
  <label>Parent
    <select name="parentId">
      <option value="">— none —</option>
      <% it.parents.forEach(function (p) { if (!it.cat || p.id !== it.cat.id) { %>
        <option value="<%= p.id %>" <%= it.cat && it.cat.parentId === p.id ? 'selected' : '' %>><%= p.name %></option>
      <% } }) %>
    </select>
  </label>
  <% } %>
```
Change the Cancel link at the bottom:
```html
  <div class="actions"><button class="btn" type="submit">Save</button><a class="btn ghost" href="<%= it.cfg.basePath %>">Cancel</a></div>
```
(Everything else — tagline, description, image file picker + upload script, image URL, preview, sortOrder, status, SEO — stays exactly as-is.)

- [ ] **Step 4: Add the Collections nav link — `backend/src/modules/admin/views/layout.eta`**

Immediately after the Categories nav `<a>`:
```html
      <a href="/admin/collections" class="<%= it.active==='collections'?'active':'' %>">Collections</a>
```

- [ ] **Step 5: Write the test — `backend/tests/admin.collections.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loginAdmin, csrfFrom, formPost } from './helpers';

let app: FastifyInstance;
let cookie: string;
const TAG = 'colladmin-zz';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  cookie = await loginAdmin(app);
  await app.prisma.category.deleteMany({ where: { OR: [{ slug: { startsWith: TAG } }, { name: 'ZZ New Collection Admin' }] } });
  await app.prisma.category.create({ data: { kind: 'PRODUCT_TYPE', name: 'ZZ Type Marker Admin', slug: `${TAG}-type` } });
  await app.prisma.category.create({ data: { kind: 'COLLECTION', name: 'ZZ Collection Marker Admin', slug: `${TAG}-coll` } });
});
afterAll(async () => {
  await app.prisma.category.deleteMany({ where: { OR: [{ slug: { startsWith: TAG } }, { name: 'ZZ New Collection Admin' }] } });
  await app.close();
});

describe('admin collections section', () => {
  it('GET /admin/collections lists collections but not product-types', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/collections', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('ZZ Collection Marker Admin');
    expect(res.body).not.toContain('ZZ Type Marker Admin');
  });
  it('GET /admin/categories lists product-types but not collections', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/categories', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('ZZ Type Marker Admin');
    expect(res.body).not.toContain('ZZ Collection Marker Admin');
  });
  it('POST /admin/collections/new creates a COLLECTION and redirects to /admin/collections', async () => {
    const token = await csrfFrom(app, '/admin/collections/new', cookie);
    const res = await formPost(app, '/admin/collections/new', cookie, token, { name: 'ZZ New Collection Admin', isActive: 'on', sortOrder: '0' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/admin/collections');
    const row = await app.prisma.category.findFirst({ where: { name: 'ZZ New Collection Admin' } });
    expect(row?.kind).toBe('COLLECTION');
  });
});
```

- [ ] **Step 6: Run the test — verify it passes**

`cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/admin.collections.test.ts` → PASS (3 tests). Also re-run the existing categories test to confirm no regression: `node node_modules/vitest/vitest.mjs run tests/admin.categories.test.ts` (if it asserts the old Kind column or the old "New Category" button copy, update those assertions to match the kind-scoped list — the categories page now shows only PRODUCT_TYPE and a "New category" button; do NOT weaken a real assertion, only align copy/column expectations to the new layout).

- [ ] **Step 7: Full suite + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/admin/categories.ts backend/src/modules/admin/views/category-form.eta backend/src/modules/admin/views/categories.eta backend/src/modules/admin/views/layout.eta backend/tests/admin.collections.test.ts
git commit -m "feat(admin): separate Collections section (kind-scoped categories/collections CRUD + nav)"
```
Expected: green (198 + 3 = 201, ± any adjusted categories-test assertions).

---

### Task 3: Storefront — collection page + listing links + sitemap

**Files:**
- Modify: `frontend/src/lib/api.ts` (add `fetchCollectionProducts`)
- Modify: `frontend/src/lib/catalog.ts` (add `getCollectionProducts`)
- Create: `frontend/src/pages/collections/[slug].astro`
- Modify: `frontend/src/pages/collections.astro` (card links → `/collections/<slug>`)
- Modify: `frontend/src/pages/sitemap.xml.ts` (add collection URLs)

**Interfaces:**
- Consumes: `GET /api/collections/:slug/products` (Task 1); existing `getCollection(slug)`, `toProduct`, `ProductCard`, `Img`, `itemListSchema`, `breadcrumbSchema`.
- Produces: `fetchCollectionProducts(slug): Promise<Product[]>`; `getCollectionProducts(slug): Promise<Product[]>`.

- [ ] **Step 1: Add `fetchCollectionProducts` to `frontend/src/lib/api.ts`**

After `fetchCollections`:
```ts
export async function fetchCollectionProducts(slug: string): Promise<Product[]> {
  return ((await getJson<ApiProduct[]>(`/api/collections/${encodeURIComponent(slug)}/products`)) ?? []).map(toProduct);
}
```

- [ ] **Step 2: Add `getCollectionProducts` to `frontend/src/lib/catalog.ts`**

After `getCollection`:
```ts
export async function getCollectionProducts(slug: string): Promise<Product[]> {
  return api.fetchCollectionProducts(slug);
}
```

- [ ] **Step 3: Create `frontend/src/pages/collections/[slug].astro`**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import Img from '../../components/ui/Img.astro';
import ProductCard from '../../components/product/ProductCard.astro';
import { getCollection, getCollectionProducts } from '../../lib/catalog';
import JsonLd from '../../components/seo/JsonLd.astro';
import { itemListSchema, breadcrumbSchema } from '../../lib/structured-data';

const { slug } = Astro.params;
const collection = slug ? await getCollection(slug) : undefined;
if (!collection) return new Response('Not found', { status: 404 });
const products = await getCollectionProducts(slug!);
const categories = [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
---

<BaseLayout title={collection.name} description={collection.tagline || collection.description || `Pieces from the ${collection.name} collection.`}>
  <JsonLd slot="head" schema={breadcrumbSchema([{ name: 'Home', url: '/' }, { name: 'Collections', url: '/collections' }, { name: collection.name, url: `/collections/${collection.slug}` }])} />
  <JsonLd slot="head" schema={itemListSchema(products.map((p) => ({ name: p.name, url: `/objects/${p.slug}` })))} />

  <section class="relative h-[42vh] min-h-[300px] flex items-center justify-center overflow-hidden">
    {collection.image.src && (
      <Img fill src={collection.image.src} alt={collection.image.alt} priority widths={[768, 1280, 1920]} sizes="100vw" />
    )}
    <div class="absolute inset-0 bg-surface/35"></div>
    <div class="relative text-center fade-up px-6">
      <span class="text-label-caps uppercase opacity-60 mb-3 block">Collection</span>
      <h1 class="font-display text-display-mobile md:text-display-lg">{collection.name}</h1>
      {(collection.tagline || collection.description) && (
        <p class="text-body-lg text-on-surface-variant mt-3 max-w-xl mx-auto">{collection.tagline || collection.description}</p>
      )}
    </div>
  </section>

  <section class="wrap py-12 md:py-16">
    {products.length === 0 ? (
      <p class="text-body-md text-on-surface-variant py-24 text-center">No pieces in this collection yet.</p>
    ) : (
      <>
        <div class="flex items-center justify-between gap-4 pb-6 hairline-b">
          <span class="text-label-caps uppercase opacity-60"><span data-coll-count>{products.length}</span> Pieces</span>
          {categories.length > 1 && (
            <div class="flex flex-wrap gap-2" data-coll-filter>
              <button type="button" class="text-label-caps uppercase border border-outline px-3 py-1.5 is-active" data-cat="">All</button>
              {categories.map((c) => (
                <button type="button" class="text-label-caps uppercase border border-outline px-3 py-1.5" data-cat={c}>{c}</button>
              ))}
            </div>
          )}
        </div>
        <div data-coll-grid class="grid grid-cols-2 lg:grid-cols-3 gap-x-gutter gap-y-12 md:gap-y-16 mt-10">
          {products.map((p) => (
            <div class="coll-cell" data-category={p.category}>
              <ProductCard product={p} sizes="(max-width: 768px) 50vw, (max-width: 1024px) 40vw, 25vw" />
            </div>
          ))}
        </div>
      </>
    )}
  </section>
</BaseLayout>

<style>
  [data-coll-filter] button { opacity: .55; transition: opacity .2s; }
  [data-coll-filter] button.is-active { opacity: 1; text-decoration: underline; text-underline-offset: 4px; }
</style>

<script>
  (function () {
    var filter = document.querySelector('[data-coll-filter]');
    if (!filter) return;
    var cells = Array.prototype.slice.call(document.querySelectorAll('.coll-cell'));
    var countEl = document.querySelector('[data-coll-count]');
    filter.addEventListener('click', function (e) {
      var btn = (e.target as HTMLElement).closest('[data-cat]');
      if (!btn) return;
      var cat = btn.getAttribute('data-cat');
      filter.querySelectorAll('[data-cat]').forEach(function (b) { b.classList.toggle('is-active', b === btn); });
      var shown = 0;
      cells.forEach(function (cell) {
        var match = !cat || cell.getAttribute('data-category') === cat;
        (cell as HTMLElement).style.display = match ? '' : 'none';
        if (match) shown++;
      });
      if (countEl) countEl.textContent = String(shown);
    });
  })();
</script>
```
NOTE on the client script: Astro compiles `<script>` as TS. If the `as HTMLElement` casts cause a build issue, drop them (plain JS is fine in an Astro client script). Keep the logic identical.

- [ ] **Step 4: Fix the listing links — `frontend/src/pages/collections.astro`**

Change the card anchor's `href` from `/objects` to the collection page:
```astro
        <a href={`/collections/${c.slug}`} class={`group block fade-up ${i % 2 === 1 ? 'md:mt-20' : ''}`}>
```
(Everything else in `collections.astro` unchanged — the image, name, tagline, and "View Pieces" CTA stay.)

- [ ] **Step 5: Add collection URLs to `frontend/src/pages/sitemap.xml.ts`**

Add `getCollections` to the import and append collection URLs (inside a try so an unreachable backend still serves the rest):
```ts
import { getProducts, getCollections } from '../lib/catalog';
```
After the product loop's `try/catch`, add:
```ts
  try {
    const collections = await getCollections();
    for (const c of collections) {
      entries.push({ loc: new URL(`/collections/${c.slug}`, site.url).href });
    }
  } catch {
    // Collections unreachable → skip; rest of the sitemap still serves.
  }
```

- [ ] **Step 6: Verify the frontend build + unit suite**

A backend serving `/api/*` is not required for `astro build` (SSR pages render at request time, not build time), but keep the backend up so the later live check works.
```
cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run
```
Expected: build succeeds (no errors); unit suite green (53). If `astro build` errors on the client-script TS casts, remove the `as HTMLElement` casts (Step 3 note) and rebuild.

- [ ] **Step 7: Commit**

```
git add frontend/src/lib/api.ts frontend/src/lib/catalog.ts frontend/src/pages/collections/ frontend/src/pages/collections.astro frontend/src/pages/sitemap.xml.ts
git commit -m "feat(storefront): individual collection pages (/collections/[slug]) + listing links + sitemap"
```

---

### Task 4: Verification sweep + memory

**Files:**
- Modify: `C:\Users\PC\.claude\projects\D--Roots---Rings\memory\MEMORY.md` + new `roots-rings-phase14-collections.md`

- [ ] **Step 1: Full backend suite** — `cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run` → green (~201). **Frontend** — `astro build` passes + `vitest run` green (53).

- [ ] **Step 2: Live verification (controller-run)** — backend + frontend up:
  1. Admin sidebar shows **Collections** (separate from Categories). `/admin/collections` lists only collections + a "New collection" button; `/admin/categories` lists only product types.
  2. Create a collection (name + image) → it saves and appears in `/admin/collections`.
  3. Product form: assign a couple of products to that collection (collections multi-select).
  4. Storefront `/collections` → the collection card links to `/collections/<slug>` (not `/objects`).
  5. `/collections/<slug>` → hero (image + name + tagline) + the collection's products; the category filter narrows the grid + updates the count; an empty collection shows "No pieces in this collection yet."; an unknown slug → 404.

- [ ] **Step 3: Update memory** — create `roots-rings-phase14-collections.md` (kind-scoped admin Categories/Collections via `mount()` in categories.ts; shared `category-form.eta` with server-forced kind; `getProductsByCollection` + `/api/collections/:slug/products`; `/collections/[slug]` page with hero + client-side category filter; listing links + sitemap) + a one-line pointer in `MEMORY.md`.

- [ ] **Step 4: Report** final counts + live-verification results.

---

## Self-Review

**1. Spec coverage** (spec §2–§7 → tasks):
- §3 admin separate Collections section (kind-scoped mount, shared form with server-forced kind, conditional parent, nav link, kind-scoped list) → Task 2. Product form left unchanged (already correct) → noted in Global Constraints. ✅
- §4 storefront: `getProductsByCollection` + route → Task 1; `/collections/[slug]` page (hero + category filter + grid + empty + 404 + JSON-LD), listing links, sitemap → Task 3. ✅
- §5 security (admin-only + CSRF, kind forced server-side, isActive+kind filter in the query, escaped output, no raw SQL) → Tasks 1, 2, 3. ✅
- §6 testing (getProductsByCollection + route; admin kind-scoped lists + create; frontend build + unit; regression; live) → Tasks 1, 2, 3, 4. ✅
- §7 file structure → matches Tasks 1–3. ✅

**2. Placeholder scan:** every code step has complete code; every test step has real assertions; live checks are concrete. No TBD/TODO.

**3. Type consistency:** `getProductsByCollection(prisma, slug): Promise<ProductDTO[]>` (Task 1) is called by the route (Task 1) and, via `fetchCollectionProducts`→`getCollectionProducts` (Task 3), by the page. `CrudCfg` fields (`basePath`, `kind`, `active`, `showParent`, `countField`, `entity`, `label`, `heading`, `newLabel`, `sub`) defined in Task 2's `categories.ts` are exactly the `it.cfg.*` fields read by `categories.eta` + `category-form.eta` (Task 2 Steps 2–3) — cross-checked: heading/sub/newLabel/basePath/countField/label/showParent all consumed. The `data-category`/`data-coll-filter`/`data-coll-count`/`.coll-cell` hooks in the page markup (Task 3 Step 3) match the client script's selectors. `getCollection` (existing) returns `{ slug, name, tagline, description, image }` — the page reads all five. ✅
