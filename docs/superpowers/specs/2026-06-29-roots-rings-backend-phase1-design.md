# Roots & Rings Backend — Phase 1 Design Spec (Foundation + Catalog + Admin)

**Date:** 2026-06-29
**Status:** Approved (design + BDT option-a confirmed)
**Part of:** a phased adaptation of a production NestJS e-commerce spec to **Fastify**, wired
into the existing Astro storefront **without changing its UI**.

## 0. Context & phasing

The source spec is a full production e-commerce backend (14 sections + enhancements),
originally NestJS + MySQL + bKash/Bangladesh. We are reproducing its "great features" on
**Fastify**, in phases. This document covers **Phase 1 only**.

- **Phase 1 (this spec):** Backend foundation (Fastify + Prisma + MySQL, security, admin
  session auth), Catalog API (categories + products + pricing), server-rendered Admin panel
  (catalog + team management), and wiring the storefront's catalog to the live API.
- **Phase 2+ (future specs):** customer accounts/JWT/OAuth/OTP, cart, checkout & orders,
  payments (COD + bKash), coupons, reviews, wishlist, inventory ledger, jobs/cron, SEO/CMS,
  then the Enhancements list.

**Confirmed decisions:** phased build · currency **BDT** (display ৳, keep existing numbers,
adjustable in admin) · payments literal **bKash** (later phase) · **minimal on-brand UI
additions allowed** when a feature needs them (later phases) · **Dockerized MySQL**.

**Mapping:** Storefront **Collections → Categories**, **Shop/Objects → Products**.

## 1. Goals & non-goals (Phase 1)

**Goals**
- Runnable Fastify + Prisma + MySQL backend with migrations, seed, and OpenAPI docs.
- Public catalog API the storefront consumes (categories, products, pricing engine, search,
  filters, pagination).
- Server-rendered Admin panel: session auth, dashboard, Products CRUD (+ WebP upload, flash
  deals, featured), Categories tree CRUD, Team management with Admin-vs-Staff boundary,
  audit logging, CSRF.
- Storefront reads **live** data from the API with **zero visual change** (SSR-hybrid).
- Security hardening (Helmet CSP, rate-limit, signed cookies, CSRF, sanitize-html, upload
  magic-byte validation). zod env validation.
- Verification: endpoint tests for **every** Phase-1 route + unit tests (pricing, roles);
  browser pass of admin + storefront.

**Non-goals (deferred to later phases)**
- Customer auth (JWT/OAuth/OTP), cart persistence, checkout/orders, payments, coupons,
  reviews, wishlist, inventory reservations, jobs/cron, SEO/CMS, i18n/translations,
  attributes table, redirects. (Schema is designed to extend cleanly to these.)

## 2. Architecture

