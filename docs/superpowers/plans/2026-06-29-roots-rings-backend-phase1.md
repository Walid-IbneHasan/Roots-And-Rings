# Roots & Rings Backend — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Fastify + Prisma + MySQL backend exposing a public catalog API and a server-rendered admin panel, and wire the existing Astro storefront to read live catalog data — with no storefront UI change.

**Architecture:** `backend/` Fastify app serves both a JSON API (for the storefront) and a server-rendered admin panel (sessions, CSRF, uploads). MySQL runs in Docker. The `frontend/` Astro storefront becomes SSR-hybrid and its `catalog.ts` data layer calls the API instead of mock data.

**Tech Stack:** Fastify, TypeScript (strict), Prisma + MySQL, zod (+ fastify-type-provider-zod), @fastify/{helmet,cookie,session,csrf-protection,rate-limit,cors,multipart,static,view,swagger,swagger-ui}, eta, bcryptjs, sharp, sanitize-html, Vitest, @astrojs/node.

## Global Constraints

- Backend lives in `D:\Roots & Rings\backend`; storefront in `D:\Roots & Rings\frontend`.
- The `&` in the path breaks npm script shims — invoke node entries directly (e.g. `node node_modules/prisma/build/index.js …`, `node node_modules/vitest/vitest.mjs run`). `npm install` is fine.
- Money is `Decimal @db.Decimal(12, 2)`. Default currency **BDT**; storefront displays `৳`; keep existing numeric prices.
- Mapping: storefront **Collections → Category(kind=COLLECTION)**, **Shop/Objects → Product**, product-type facet → **Category(kind=PRODUCT_TYPE)**.
- **Do NOT change the storefront UI/design.** Only data source + minimal internal plumbing.
- Security non-negotiables: Helmet strict CSP, signed/httpOnly cookies, CSRF on admin forms, rate-limit (tighter on admin login), sanitize-html on rich text write, upload magic-byte validation, never log secrets/PII.
- zod-validated env at boot. Every FK and filter/sort column indexed; FULLTEXT(name, shortDescription) via raw SQL migration.
- TypeScript strict everywhere. Tests via Fastify `.inject()`.
- Git is not initialised; "Commit" steps are recorded but skipped until the user initialises git.

## File Structure

```
docker-compose.yml                      # MySQL 8 service
backend/
  package.json  tsconfig.json  .env  .env.example  vitest.config.ts
  prisma/ schema.prisma  seed.ts  migrations/
  src/
    env.ts                              # zod config
    app.ts                              # buildApp(): Fastify instance
    server.ts                           # boot
    plugins/ prisma.ts security.ts session.ts csrf.ts swagger.ts view.ts static.ts errors.ts
    lib/ pricing.ts slug.ts sanitize.ts password.ts audit.ts menu-cache.ts mappers.ts
    modules/
      health/routes.ts
      catalog/ service.ts routes.ts schemas.ts
      uploads/service.ts
      admin/ guards.ts auth.ts dashboard.ts categories.ts products.ts team.ts
             views/ layout.eta login.eta dashboard.eta products-list.eta product-form.eta
                    categories.eta category-form.eta team.eta  partials/*.eta
    scripts/ create-admin.ts
  uploads/ products/ categories/ avatars/
  tests/ pricing.test.ts catalog.api.test.ts admin.auth.test.ts admin.team.test.ts helpers.ts
frontend/  (modified)
  astro.config.mjs                      # + @astrojs/node, remotePatterns
  src/lib/catalog.ts                    # bodies → fetch API
  src/lib/api.ts                        # NEW: typed fetch wrapper + DTO→type mappers
  src/lib/format.ts                     # currency-aware
  src/components/ui/Img.astro           # remote-URL aware
  src/pages/** (set prerender=false on catalog pages)
```

---

### Task 1: Scaffold backend, Docker MySQL, Prisma schema + first migration, env

**Files:** Create `docker-compose.yml`, `backend/package.json`, `backend/tsconfig.json`, `backend/.env`, `backend/.env.example`, `backend/src/env.ts`, `backend/prisma/schema.prisma`, `backend/vitest.config.ts`.

