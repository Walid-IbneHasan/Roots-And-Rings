# Roots & Rings Phase 7 — Wishlist sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the existing client-only wishlist per customer and add a `/wishlist` page + a header heart, syncing the guest (localStorage) list into the account on login.

**Architecture:** A new backend `WishlistItem` model + owner-scoped account endpoints (list/add/remove/merge) behind the existing `/api/account/*` BFF proxy. The client `$wishlist` store stays the on-page source of truth; the island probes the merge endpoint (200 vs 401) to detect login, unions local→account, and writes through on toggle. `/wishlist` SSR-renders all products as real `ProductCard`s and an island shows only the wishlisted ones.

**Tech Stack:** Backend — Fastify 5, Prisma + MySQL 8, zod, Vitest + `.inject()`. Frontend — Astro 5 SSR, Tailwind v4, `@nanostores/persistent`.

## Global Constraints

- **NO git commits this phase.** Build everything in the working tree on branch `phase-7-wishlist`; the user commits + pushes at the end. Each task ends by **reporting the changed files** (relative paths), NOT by committing. Do not run `git add`/`git commit`/`git push`.
- **Ampersand-path gotcha:** the project is in `D:\Roots & Rings` — `&` breaks `npm run`. Call node entrypoints directly (never `npm run`):
  - Backend tests: `cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run [tests/<file>]`
  - Prisma migrate: `cd "D:/Roots & Rings/backend"; node --env-file=.env node_modules/prisma/build/index.js migrate dev --name <name>`
  - Frontend typecheck: `cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js check`
  - Frontend build: `cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build`
  - Frontend unit tests: `cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run`
- **DB:** `rootsandrings-db` (Docker, MySQL 8) must be up for backend tests + the migration.
- **DO NOT CHANGE THE UI design.** Reuse existing components (`ProductCard`, `BaseLayout`) and Tailwind classes only. Money renders via `formatPrice` (BDT ৳).
- **The BFF proxy needs no change:** `frontend/src/pages/api/account/[...path].ts` already forwards GET/POST/PATCH/DELETE to `/api/account/<path>` with the Bearer token and returns 401 when there's no session cookie — so `/api/account/wishlist`, `/api/account/wishlist/merge`, and `/api/account/wishlist/:slug` proxy automatically.
- **Frontend islands are not unit-tested (repo convention):** `cart-page.ts`, `header.ts`, `wishlist.ts` have no unit tests. Frontend tasks are verified by `astro check` (typecheck) + `astro build` (SSR build succeeds) + the existing 43 unit tests staying green; the browser E2E in Task 6 is the functional gate. Do not invent island unit tests.
- **TDD for backend** (failing test → implement → green). DRY, YAGNI.
- Test helper pattern (backend): `buildApp()` + `signCustomerToken(customer)` + `app.inject({ method, url, headers: { authorization: 'Bearer '+token }, payload })`.

---

### Task 1: WishlistItem schema + migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (new model + 2 back-relations)
- Create (generated): `backend/prisma/migrations/<ts>_phase7_wishlist/migration.sql`

**Interfaces:**
- Produces: Prisma model `WishlistItem { id, customerId, productId, createdAt }` with compound unique `@@unique([customerId, productId])` (Prisma client where-key `customerId_productId`); `prisma.wishlistItem` available on the client; `Customer.wishlist` + `Product.wishlistedBy` relations.

- [ ] **Step 1: Add the model to `backend/prisma/schema.prisma`**

Add this model (place it right after the `Review` model, near the other customer-owned models):

```prisma
model WishlistItem {
  id         String   @id @default(cuid())
  customerId String
  customer   Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  productId  String
  product    Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  createdAt  DateTime @default(now())

  @@unique([customerId, productId])
  @@index([customerId])
}
```

- [ ] **Step 2: Add the back-relations**

In `model Customer { … }`, add a line alongside `reviews   Review[]`:
```prisma
  wishlist        WishlistItem[]
```
In `model Product { … }`, add a line alongside `reviews     Review[]`:
```prisma
  wishlistedBy WishlistItem[]
```

- [ ] **Step 3: Create + apply the migration (also regenerates the client)**