- **Monorepo** under `D:\Roots & Rings\`:
  - `frontend/` — Astro storefront (existing). Becomes **SSR-hybrid** via `@astrojs/node`
    so catalog pages fetch live data. **No UI/design change.**
  - `backend/` — Fastify app: **public JSON API** (for the storefront) **+** server-rendered
    **Admin panel** (sessions, CSRF forms, uploads).
  - `docker-compose.yml` — MySQL 8 (or MariaDB) for local dev.
- **Backend module layout** (`backend/src/`):
  - `app.ts` (builds the Fastify instance), `server.ts` (boot).
  - `env.ts` (zod-validated config).
  - `plugins/` — `prisma.ts`, `security.ts` (helmet/rate-limit/cors), `cookie-session.ts`,
    `csrf.ts`, `swagger.ts`, `view.ts` (admin templates), `static.ts` (uploads + admin assets).
  - `lib/` — `pricing.ts`, `slug.ts`, `sanitize.ts`, `audit.ts`, `password.ts`, `errors.ts`,
    `menu-cache.ts`.
  - `modules/`
    - `catalog/` — `routes.public.ts`, `service.ts`, `schemas.ts`.
    - `admin/` — `auth.ts`, `dashboard.ts`, `products.ts`, `categories.ts`, `team.ts`,
      `guards.ts`, `views/` (templates).
    - `uploads/` — `service.ts` (sharp WebP pipeline).
    - `health/`.
  - `prisma/` — `schema.prisma`, `migrations/`, `seed.ts`.
  - `tests/` — Vitest endpoint + unit tests (Fastify `.inject()`).

## 3. Tech stack (Fastify equivalents)

| Concern | NestJS spec | Phase 1 (Fastify) |
|---|---|---|
| Framework | NestJS | **Fastify** + TypeScript strict |
| ORM/DB | Prisma + MySQL | **Prisma + MySQL** (Docker), Decimal(12,2), currency BDT |
| Validation | class-validator DTOs | **zod** via `fastify-type-provider-zod`; zod env validation |
| Admin auth | signed cookie session + RolesGuard | `@fastify/cookie` signed + `@fastify/secure-session`; role preHandlers |
| Password | bcryptjs | **bcryptjs** |
| Security | helmet, csrf-csrf, throttler, sanitize-html | `@fastify/helmet`, `@fastify/csrf-protection`, `@fastify/rate-limit`, **sanitize-html** |
| Uploads/media | sharp → WebP | `@fastify/multipart` + **sharp** (magic bytes, EXIF rotate, ≤1600px, q80, WebP) |
| Admin views | Nunjucks/Alpine/htmx | `@fastify/view` + **eta** templates + light vanilla JS |
| Docs | Swagger | `@fastify/swagger` + `@fastify/swagger-ui` |
| Tests | Jest + supertest | **Vitest** + Fastify `.inject()` |

## 4. Data model (Phase 1 Prisma)

Enums: `Role { ADMIN STAFF }`, `CategoryKind { PRODUCT_TYPE COLLECTION }`.

- **User**: id, email @unique, passwordHash, name, role(Role default STAFF), isActive(bool
  default true), lastLoginAt?, timestamps.
- **Category**: id, kind(CategoryKind), name, slug @unique, tagline?, description?, imageUrl?,
  parentId? (self-relation children), sortOrder(int default 0), isActive(bool default true),
  seoTitle?, seoDescription?, timestamps. Indexes: (kind), (parentId), (isActive, sortOrder).
  - `kind=PRODUCT_TYPE` → storefront "Category" facet (Vessels, Bowls, Plates, Sculptural,
    Tableware). `kind=COLLECTION` → storefront Collections (The First Firing, …).
- **Product**: id, name, slug @unique, sku @unique, subtitle, shortDescription,
  description(sanitized HTML), clayBody?(string), badges(Json string[]), basePrice(Decimal),
  salePrice(Decimal?), flashPrice(Decimal?), flashStartAt?, flashEndAt?, currency(default
  'BDT'), isActive(bool), isFeatured(bool), featuredOrder(int?), allowBackorder(bool default
  false), minPerOrder(int default 1), maxPerOrder(int?), specs(Json), edition(Json?),
  curatorsNote?, seenInInteriors(Json?), seoTitle?, seoDescription?, publishedAt?, timestamps,
  categoryId? (→ Category PRODUCT_TYPE). Indexes: (isActive), (isFeatured, featuredOrder),
  (basePrice), (createdAt), (publishedAt), (flashEndAt), (categoryId); **FULLTEXT(name,
  shortDescription)** (raw SQL in migration). M:N `collections` (Product↔Category COLLECTION)
  via implicit join.
- **ProductVariant**: id, productId, sku @unique, name, size?, color?, price(Decimal?),
  salePrice(Decimal?), stock(int default 0), lowStockThreshold(int default 0), weight?,
  barcode?, position(int default 0), isActive(bool default true), timestamps. Indexes:
  (productId, isActive), (stock).
- **ProductImage**: id, productId, variantId?, url, alt?, width?, height?, position(int
  default 0), isPrimary(bool default false), timestamps. Indexes: (productId, position),
  (variantId).
- **AdminAuditLog**: id, actorUserId?, actorEmail, action, entity, entityId?, before(Json?),
  after(Json?), ip?, userAgent?, createdAt. Index (entity, entityId), (createdAt).
- **Setting**: key @id, value(Json), updatedAt.

Money: all prices Decimal(12,2). Existing storefront numbers seeded as-is with currency BDT.

## 5. Pricing engine (`lib/pricing.ts`)

`resolvePrice(p, now)` → `{ price, compareAt, isOnSale, isOnFlash, currency }`:
1. **Flash** if `flashPrice != null && flashStartAt <= now <= flashEndAt && flashPrice <
   basePrice` → price=flashPrice, compareAt=basePrice, isOnFlash.
2. Else **Sale** if `salePrice != null && salePrice < basePrice` → price=salePrice,
   compareAt=basePrice, isOnSale.
3. Else **Base** → price=basePrice. Variant price overrides product price when set (null →
   inherit). Read-time only; flash auto-reverts after `flashEndAt`. Unit-tested.

## 6. Public API (consumed by storefront)

JSON, CORS-restricted to storefront origin, rate-limited, zod-validated, ETag where cheap.

- `GET /api/health` → `{ status, db }`.
- `GET /api/categories?kind=` → cached tree (menu). `GET /api/categories/:slug` → category +
  (optionally) its products.
- `GET /api/collections` → `kind=COLLECTION` categories (slug, name, tagline, description,
  image) — feeds storefront `getCollections()`.
- `GET /api/products` → filters: `category` (slug), `clayBody`, `attribute` (badge), `minPrice`,
  `maxPrice`, `inStock`, `onSale`, `sort` (newest|price-asc|price-desc|name), `q` (FULLTEXT),
  `page`, `pageSize`. Returns `{ items: ProductCard[], total, facets }` where facets =
  distinct categories/clayBodies/attributes present.
- `GET /api/products/:slug` → full product (resolved pricing, images, variants, specs,
  edition, curatorsNote, seenInInteriors, related). Feeds `getProduct`.
- `GET /api/products/:slug/related` → related products.
- `GET /api/featured` → featured products (ordered).

Response shapes map 1:1 onto the storefront's existing `Product`/`Collection` types so
components are untouched.

## 7. Admin panel (server-rendered, `/admin`)

Session-guarded (signed cookie), CSRF on every form, rate-limited login, all mutations
audit-logged, role boundary enforced.

- `GET/POST /admin/login`, `POST /admin/logout`.
- `GET /admin` — dashboard: counts (products, categories, low-stock variants, users) + recent
  audit entries.
- **Products**: `GET /admin/products` (list, search, paginate), `GET/POST /admin/products/new`,
  `GET/POST /admin/products/:id/edit`, `POST /admin/products/:id/delete`, image upload
  (`POST /admin/products/:id/images`, delete, set-primary, reorder), flash-deal + featured
  fields, collection membership. Rich description **sanitized on write**.
- **Categories**: `GET /admin/categories` (tree, both kinds), create/edit/delete, reorder.
- **Team** (`/admin/team`): list users; **ADMIN only** can add/delete users and change roles;
  **STAFF** is blocked from those (guard + UI hide). Can't delete the last admin / self-demote
  the last admin.
- Admin UI: eta templates, minimal CSS in the brand palette (so it feels related but is clearly
  the back office), light vanilla JS for image reorder/preview. **Not** part of the storefront
  bundle.

## 8. Uploads (`uploads/service.ts`)

`@fastify/multipart` stream → buffer (size cap) → **magic-byte** sniff (jpeg/png/webp/avif;
reject mismatched client MIME) → sharp: `rotate()` (EXIF), strip metadata, resize long edge
≤1600px, `.webp({ quality: 80 })` → random filename → `uploads/{products|categories|avatars}/`.
Returns `{ url, width, height }`. Served via `@fastify/static` at `/uploads/*`.

## 9. Storefront wiring (no UI change)

- Add `@astrojs/node` adapter; set catalog pages (`/objects`, `/objects/[slug]`,
  `/collections`, home featured) to **SSR** (`export const prerender = false`) so they fetch
  live data; static pages stay prerendered.
- `frontend/src/lib/catalog.ts`: replace mock-data bodies with `fetch(${PUBLIC_API_URL}/api/...)`,
  mapping API JSON → existing `Product`/`Collection` types. **Signatures unchanged**, so every
  component keeps working as-is.
- Images: API returns absolute URLs (Fastify `/uploads`). `Img.astro` handles remote URLs
  (Astro `<Image>` with `image.remotePatterns` for the backend origin; plain `<img srcset>`
  fallback). Seed copies the existing 35 local images into `backend/uploads/products` and sets
  URLs, so the storefront looks identical.
- `formatPrice` updated to honor currency (BDT → `৳`), same layout.
- Graceful degradation: if the API is unreachable at build/SSR, pages render an empty-but-valid
  state (no crash).

## 10. Seed (`prisma/seed.ts`)

- Idempotent. Creates: one **ADMIN** user from `ADMIN_EMAIL`/`ADMIN_PASSWORD` env (a separate
  `create-admin` script too; admin-safe, no demo users in prod).
- PRODUCT_TYPE categories: Vessels, Bowls, Plates, Sculptural, Tableware.
- COLLECTION categories: The First Firing, The Quiet Table, Porcelain & Light.
- The existing 16 products (from the current `frontend/src/data/products.ts`) with their
  specs/edition/badges/images, currency BDT, mapped to categories + collections; images copied
  into `backend/uploads`.

## 11. Security & non-functional

- `@fastify/helmet` strict CSP; `@fastify/rate-limit` (tighter on `/admin/login`);
  signed/httpOnly cookies; `@fastify/csrf-protection` for admin forms; CORS allow-list to
  storefront origin; **sanitize-html** as the single trust boundary for rich text; upload
  magic-byte validation; never log secrets/PII; global error handler with structured JSON
  errors; `/api/health`.
- zod env validation at boot (DATABASE_URL, SESSION_SECRET, COOKIE_SECRET, APP_URL,
  STOREFRONT_ORIGIN, ADMIN_EMAIL, ADMIN_PASSWORD, CRON_TOKEN, etc.).
- Indexing per §4. Transactions used where multi-row writes occur (image reorder, etc.).

## 12. Testing & verification (acceptance)

- **Vitest unit:** pricing engine (flash/sale/base + variant override), role boundary helper,
  slug/sanitize helpers.
- **Vitest endpoint (`.inject()`):** every public API route (happy + key error paths) and key
  admin routes (login required, role boundary on team, CRUD round-trips, upload validation).
  Run against a test MySQL schema (migrated, seeded).
- **Browser pass:** admin login → create/edit a product + image upload → see it on the
  storefront; categories/collections; team boundary; storefront catalog/PDP/collections all
  reading live data, visually unchanged.
- Report what passed after each module.

## 13. Infra & ops

- `docker-compose.yml`: MySQL 8 with a named volume, healthcheck; `.env` for both apps.
- Run (respecting the `&`-in-path gotcha — call node entries directly):
  - DB: `docker compose up -d db`
  - Migrate/seed: `node node_modules/prisma/build/index.js migrate dev` etc.
  - Backend dev: `node --watch dist/server.js` (or tsx).
  - Frontend dev: `node node_modules/astro/astro.js dev`.
- README documents setup, env vars, migrations, and Phase-1-implemented vs deferred features.

## 14. Risks

- **MySQL FULLTEXT** needs a raw-SQL migration step (Prisma can't express it natively) — handled
  in a follow-up migration.
- **Remote image optimization** in Astro SSR adds config; fallback to plain `<img>` keeps the
  look if needed.
- **SSR switch** changes the frontend run model (needs a Node server) but not the UI; documented.
- Docker MySQL must be up for backend dev/tests; compose + healthcheck mitigate.
- Scope creep: strictly hold the Phase-1 boundary; transactional/auth/payment depth lands in
  later phases.