**Interfaces:**
- Produces: `env` (validated config object) with `DATABASE_URL, NODE_ENV, PORT, APP_URL, STOREFRONT_ORIGIN, SESSION_SECRET, COOKIE_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, CRON_TOKEN, SMTP_*?`. Prisma client with models from spec §4. Enums `Role`, `CategoryKind`.

- [ ] **Step 1:** `docker-compose.yml` — MySQL 8 service `db`, `MYSQL_DATABASE=rootsandrings`, `MYSQL_ROOT_PASSWORD`, port 3306, named volume, healthcheck (`mysqladmin ping`). Run `docker compose up -d db`; wait for healthy.
- [ ] **Step 2:** `backend/package.json` deps: `fastify @fastify/helmet @fastify/cookie @fastify/session @fastify/csrf-protection @fastify/rate-limit @fastify/cors @fastify/multipart @fastify/static @fastify/view @fastify/swagger @fastify/swagger-ui eta @prisma/client zod fastify-type-provider-zod bcryptjs sharp sanitize-html nanoid`; dev: `prisma typescript tsx vitest @types/node @types/bcryptjs @types/sanitize-html`. `npm install`.
- [ ] **Step 3:** `tsconfig.json` strict (`"strict": true, "module":"ESNext","moduleResolution":"Bundler","target":"ES2022","esModuleInterop":true,"skipLibCheck":true`).
- [ ] **Step 4:** `src/env.ts` — zod schema parsing `process.env`, throwing on invalid; export `env`.

```ts
import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url().or(z.string().min(1)),
  APP_URL: z.string().default('http://localhost:4000'),
  STOREFRONT_ORIGIN: z.string().default('http://localhost:4321'),
  SESSION_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(8),
  CRON_TOKEN: z.string().min(8).default('dev-cron-token-change-me'),
});
export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
```

- [ ] **Step 5:** `prisma/schema.prisma` — datasource mysql, generator client; models User, Category, Product, ProductVariant, ProductImage, AdminAuditLog, Setting and enums per spec §4 (Decimal(12,2) on money; indexes on every FK + filter/sort column; Product↔Category COLLECTION implicit M:N named `collections`).
- [ ] **Step 6:** `.env` from `.env.example` with real dev values (generate 32+ char secrets). Run `node node_modules/prisma/build/index.js migrate dev --name init`.
- [ ] **Step 7: Verify** — `node node_modules/prisma/build/index.js generate` succeeds; `migrate dev` created tables (`docker compose exec db mysql -uroot -p... -e "SHOW TABLES" rootsandrings`).
- [ ] **Step 8: Commit** — `feat(backend): scaffold fastify+prisma+mysql, env, schema, migration`.

---

### Task 2: App factory, plugins, health, swagger

**Files:** Create `src/app.ts`, `src/server.ts`, `src/plugins/{prisma,security,session,csrf,swagger,view,static,errors}.ts`, `src/modules/health/routes.ts`.

**Interfaces:**
- Produces: `buildApp(): Promise<FastifyInstance>` registering all plugins + routes; `app.prisma` decorator; `GET /api/health` → `{ status:'ok', db:boolean }`. Security plugin sets Helmet CSP, rate-limit, CORS allow-list `env.STOREFRONT_ORIGIN`. Session plugin: signed cookie session for admin. CSRF plugin guards `/admin` POSTs. View plugin: eta from `modules/admin/views`. Static plugin: `/uploads/*`.