```
cd "D:/Roots & Rings/backend"
node --env-file=.env node_modules/prisma/build/index.js migrate dev --name phase7_wishlist
```
Expected: a new `…_phase7_wishlist` migration is created + applied, and "✔ Generated Prisma Client". If it prompts to reset (it should NOT — this is purely additive), STOP and report — an additive table must not require a reset.

- [ ] **Step 4: Verify the model is usable + the suite still passes**

```
cd "D:/Roots & Rings/backend"
node --env-file=.env --import tsx -e "import {PrismaClient} from '@prisma/client'; const p=new PrismaClient(); const n=await p.wishlistItem.count(); console.log('wishlistItem count =', n); await p.$disconnect();"
node node_modules/vitest/vitest.mjs run
```
Expected: prints `wishlistItem count = 0` (table exists, client typed) and the full backend suite stays green (146 passed).

- [ ] **Step 5: Report changed files** (do NOT commit). List `prisma/schema.prisma` and the new migration directory.

---

### Task 2: Wishlist account endpoints

**Files:**
- Create: `backend/src/modules/account/wishlist.ts`
- Modify: `backend/src/modules/account/routes.ts` (import + register)
- Test: `backend/tests/account.wishlist.test.ts`

**Interfaces:**
- Consumes: `prisma.wishlistItem` + `Customer.wishlist`/`Product.wishlistedBy` (Task 1); `requireCustomer` guard; `httpError`.
- Produces (HTTP, all `requireCustomer`, owner-scoped): `GET /api/account/wishlist` → `string[]` (slugs, newest first); `POST /api/account/wishlist {slug}` → 201 `{ok:true}` (404 unknown/inactive slug; idempotent); `DELETE /api/account/wishlist/:slug` → `{ok:true}`; `POST /api/account/wishlist/merge {slugs:string[]}` → `string[]` (full merged list). Function `registerWishlistRoutes(app)`.

- [ ] **Step 1: Write the failing test — `backend/tests/account.wishlist.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { signCustomerToken } from '../src/lib/jwt';
import { hashPassword } from '../src/lib/password';

let app: FastifyInstance;
let token1 = '';
let token2 = '';
let slug1 = '';
let slug2 = '';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const c1 = await app.prisma.customer.create({ data: { email: 'wl1-zz@test.com', name: 'WL1', passwordHash: await hashPassword('x12345678') } });
  const c2 = await app.prisma.customer.create({ data: { email: 'wl2-zz@test.com', name: 'WL2', passwordHash: await hashPassword('x12345678') } });
  token1 = signCustomerToken(c1);
  token2 = signCustomerToken(c2);
  const ps = await app.prisma.product.findMany({ where: { isActive: true }, take: 2, select: { slug: true } });
  slug1 = ps[0].slug;
  slug2 = ps[1].slug;
});

afterAll(async () => {
  await app.prisma.customer.deleteMany({ where: { email: { in: ['wl1-zz@test.com', 'wl2-zz@test.com'] } } });
  await app.close();
});

const h1 = () => ({ authorization: `Bearer ${token1}` });
const h2 = () => ({ authorization: `Bearer ${token2}` });

describe('account wishlist', () => {
  it('adds, lists, dedupes, 404s unknown, deletes', async () => {
    const add = await app.inject({ method: 'POST', url: '/api/account/wishlist', headers: h1(), payload: { slug: slug1 } });
    expect(add.statusCode).toBe(201);
    let list = await app.inject({ method: 'GET', url: '/api/account/wishlist', headers: h1() });
    expect(list.json()).toEqual([slug1]);

    await app.inject({ method: 'POST', url: '/api/account/wishlist', headers: h1(), payload: { slug: slug1 } });
    list = await app.inject({ method: 'GET', url: '/api/account/wishlist', headers: h1() });
    expect(list.json()).toEqual([slug1]); // idempotent — still one

    const bad = await app.inject({ method: 'POST', url: '/api/account/wishlist', headers: h1(), payload: { slug: 'no-such-slug-xyz' } });
    expect(bad.statusCode).toBe(404);

    const del = await app.inject({ method: 'DELETE', url: `/api/account/wishlist/${slug1}`, headers: h1() });
    expect(del.statusCode).toBe(200);
    list = await app.inject({ method: 'GET', url: '/api/account/wishlist', headers: h1() });
    expect(list.json()).toEqual([]);
  });

  it('merge unions provided slugs, ignores unknown, returns the full list', async () => {
    await app.inject({ method: 'POST', url: '/api/account/wishlist', headers: h1(), payload: { slug: slug1 } });
    const merged = await app.inject({ method: 'POST', url: '/api/account/wishlist/merge', headers: h1(), payload: { slugs: [slug2, 'no-such-slug-xyz'] } });
    expect(merged.statusCode).toBe(200);
    const slugs = merged.json() as string[];
    expect(slugs).toContain(slug1);
    expect(slugs).toContain(slug2);
    expect(slugs).not.toContain('no-such-slug-xyz');
    expect(slugs.length).toBe(2);
  });

  it('is owner-scoped — a second customer sees none of the first customer items', async () => {
    const list2 = await app.inject({ method: 'GET', url: '/api/account/wishlist', headers: h2() });
    expect(list2.json()).toEqual([]);
  });

  it('requires auth', async () => {
    const noauth = await app.inject({ method: 'GET', url: '/api/account/wishlist' });
    expect(noauth.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/account.wishlist.test.ts
```
Expected: FAIL (routes return 404 / not registered).

- [ ] **Step 3: Implement `backend/src/modules/account/wishlist.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../lib/errors';
import { requireCustomer } from '../auth/guards';

const addBody = z.object({ slug: z.string().trim().min(1) });
const mergeBody = z.object({ slugs: z.array(z.string().trim().min(1)).max(200) });

async function listSlugs(app: FastifyInstance, customerId: string): Promise<string[]> {
  const rows = await app.prisma.wishlistItem.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    include: { product: { select: { slug: true } } },
  });
  return rows.map((r) => r.product.slug);
}

export function registerWishlistRoutes(app: FastifyInstance) {
  app.get('/api/account/wishlist', { preHandler: requireCustomer }, async (request) => {
    return listSlugs(app, request.customer!.id);
  });

  app.post('/api/account/wishlist', { preHandler: requireCustomer }, async (request, reply) => {
    const { slug } = addBody.parse(request.body);
    const customerId = request.customer!.id;
    const product = await app.prisma.product.findFirst({ where: { slug, isActive: true }, select: { id: true } });
    if (!product) throw httpError(404, 'Product not found');
    await app.prisma.wishlistItem.upsert({
      where: { customerId_productId: { customerId, productId: product.id } },
      create: { customerId, productId: product.id },
      update: {},
    });
    return reply.status(201).send({ ok: true });
  });

  app.delete('/api/account/wishlist/:slug', { preHandler: requireCustomer }, async (request) => {
    const { slug } = request.params as { slug: string };
    const customerId = request.customer!.id;
    const product = await app.prisma.product.findFirst({ where: { slug }, select: { id: true } });
    if (product) {
      await app.prisma.wishlistItem.deleteMany({ where: { customerId, productId: product.id } });
    }
    return { ok: true };
  });

  app.post('/api/account/wishlist/merge', { preHandler: requireCustomer }, async (request) => {
    const { slugs } = mergeBody.parse(request.body);
    const customerId = request.customer!.id;
    if (slugs.length) {
      const products = await app.prisma.product.findMany({
        where: { slug: { in: slugs }, isActive: true },
        select: { id: true },
      });
      for (const p of products) {
        await app.prisma.wishlistItem.upsert({
          where: { customerId_productId: { customerId, productId: p.id } },
          create: { customerId, productId: p.id },
          update: {},
        });
      }
    }
    return listSlugs(app, customerId);
  });
}
```

- [ ] **Step 4: Register the routes in `backend/src/modules/account/routes.ts`**

Add the import near the other `./` imports at the top:
```ts
import { registerWishlistRoutes } from './wishlist';
```
And add this line next to the existing `registerAddressRoutes(app);` (inside `accountRoutes`, before the closing brace):
```ts
  registerWishlistRoutes(app);
```

- [ ] **Step 5: Run the new test + the account regression**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/account.wishlist.test.ts tests/account.addresses.test.ts tests/account.profile.test.ts
```
Expected: PASS (wishlist 4; addresses + profile unchanged).

- [ ] **Step 6: Full-suite checkpoint**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
```
Expected: green (146 prior + wishlist 4 = 150).

- [ ] **Step 7: Report changed files** (do NOT commit): `src/modules/account/wishlist.ts`, `src/modules/account/routes.ts`, `tests/account.wishlist.test.ts`.