- [ ] **Step 1:** `plugins/prisma.ts` — fastify-plugin that `new PrismaClient()`, `decorate('prisma')`, `onClose` disconnect.
- [ ] **Step 2:** `plugins/security.ts` — register `@fastify/helmet` (CSP: default-src 'self'; img-src 'self' data:; style/script for admin), `@fastify/rate-limit` (global 200/min), `@fastify/cors` (`origin: env.STOREFRONT_ORIGIN, credentials:true`).
- [ ] **Step 3:** `plugins/session.ts` (cookie + session signed, httpOnly, sameSite lax), `plugins/csrf.ts` (`@fastify/csrf-protection` with session storage; expose `reply.generateCsrf()`), `plugins/view.ts` (eta), `plugins/static.ts` (`/uploads`), `plugins/swagger.ts` (`/docs`), `plugins/errors.ts` (setErrorHandler → structured JSON `{ error, message, statusCode }`, never leak internals).
- [ ] **Step 4:** `modules/health/routes.ts` — `GET /api/health` pings `prisma.$queryRaw\`SELECT 1\``.
- [ ] **Step 5:** `app.ts` composes them with `fastify-type-provider-zod` validator/serializer; `server.ts` calls `buildApp().listen({ port: env.PORT })`.
- [ ] **Step 6: Verify** — write `tests/health` using `app.inject({method:'GET',url:'/api/health'})` → 200 `{status:'ok'}`. Run `node node_modules/vitest/vitest.mjs run tests/health*`. Boot `node --import tsx src/server.ts`; `/docs` loads.
- [ ] **Step 7: Commit** — `feat(backend): app factory, security/session/csrf/view/static/swagger plugins, health`.

---

### Task 3: Pricing engine (TDD)

**Files:** Create `src/lib/pricing.ts`, `tests/pricing.test.ts`.

**Interfaces:**
- Produces: `resolvePrice(input: PriceInput, now: Date): ResolvedPrice` where `PriceInput = { basePrice:number; salePrice?:number|null; flashPrice?:number|null; flashStartAt?:Date|null; flashEndAt?:Date|null; currency:string }` and `ResolvedPrice = { price:number; compareAt:number|null; isOnSale:boolean; isOnFlash:boolean; currency:string }`. Also `resolveVariantPrice(product, variant, now)` (variant price overrides when non-null).

- [ ] **Step 1: Failing tests** — base only → price=base,compareAt=null; sale<base → price=sale,compareAt=base,isOnSale; flash within window & <base → isOnFlash,compareAt=base; flash outside window → ignored; flash≥base → ignored; variant override beats product.
- [ ] **Step 2: Run** `node node_modules/vitest/vitest.mjs run tests/pricing.test.ts` → FAIL.
- [ ] **Step 3: Implement** `resolvePrice`/`resolveVariantPrice` per spec §5.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(backend): read-time pricing engine`.

---

### Task 4: Core lib helpers (slug, sanitize, password, audit, menu-cache, mappers)

**Files:** Create `src/lib/{slug,sanitize,password,audit,menu-cache,mappers}.ts`, `tests/helpers.test.ts`.

**Interfaces:**
- Produces: `slugify(s):string`, `uniqueSlug(base, exists)`; `sanitizeRichText(html):string` (sanitize-html allow-list: p,strong,em,ul,ol,li,a[href],h2,h3,br,blockquote); `hashPassword(pw)/verifyPassword(pw,hash)` (bcryptjs); `writeAudit(prisma, {actor, action, entity, entityId, before, after, req})`; `getMenu(prisma)` (in-memory TTL 60s cache of category tree, `invalidateMenu()`); `toProductCardDTO(p)`, `toProductDetailDTO(p, related)`, `toCollectionDTO(c)` mapping Prisma rows → the storefront JSON shapes.

- [ ] **Step 1: Failing tests** — slugify('The Kura Vessel')==='the-kura-vessel'; sanitizeRichText strips `<script>` keeps `<strong>`; hash/verify round-trips; uniqueSlug appends `-2` on collision.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement. **Step 4: Run** → PASS. **Step 5: Commit** — `feat(backend): slug/sanitize/password/audit/menu/mappers helpers`.

---

### Task 5: Seed + create-admin

**Files:** Create `prisma/seed.ts`, `src/scripts/create-admin.ts`.

**Interfaces:**
- Consumes: prisma client, helpers (hashPassword, slugify), the existing `frontend/src/data/products.ts` content (copied/translated into the seed).
- Produces: idempotent seed creating 1 ADMIN (from env), 5 PRODUCT_TYPE categories, 3 COLLECTION categories, 16 products (with specs/edition/badges JSON, currency BDT) mapped to categories+collections, and copying the 35 images from `frontend/src/assets/images/*.jpg` into `backend/uploads/products/` with ProductImage rows (url `/uploads/products/<stem>.jpg`).

- [ ] **Step 1:** Implement `seed.ts` (upsert by slug/email so reruns are safe). Copy images via `fs.copyFile`. Map each product's `images[].src` stem → `/uploads/products/<stem>.jpg`.
- [ ] **Step 2:** Implement `create-admin.ts` (prompt-free: reads env, upserts admin).
- [ ] **Step 3: Verify** — `node --import tsx prisma/seed.ts`; query counts: `prisma.product.count()===16`, categories===8, user ADMIN exists; images copied.
- [ ] **Step 4: Commit** — `feat(backend): idempotent seed + create-admin script`.

---

### Task 6: Catalog service + public API (TDD via inject)

**Files:** Create `src/modules/catalog/{service.ts,routes.ts,schemas.ts}`, `tests/catalog.api.test.ts`. Add FULLTEXT migration `prisma/migrations/<ts>_fulltext/migration.sql`.

**Interfaces:**
- Consumes: prisma, pricing, mappers, menu-cache.
- Produces routes: `GET /api/health` (exists), `GET /api/categories?kind=`, `GET /api/categories/:slug`, `GET /api/collections`, `GET /api/products` (query: category,clayBody,attribute,minPrice,maxPrice,inStock,onSale,sort,q,page,pageSize → `{items,total,facets,page,pageSize}`), `GET /api/products/:slug`, `GET /api/products/:slug/related`, `GET /api/featured`. Service methods mirror the storefront's current `catalog.ts` (listProducts/getProduct/getCollections/getFeatured/getRelated/getFacets) but over Prisma; full-text via `MATCH(name,shortDescription) AGAINST(:q IN NATURAL LANGUAGE MODE)` when `q` set, else filtered query. All zod-validated; prices resolved with `resolvePrice`.

- [ ] **Step 1:** Add FULLTEXT index migration (raw SQL `ALTER TABLE Product ADD FULLTEXT idx_product_fts (name, shortDescription)`), apply with `migrate dev`.
- [ ] **Step 2: Failing endpoint tests** — products list returns seeded count; `?category=bowls` only bowls; `?sort=price-asc` ascending; `?q=kura` finds Kura; `/api/products/the-kura-vessel` returns full detail with resolved price + images; `/api/collections` includes `the-first-firing`; `/api/featured` only featured; unknown slug → 404.
- [ ] **Step 3: Run** → FAIL. **Step 4:** implement service + routes + schemas. **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** — `feat(backend): public catalog API (categories, collections, products, search, featured)`.

---

### Task 7: Admin session auth + role guards

**Files:** Create `src/modules/admin/{guards.ts,auth.ts}`, `src/modules/admin/views/{layout.eta,login.eta}`, `tests/admin.auth.test.ts`.

**Interfaces:**
- Produces: `requireAdminSession` preHandler (redirects to `/admin/login` if no session), `requireRole('ADMIN')` preHandler (403 for STAFF). Routes: `GET /admin/login` (renders form + CSRF token), `POST /admin/login` (rate-limited; verify bcrypt; set `request.session.user={id,email,role}`; update lastLoginAt; redirect `/admin`), `POST /admin/logout` (destroy session). Login failures generic ("Invalid credentials"), no user enumeration.

- [ ] **Step 1: Failing tests** — GET `/admin` without session → 302 `/admin/login`; POST login wrong password → re-render with error, no session; correct → 302 `/admin` + session cookie; logout clears it.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement guards + auth routes + eta layout/login (brand-palette CSS). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(backend): admin session auth + role guards`.

---

### Task 8: Admin dashboard + Categories CRUD

**Files:** Create `src/modules/admin/{dashboard.ts,categories.ts}`, views `dashboard.eta,categories.eta,category-form.eta`.

**Interfaces:**
- Consumes: guards, prisma, audit, menu-cache, slug.
- Produces: `GET /admin` (counts: products, categories, variants low-stock, users; recent audit). Categories: `GET /admin/categories` (tree, both kinds), `GET/POST /admin/categories/new`, `GET/POST /admin/categories/:id/edit`, `POST /admin/categories/:id/delete`, reorder. Mutations CSRF-guarded, audit-logged, `invalidateMenu()` after writes. Slug auto from name; uniqueness enforced.

- [ ] **Step 1:** Implement dashboard route + view.
- [ ] **Step 2:** Implement category CRUD routes + forms (kind select, parent select, sortOrder, SEO, image upload optional).
- [ ] **Step 3: Verify** — inject: create category → appears in list + `/api/categories`; delete; unauthorized (no session) → redirect. Browser: dashboard renders.
- [ ] **Step 4: Commit** — `feat(backend): admin dashboard + categories CRUD`.

---

### Task 9: Admin Products CRUD + WebP upload pipeline

**Files:** Create `src/modules/admin/products.ts`, `src/modules/uploads/service.ts`, views `products-list.eta,product-form.eta`, `tests/uploads.test.ts`.

**Interfaces:**
- Consumes: guards, prisma, sanitizeRichText, pricing, audit, uploads service.
- Produces: `UploadsService.processImage(buffer, kind): Promise<{url,width,height}>` (magic-byte sniff, sharp rotate/strip/resize≤1600/webp q80, random name, into `uploads/<kind>/`). Product routes: list (search/paginate), new, edit (all fields incl. salePrice, flash window, isFeatured/featuredOrder, allowBackorder, min/maxPerOrder, category, collection multiselect, variants inline, SEO), delete, image add/delete/set-primary/reorder. Rich description sanitized on write. All audit-logged + CSRF.

- [ ] **Step 1: Failing test (uploads)** — non-image buffer rejected; a small PNG buffer → returns `.webp` url + dimensions; output file exists.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement uploads service. **Step 4: Run** → PASS.
- [ ] **Step 5:** Implement product CRUD routes + forms + variant/image management.
- [ ] **Step 6: Verify** — inject: create product (sanitized desc), upload image, set featured → shows in `/api/products` + `/api/featured`; edit price → `/api/products/:slug` reflects; delete.
- [ ] **Step 7: Commit** — `feat(backend): admin products CRUD + sharp WebP upload pipeline`.

---

### Task 10: Admin Team management + audit boundary

**Files:** Create `src/modules/admin/team.ts`, view `team.eta`, `tests/admin.team.test.ts`.

**Interfaces:**
- Consumes: `requireRole('ADMIN')`, prisma, password, audit.
- Produces: `GET /admin/team` (list users; visible to ADMIN+STAFF), `POST /admin/team` (add user — ADMIN only), `POST /admin/team/:id/role` (change role — ADMIN only), `POST /admin/team/:id/delete` (ADMIN only). Guards: STAFF gets 403 on mutations; cannot delete self if last ADMIN; cannot demote last ADMIN. All audit-logged.

- [ ] **Step 1: Failing tests** — STAFF session POST `/admin/team` → 403; ADMIN add user → created + audit row; delete last admin → blocked (4xx); list visible to STAFF (read).
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(backend): admin team management with role boundary + audit`.

---

### Task 11: Storefront wiring (SSR + catalog.ts → API + Img remote + currency)

**Files:** Modify `frontend/astro.config.mjs`, `frontend/src/lib/catalog.ts`, `frontend/src/lib/format.ts`, `frontend/src/components/ui/Img.astro`, set `export const prerender = false` on catalog pages; create `frontend/src/lib/api.ts`. Install `@astrojs/node` in frontend.

**Interfaces:**
- Consumes: backend public API (`PUBLIC_API_URL`, default `http://localhost:4000`).
- Produces: `api.ts` — `fetchProducts/fetchProduct/fetchCollections/fetchFeatured/fetchRelated/fetchFacets` returning the existing `Product`/`Collection` types (DTO→type mapping). `catalog.ts` keeps its **exact existing signatures** (`getProducts/getProduct/getRelated/getFeatured/getCollections/getFacets`) but delegates to `api.ts`. `Img.astro` renders remote URLs (Astro `<Image>` with `remotePatterns` for backend origin; `<img srcset>` fallback). `formatPrice` switches symbol by currency (BDT→`৳`).

- [ ] **Step 1:** Add `@astrojs/node` adapter (`output: 'server'` or hybrid), `image.remotePatterns` for `localhost:4000`, env `PUBLIC_API_URL`.
- [ ] **Step 2:** Implement `api.ts` + repoint `catalog.ts`; mark catalog pages `prerender = false`.
- [ ] **Step 3:** Update `Img.astro` (remote) + `format.ts` (currency). **No component markup/class changes** beyond image src handling.
- [ ] **Step 4: Verify (browser)** — start backend + seeded DB + frontend SSR; `/objects`, `/objects/the-kura-vessel`, `/collections`, home render **live** data, visually identical to the mock-data version; edit a product in admin → refresh storefront shows the change.
- [ ] **Step 5: Commit** — `feat: wire storefront catalog to live backend API (SSR), no UI change`.

---

### Task 12: Endpoint verification sweep, OpenAPI, README

**Files:** Create `backend/README.md`; ensure swagger covers public routes; add `tests/smoke.api.test.ts` enumerating every public endpoint.

- [ ] **Step 1:** Smoke test hitting **every** public endpoint (health, categories, categories/:slug, collections, products, products/:slug, products/:slug/related, featured) asserting 2xx/expected 404s.
- [ ] **Step 2:** Run full suite `node node_modules/vitest/vitest.mjs run` → all PASS. Confirm `/docs` lists public routes.
- [ ] **Step 3:** Manual admin browser pass: login, create/edit product + upload, categories, team boundary (login as STAFF), verify audit log entries.
- [ ] **Step 4:** `README.md` — setup (docker compose, migrate, seed, run both apps via node entries), env vars, cron note (Phase 2), and "Phase 1 implemented vs deferred" matrix.
- [ ] **Step 5: Commit** — `docs(backend): README + endpoint smoke tests; phase 1 complete`.

---

## Self-Review

**Spec coverage:** §2 architecture → Tasks 1–2,11. §3 stack → Tasks 1–2. §4 schema → Task 1. §5 pricing → Task 3. §6 public API → Task 6. §7 admin (auth/dashboard/categories/products/team) → Tasks 7–10. §8 uploads → Task 9. §9 storefront wiring → Task 11. §11 security → Tasks 2,7,9 (helmet/csrf/rate-limit/sanitize/magic-bytes). §12 testing → Tasks 3,6,7,9,10,12. §13 infra/README → Tasks 1,12. All Phase-1 sections covered. (Customer accounts/cart/orders/payments/coupons/reviews/wishlist/inventory-ledger/jobs/cron/SEO are intentionally Phase 2+, per spec §1 non-goals.)

**Placeholder scan:** Admin view templates and CRUD forms are described by exact fields + behavior rather than full markup (repetitive HTML); their routes/handlers carry complete behavioral specs and are verified by inject + browser. No TBD/unspecified logic steps.

**Type consistency:** `resolvePrice`/`ResolvedPrice` used consistently (Tasks 3,6,9). Catalog service method names mirror storefront `catalog.ts` (Tasks 6,11). DTO mappers (`toProductCardDTO`/`toProductDetailDTO`/`toCollectionDTO`, Task 4) consumed by Task 6 and mirrored by frontend `api.ts` (Task 11). Guard names (`requireAdminSession`,`requireRole`) consistent (Tasks 7–10). `UploadsService.processImage` consistent (Task 9).

**Note on TDD:** Logic + endpoints are TDD (pricing, helpers, catalog API, admin auth/team, uploads) via Vitest/`.inject()`. Admin eta views are build-and-verify (inject + browser) — appropriate for server-rendered templates.