---

### Task 3: Client sync (merge on load + write-through)

**Files:**
- Modify: `frontend/src/scripts/wishlist.ts`

**Interfaces:**
- Consumes: `$wishlist`, `toggleWishlist` (from `../lib/stores`); the `/api/account/wishlist*` endpoints (Task 2) via the BFF proxy.
- Produces: on page load the island syncs the local wishlist with the account (when signed in) and writes heart toggles through to the server.

- [ ] **Step 1: Replace `frontend/src/scripts/wishlist.ts` with the synced version**

```ts
import { $wishlist, toggleWishlist } from '../lib/stores';

/**
 * Syncs every [data-wishlist] toggle button to the persisted wishlist store, and — when the
 * visitor is signed in — keeps the account's wishlist in sync:
 *  - on load, POST the local slugs to /api/account/wishlist/merge. 200 ⇒ signed in: adopt the
 *    returned union (local guest items merge into the account). 401 ⇒ guest: stay local-only.
 *  - on toggle, write through (POST add / DELETE remove), best-effort.
 * Uses event delegation so buttons added anywhere on the page work without re-binding.
 */
let loggedIn = false;

function sync(): void {
  const set = new Set($wishlist.get());
  document.querySelectorAll<HTMLElement>('[data-wishlist]').forEach((btn) => {
    const slug = btn.getAttribute('data-wishlist');
    if (!slug) return;
    const active = set.has(slug);
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
    btn.setAttribute('aria-label', active ? 'Remove from wishlist' : 'Add to wishlist');
  });
}

async function syncOnLoad(): Promise<void> {
  try {
    const res = await fetch('/api/account/wishlist/merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slugs: $wishlist.get() }),
    });
    if (res.ok) {
      loggedIn = true;
      const slugs: string[] = await res.json();
      $wishlist.set(slugs);
    }
  } catch {
    /* offline / network error — stay with the local list */
  }
}

async function writeThrough(slug: string, added: boolean): Promise<void> {
  if (!loggedIn) return;
  try {
    if (added) {
      await fetch('/api/account/wishlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
    } else {
      await fetch(`/api/account/wishlist/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    }
  } catch {
    /* best-effort — the local store already reflects the change */
  }
}

function init(): void {
  document.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-wishlist]');
    if (!btn) return;
    e.preventDefault();
    const slug = btn.getAttribute('data-wishlist');
    if (!slug) return;
    toggleWishlist(slug);
    void writeThrough(slug, $wishlist.get().includes(slug));
  });
  $wishlist.subscribe(sync);
  void syncOnLoad();
}

if (document.readyState !== 'loading') {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init);
}
```

- [ ] **Step 2: Typecheck + build**

```
cd "D:/Roots & Rings/frontend"
node node_modules/astro/astro.js check
node node_modules/astro/astro.js build
```
Expected: `astro check` reports 0 errors; the build completes (SSR output written). (No unit test — islands are verified by check+build+the Task 6 browser pass, per repo convention.)

- [ ] **Step 3: Run the frontend unit suite (no regression)**

```
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run
```
Expected: 43 passed (stores/format/schema unaffected).

- [ ] **Step 4: Report changed files** (do NOT commit): `src/scripts/wishlist.ts`.

---

### Task 4: `/wishlist` page

**Files:**
- Create: `frontend/src/pages/wishlist.astro`
- Create: `frontend/src/scripts/wishlist-page.ts`

**Interfaces:**
- Consumes: `BaseLayout`, `ProductCard` (prop `product: Product`, already embeds the `[data-wishlist]` heart), `getProducts()`; `$wishlist`.
- Produces: a `/wishlist` page that shows the wishlisted products (as real `ProductCard`s) with an empty state.

- [ ] **Step 1: Create `frontend/src/pages/wishlist.astro`**

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import ProductCard from '../components/product/ProductCard.astro';
import { getProducts } from '../lib/catalog';

const products = await getProducts();
---

<BaseLayout title="Wishlist" noindex={true}>
  <section class="wrap py-16 md:py-24">
    <h1 class="font-display text-display-mobile md:text-display-lg mb-12">Wishlist</h1>

    <div data-wishlist-empty hidden class="py-20 flex flex-col items-center text-center gap-6">
      <p class="text-body-lg text-on-surface-variant">Your wishlist is empty.</p>
      <a href="/objects" class="btn-solid">Browse Objects</a>
    </div>

    <div data-wishlist-grid hidden class="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-12 md:gap-y-16">
      {products.map((p) => (
        <div data-wishlist-card={p.slug} hidden>
          <ProductCard product={p} sizes="(max-width: 768px) 50vw, 33vw" />
        </div>
      ))}
    </div>
  </section>
</BaseLayout>

<script>
  import '../scripts/wishlist-page.ts';
</script>
```

- [ ] **Step 2: Create `frontend/src/scripts/wishlist-page.ts`**

```ts
import { $wishlist } from '../lib/stores';

/**
 * /wishlist page: every product is SSR-rendered as a hidden ProductCard wrapped in
 * [data-wishlist-card="<slug>"]. This island shows only the cards whose slug is in the
 * wishlist store, and toggles the empty state. The heart toggle itself is handled by the
 * global wishlist.ts island (document-delegated [data-wishlist]) — un-hearting a card here
 * mutates $wishlist, which re-runs render() and hides the card.
 */
function init(): void {
  const emptyEl = document.querySelector<HTMLElement>('[data-wishlist-empty]');
  const gridEl = document.querySelector<HTMLElement>('[data-wishlist-grid]');
  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-wishlist-card]'));
  if (!gridEl) return;

  function render(): void {
    const set = new Set($wishlist.get());
    let shown = 0;
    for (const card of cards) {
      const slug = card.getAttribute('data-wishlist-card');
      const on = !!slug && set.has(slug);
      card.hidden = !on;
      if (on) shown++;
    }
    if (emptyEl) emptyEl.hidden = shown > 0;
    if (gridEl) gridEl.hidden = shown === 0;
  }

  $wishlist.subscribe(render);
}

if (document.readyState !== 'loading') {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init);
}
```

- [ ] **Step 3: Typecheck + build**

```
cd "D:/Roots & Rings/frontend"
node node_modules/astro/astro.js check
node node_modules/astro/astro.js build
```
Expected: 0 check errors; build completes and emits a `/wishlist` route.

- [ ] **Step 4: Report changed files** (do NOT commit): `src/pages/wishlist.astro`, `src/scripts/wishlist-page.ts`.

---

### Task 5: Header heart + count badge

**Files:**
- Modify: `frontend/src/components/layout/Header.astro` (add the heart link + badge)
- Modify: `frontend/src/scripts/header.ts` (drive the wishlist badge from `$wishlist`)

**Interfaces:**
- Consumes: `$wishlist` (from `../lib/stores`); the existing `Icon` component (`heart` / `heart-filled` names already used by `WishlistButton`).
- Produces: a header heart linking to `/wishlist` with a live `[data-wishlist-count]` badge.

- [ ] **Step 1: Add the heart link to `frontend/src/components/layout/Header.astro`**

In the "Right: actions" `<div class="justify-self-end …">`, add this anchor **between** the `account` link and the cart `<button data-cart-open …>` (so order is search · account · wishlist · bag):

```astro
      <a href="/wishlist" aria-label="Wishlist" class="relative inline-flex opacity-60 hover:opacity-100 transition-opacity">
        <Icon name="heart" />
        <span
          data-wishlist-count
          style="display:none"
          class="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-[3px] items-center justify-center bg-on-surface text-surface text-[9px] font-semibold leading-none rounded-full"
        >0</span>
      </a>
```
(`Icon` is already imported in this file; reuse the cart badge's exact classes so it matches visually.)

- [ ] **Step 2: Drive the badge in `frontend/src/scripts/header.ts`**

Change the import line to also pull `$wishlist`:
```ts
import { $ui, $cart, $wishlist, cartCount, openCart, closeCart, setMenu } from '../lib/stores';
```
Immediately after the existing cart-badge block (the `$cart.subscribe(renderBadge);` lines), add a wishlist-badge block:
```ts
  // --- live wishlist badge ---
  const wishlistBadge = document.querySelector<HTMLElement>('[data-wishlist-count]');
  const renderWishlistBadge = () => {
    const n = $wishlist.get().length;
    if (!wishlistBadge) return;
    wishlistBadge.textContent = String(n);
    wishlistBadge.style.display = n > 0 ? 'inline-flex' : 'none';
  };
  $wishlist.subscribe(renderWishlistBadge);
```

- [ ] **Step 3: Typecheck + build**

```
cd "D:/Roots & Rings/frontend"
node node_modules/astro/astro.js check
node node_modules/astro/astro.js build
```
Expected: 0 check errors; build completes. (If `astro check` complains that `heart` isn't a valid `Icon` name, STOP and report — `WishlistButton.astro` already uses `name="heart"`, so it should be valid.)

- [ ] **Step 4: Report changed files** (do NOT commit): `src/components/layout/Header.astro`, `src/scripts/header.ts`.

---

### Task 6: Full sweep + browser E2E + memory

**Files:**
- Modify: `C:\Users\PC\.claude\projects\D--Roots---Rings\memory\MEMORY.md` + new `roots-rings-phase7-wishlist.md`

- [ ] **Step 1: Full backend + frontend suites + build**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run
cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js check
cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build
```
Expected: backend 150 passed; frontend 43 passed; 0 check errors; build OK.

- [ ] **Step 2: Browser E2E (controller-run)** — start the backend (`cd backend; node --env-file=.env --import tsx src/server.ts`) and the frontend preview (`cd frontend; node node_modules/astro/astro.js preview`), then with the browser tools verify:
  1. As a **guest**, heart a product on `/objects` → the header heart badge increments → `/wishlist` shows that product; un-hearting it on `/wishlist` removes the card and decrements the badge.
  2. **Sign in** (existing demo customer) with a guest-hearted item present → after load, `GET /api/account/wishlist` (DevTools network) reflects the merged union; an item added server-side (via the API/another session) appears on `/wishlist`.
  3. Remove an item on `/wishlist` while signed in → the `DELETE /api/account/wishlist/:slug` fires and the item stays gone after reload.

- [ ] **Step 3: Update memory** — create `roots-rings-phase7-wishlist.md` (wishlist sync BUILT: `WishlistItem` model; owner-scoped account list/add/remove/merge; client merge-on-login via the 200/401 probe + write-through; `/wishlist` page reusing `ProductCard`; header heart + badge; built uncommitted — user committed) and add a one-line pointer to `MEMORY.md`.

- [ ] **Step 4: Report** the final test counts + the browser-pass result to the controller. **Do NOT commit** — hand the full uncommitted changeset to the user.

---

## Self-Review

**1. Spec coverage** (spec §2–§8 → tasks):
- §3 schema (`WishlistItem` + relations) → Task 1. ✅
- §4 endpoints (list/add/remove/merge, owner-scoped, slug resolution, 404) → Task 2. ✅
- §5 frontend: sync island (merge-on-load 200/401 + write-through) → Task 3; `/wishlist` page → Task 4; header heart + badge → Task 5. ✅
- §6 security (requireCustomer, owner-scoping, unknown-slug ignore/404, swallowed write-through, guest never calls API) → Tasks 2 + 3. ✅
- §7 testing (backend CRUD/merge/owner-scoping/auth; regression; build; browser) → Tasks 2 + 6. ✅
- §8 file structure → matches Tasks 1–5 (note: `schemas.ts` left unchanged — the add/merge zod bodies live inline in `wishlist.ts`, which the spec allowed as "or inline zod"). ✅

**2. Placeholder scan:** every code step contains complete code; every backend test step has real assertions; frontend verification is explicit (`astro check` + `build` + 43 unit tests), with the no-island-unit-test convention stated. No TBD/TODO.

**3. Type consistency:** `registerWishlistRoutes(app)` (Task 2) matches its registration in `routes.ts` (Task 2 Step 4). The endpoints' shapes (GET→`string[]`, merge→`string[]`) match what `wishlist.ts` consumes (Task 3: `await res.json()` as `string[]`). `$wishlist` (string[] atom) is used consistently across Tasks 3/4/5. The upsert where-key `customerId_productId` matches `@@unique([customerId, productId])` (Task 1). `ProductCard` prop `product` (Task 4) matches its definition. The `[data-wishlist-count]` badge (Task 5 Header) matches the `header.ts` selector (Task 5 Step 2). The global `[data-wishlist]` handler (Task 3) owns toggles for the `/wishlist` cards (Task 4) — no second click handler, so no double-toggle. ✅
