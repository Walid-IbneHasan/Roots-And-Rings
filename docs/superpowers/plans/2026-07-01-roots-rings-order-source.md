# Roots & Rings Phase 12 — Order source + admin manual orders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attribute every order to a channel (`WEBSITE`/`FACEBOOK`/`INSTAGRAM`/`OTHER`), default site orders to `WEBSITE`, and give the admin a form to record manual orders (with source, contact, and correct inventory).

**Architecture:** Additive schema (`OrderSource` enum + `Order.source`, `MANUAL` payment). A `createManualOrder` service reuses the checkout helpers (`priceItems`, `computeTotals`, `reserveForOrder`, `commitReservations`) so stock is decremented like a site order. New admin `GET/POST /admin/orders/new` form + a Source column in the admin.

**Tech Stack:** Fastify 5, Prisma + MySQL 8, zod, eta admin views, Vitest.

## Global Constraints

- **Branch `phase-12-order-source`**, per-task commits (Conventional Commits; end the body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).
- **Ampersand-path gotcha:** project in `D:\Roots & Rings` — `&` breaks `npm run`. Call node directly:
  - Backend tests: `cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run [tests/<file>]`
  - Prisma migrate: `cd "D:/Roots & Rings/backend"; node --env-file=.env node_modules/prisma/build/index.js migrate dev --name <name>`
- **DB `rootsandrings-db` up.** No new deps. No storefront/frontend change.
- **Manual orders:** start in `PROCESSING`, decrement inventory, send **no email**, use a server-generated idempotency key, re-price server-side (never trust client prices), and are admin-only + CSRF-protected. `paid` → `MANUAL` payment `PAID` + `order.paidAt`; else pending.
- Admin auth helpers (already in `admin/orders.ts`): `authed = { preHandler: requireAdminSession }`, `authedWrite = { preHandler: [requireAdminSession, app.csrfProtection] }`. Admin views are eta; render via `renderPage(reply, { template, title, user, active, csrf, data })`. Test helpers: `loginAdmin(app)`, `csrfFrom(app, url, cookie)`, `formPost(app, url, cookie, token, fields)`.

---

### Task 1: Schema — OrderSource + source column + MANUAL payment

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/modules/checkout/service.ts` (`placeOrder` sets `source: 'WEBSITE'`)
- Test: `backend/tests/order-source.test.ts`

**Interfaces:**
- Produces: `OrderSource` enum (`WEBSITE`/`FACEBOOK`/`INSTAGRAM`/`OTHER`); `Order.source` (default `WEBSITE`); `PaymentProviderKind.MANUAL`.

- [ ] **Step 1: Add the enum + field in `backend/prisma/schema.prisma`**

Add a new enum (near `OrderStatus`):
```prisma
enum OrderSource {
  WEBSITE
  FACEBOOK
  INSTAGRAM
  OTHER
}
```
In `model Order`, add the field (after `status`) and an index (in the `@@index` block):
```prisma
  source          OrderSource @default(WEBSITE)
```
```prisma
  @@index([source])
```
In `enum PaymentProviderKind`, add `MANUAL`:
```prisma
enum PaymentProviderKind {
  COD
  BKASH
  MANUAL
}
```

- [ ] **Step 2: Create + apply the migration**

```
cd "D:/Roots & Rings/backend"
node --env-file=.env node_modules/prisma/build/index.js migrate dev --name phase12_order_source
```
Expected: a `…_phase12_order_source` migration created + applied (purely additive — existing orders get `WEBSITE` via the default), and "✔ Generated Prisma Client". If it prompts to RESET, STOP and report — additive columns must not require a reset.

- [ ] **Step 3: Set the source in `placeOrder` — `backend/src/modules/checkout/service.ts`**

In the `tx.order.create({ data: { … } })` inside `placeOrder`, add `source: 'WEBSITE',` (e.g. right after the `status:` line).

- [ ] **Step 4: Write the test — `backend/tests/order-source.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const KEY = 'src-zz-idem';

afterAll(async () => {
  await prisma.order.deleteMany({ where: { idempotencyKey: KEY } });
  await prisma.$disconnect();
});

describe('Order.source', () => {
  it('defaults to WEBSITE when not specified', async () => {
    const o = await prisma.order.create({
      data: {
        orderNumber: 'RR-SRC-ZZ', guestEmail: 'src-zz@test.com', guestPhone: '0', currency: 'BDT',
        subtotal: 100, grandTotal: 100, idempotencyKey: KEY, orderToken: 'src-zz-tok',
        shippingSnapshot: { line1: 'x', city: 'Dhaka', district: 'Dhaka' },
      },
    });
    expect(o.source).toBe('WEBSITE');
  });
});
```

- [ ] **Step 5: Run the test + verify the client is typed**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/order-source.test.ts
```
Expected: PASS.

- [ ] **Step 6: Full-suite checkpoint + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/modules/checkout/service.ts backend/tests/order-source.test.ts
git commit -m "feat(orders): OrderSource enum + Order.source (default WEBSITE) + MANUAL payment"
```
Expected: green (164 prior + source 1 = 165).

---

### Task 2: `createManualOrder` service

**Files:**
- Modify: `backend/src/modules/checkout/service.ts` (add `createManualOrder` + `ManualOrderInput`)
- Test: `backend/tests/manual-order.test.ts`

**Interfaces:**
- Consumes: `priceItems`, `computeTotals`, `round2`, `generateOrderNumber`, `reserveForOrder`, `commitReservations`, `checkLowStock`, `httpError` (all already imported in `service.ts`).
- Produces: `interface ManualOrderInput { items: {slug: string; qty: number}[]; contact: {name; email; phone}; shipping: {line1; line2?; city; district; postalCode?; country?}; source: OrderSource; paid: boolean }`; `createManualOrder(prisma, input): Promise<{ orderNumber: string; orderId: string }>`.

- [ ] **Step 1: Write the failing test — `backend/tests/manual-order.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createManualOrder } from '../src/modules/checkout/service';

const prisma = new PrismaClient();
let slug = '';
let variantId = '';
const SKU = 'RR-MANUAL-ZZ';
const LINKED_EMAIL = 'manual-linked-zz@test.com';

beforeAll(async () => {
  await prisma.orderItem.deleteMany({ where: { sku: 'RR-MANUAL-ZZ-V' } });
  const product = await prisma.product.create({
    data: {
      name: 'Manual ZZ', slug: 'manual-zz', sku: SKU, shortDescription: 'x', description: 'x',
      basePrice: 500, isActive: true,
      variants: { create: [{ sku: 'RR-MANUAL-ZZ-V', name: 'Standard', stock: 10, isActive: true, position: 0 }] },
    },
    include: { variants: true },
  });
  slug = product.slug;
  variantId = product.variants[0].id;
  await prisma.customer.create({ data: { email: LINKED_EMAIL, name: 'Linked', passwordHash: 'x' } });
});
afterAll(async () => {
  await prisma.order.deleteMany({ where: { guestEmail: { in: [LINKED_EMAIL, 'manual-guest-zz@test.com'] } } });
  await prisma.customer.deleteMany({ where: { email: LINKED_EMAIL } });
  await prisma.product.deleteMany({ where: { sku: SKU } });
  await prisma.$disconnect();
});

const base = (over: Partial<Parameters<typeof createManualOrder>[1]> = {}) => ({
  items: [{ slug, qty: 2 }],
  contact: { name: 'Buyer', email: 'manual-guest-zz@test.com', phone: '01700000000' },
  shipping: { line1: '1 Rd', city: 'Dhaka', district: 'Dhaka' },
  source: 'FACEBOOK' as const,
  paid: false,
  ...over,
});

describe('createManualOrder', () => {
  it('creates a FACEBOOK order, decrements stock, pending payment when not paid', async () => {
    const before = (await prisma.productVariant.findUnique({ where: { id: variantId } }))!.stock;
    const { orderId } = await createManualOrder(prisma, base());
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payments: true, items: true } });
    expect(order!.source).toBe('FACEBOOK');
    expect(order!.status).toBe('PROCESSING');
    expect(order!.paidAt).toBeNull();
    expect(order!.payments[0].provider).toBe('MANUAL');
    expect(order!.payments[0].status).toBe('INITIATED');
    const after = (await prisma.productVariant.findUnique({ where: { id: variantId } }))!.stock;
    expect(after).toBe(before - 2);
  });

  it('marks payment PAID + sets paidAt when paid', async () => {
    const { orderId } = await createManualOrder(prisma, base({ paid: true, source: 'INSTAGRAM' }));
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payments: true } });
    expect(order!.source).toBe('INSTAGRAM');
    expect(order!.paidAt).not.toBeNull();
    expect(order!.payments[0].status).toBe('PAID');
  });

  it('links an existing customer by email', async () => {
    const { orderId } = await createManualOrder(prisma, base({ contact: { name: 'Linked', email: LINKED_EMAIL, phone: '01700000000' } }));
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order!.customerId).not.toBeNull();
  });

  it('rejects an empty item list', async () => {
    await expect(createManualOrder(prisma, base({ items: [] }))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/manual-order.test.ts
```
Expected: FAIL (`createManualOrder` not exported).

- [ ] **Step 3: Implement `createManualOrder` in `backend/src/modules/checkout/service.ts`**

Add near the top (with the other type imports) — extend the existing `@prisma/client` import to include `OrderSource`:
```ts
import type { PrismaClient, OrderStatus, OrderSource } from '@prisma/client';
```
Add at the end of the file:
```ts
export interface ManualOrderInput {
  items: { slug: string; qty: number }[];
  contact: { name: string; email: string; phone: string };
  shipping: { line1: string; line2?: string; city: string; district: string; postalCode?: string; country?: string };
  source: OrderSource;
  paid: boolean;
}

/** Admin-recorded order (FB/IG/other): re-prices + decrements stock like a site order; no email/bKash. */
export async function createManualOrder(
  prisma: PrismaClient,
  input: ManualOrderInput,
): Promise<{ orderNumber: string; orderId: string }> {
  if (!input.items.length) throw httpError(400, 'Add at least one product');
  const { lines: resolved } = await priceItems(prisma, input.items);
  if (!resolved.length) throw httpError(400, 'No valid products in the order');
  const totals = computeTotals(resolved.map((r) => ({ unitPrice: r.unitPrice, quantity: r.qty })), 0);

  const email = input.contact.email.toLowerCase();
  const linked = await prisma.customer.findUnique({ where: { email }, select: { id: true } });

  const orderNumber = generateOrderNumber();
  const orderToken = randomBytes(16).toString('hex');
  const idempotencyKey = `manual-${randomBytes(12).toString('hex')}`;
  const tranId = `${orderNumber}-${randomBytes(3).toString('hex')}`;

  const order = await prisma.$transaction(async (tx) => {
    const o = await tx.order.create({
      data: {
        orderNumber,
        customerId: linked?.id ?? null,
        guestEmail: email,
        guestPhone: input.contact.phone,
        status: 'PROCESSING',
        source: input.source,
        currency: 'BDT',
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        shippingTotal: totals.shippingTotal,
        taxTotal: totals.taxTotal,
        grandTotal: totals.grandTotal,
        idempotencyKey,
        orderToken,
        paidAt: input.paid ? new Date() : null,
        shippingSnapshot: { ...input.shipping, name: input.contact.name, phone: input.contact.phone },
        items: {
          create: resolved.map((r) => ({
            productId: r.productId,
            variantId: r.variantId,
            productName: r.productName,
            variantName: r.variantName,
            sku: r.sku,
            unitPrice: r.unitPrice,
            quantity: r.qty,
            lineTotal: round2(r.unitPrice * r.qty),
          })),
        },
      },
    });
    await reserveForOrder(tx, o.id, resolved.map((r) => ({ variantId: r.variantId, quantity: r.qty })));
    await commitReservations(tx, o.id);
    await tx.payment.create({
      data: { orderId: o.id, provider: 'MANUAL', amount: totals.grandTotal, currency: 'BDT', tranId, status: input.paid ? 'PAID' : 'INITIATED' },
    });
    await tx.shipment.create({ data: { orderId: o.id, status: 'PENDING' } });
    return o;
  }, rc);

  for (const r of resolved) await checkLowStock(prisma, r.variantId);
  return { orderNumber: order.orderNumber, orderId: order.id };
}
```

- [ ] **Step 4: Run the test — verify it passes**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/manual-order.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Full-suite checkpoint + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/checkout/service.ts backend/tests/manual-order.test.ts
git commit -m "feat(orders): createManualOrder service (source, inventory, customer-link, paid/pending)"
```
Expected: green (165 + manual 4 = 169).

---

### Task 3: Admin manual-order form + routes

**Files:**
- Create: `backend/src/modules/admin/views/order-new.eta`
- Modify: `backend/src/modules/admin/orders.ts` (GET/POST `/admin/orders/new`)
- Test: `backend/tests/admin.orders-create.test.ts`

**Interfaces:**
- Consumes: `createManualOrder`, `ManualOrderInput` (Task 2); `listProducts` (`catalog/service.ts`); `renderPage`, `getUser`, `requireAdminSession`, `app.csrfProtection`, `blocked`.

- [ ] **Step 1: Create `backend/src/modules/admin/views/order-new.eta`**

```html
<h1>New manual order</h1>
<form class="stack" method="post" action="/admin/orders/new">
  <input type="hidden" name="_csrf" value="<%= it.csrf %>" />

  <div class="grid2">
    <label>Channel / source
      <select name="source">
        <option value="WEBSITE">Website</option>
        <option value="FACEBOOK" selected>Facebook</option>
        <option value="INSTAGRAM">Instagram</option>
        <option value="OTHER">Other</option>
      </select>
    </label>
    <label style="align-self:end"><input type="checkbox" name="paid" value="on" style="width:auto" /> Payment received</label>
  </div>

  <h2>Products</h2>
  <table class="table">
    <thead><tr><th>Product</th><th>Price</th><th>Qty</th></tr></thead>
    <tbody>
      <% it.products.forEach(function (p) { %>
        <tr>
          <td><%= p.name %></td>
          <td class="muted">৳<%= p.price %></td>
          <td><input type="number" name="qty_<%= p.slug %>" min="0" value="0" style="width:70px" /></td>
        </tr>
      <% }) %>
    </tbody>
  </table>

  <h2>Customer</h2>
  <div class="grid2">
    <label>Name <input name="name" required /></label>
    <label>Email <input type="email" name="email" required /></label>
  </div>
  <label>Phone <input name="phone" required /></label>

  <h2>Shipping</h2>
  <label>Address line 1 <input name="line1" required /></label>
  <label>Address line 2 <input name="line2" /></label>
  <div class="grid2">
    <label>City <input name="city" required /></label>
    <label>District <input name="district" required /></label>
  </div>
  <label>Postal code <input name="postalCode" /></label>

  <button class="btn" type="submit">Create order</button>
</form>
```

- [ ] **Step 2: Add the routes in `backend/src/modules/admin/orders.ts`**

Add imports (with the existing imports):
```ts
import { createManualOrder, type ManualOrderInput } from '../checkout/service';
import { listProducts } from '../catalog/service';
```
Inside `registerAdminOrders(app)`, add the two routes (e.g. after the `/admin/orders` list route):
```ts
  app.get('/admin/orders/new', authed, async (req, reply) => {
    const user = getUser(req)!;
    const csrf = reply.generateCsrf();
    const { items: products } = await listProducts(app.prisma, {});
    return renderPage(reply, { template: 'order-new', title: 'New order', user, active: 'orders', csrf, data: { products } });
  });

  app.post('/admin/orders/new', authedWrite, async (req, reply) => {
    const body = req.body as Record<string, string>;
    const source = body.source as ManualOrderInput['source'];
    if (!['WEBSITE', 'FACEBOOK', 'INSTAGRAM', 'OTHER'].includes(source)) return blocked(reply, 'Invalid source.');

    const active = await app.prisma.product.findMany({ where: { isActive: true }, select: { slug: true } });
    const items = active
      .map((p) => ({ slug: p.slug, qty: parseInt(body[`qty_${p.slug}`] || '0', 10) || 0 }))
      .filter((i) => i.qty > 0);
    if (!items.length) return blocked(reply, 'Add at least one product (quantity ≥ 1).');

    const name = (body.name || '').trim();
    const emailAddr = (body.email || '').trim();
    const phone = (body.phone || '').trim();
    const line1 = (body.line1 || '').trim();
    const city = (body.city || '').trim();
    const district = (body.district || '').trim();
    if (!name || !emailAddr || !phone || !line1 || !city || !district) {
      return blocked(reply, 'Name, email, phone, and shipping line1/city/district are required.');
    }

    const input: ManualOrderInput = {
      items,
      contact: { name, email: emailAddr, phone },
      shipping: {
        line1,
        line2: (body.line2 || '').trim() || undefined,
        city,
        district,
        postalCode: (body.postalCode || '').trim() || undefined,
      },
      source,
      paid: body.paid === 'on',
    };
    try {
      const { orderId } = await createManualOrder(app.prisma, input);
      return reply.redirect(`/admin/orders/${orderId}`);
    } catch (e) {
      return blocked(reply, e instanceof Error ? e.message : 'Could not create the order.');
    }
  });
```

- [ ] **Step 3: Write the failing test — `backend/tests/admin.orders-create.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loginAdmin, csrfFrom, formPost } from './helpers';

let app: FastifyInstance;
let cookie: string;
let slug = '';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  cookie = await loginAdmin(app);
  const ps = await app.prisma.product.findMany({ where: { isActive: true }, take: 1, select: { slug: true } });
  slug = ps[0].slug;
});
afterAll(async () => {
  await app.prisma.order.deleteMany({ where: { guestEmail: 'fb-buyer-zz@test.com' } });
  await app.close();
});

describe('admin manual order create', () => {
  it('creates a Facebook order and redirects to its detail', async () => {
    const token = await csrfFrom(app, '/admin/orders/new', cookie);
    const res = await formPost(app, '/admin/orders/new', cookie, token, {
      source: 'FACEBOOK', paid: 'on', [`qty_${slug}`]: '1',
      name: 'FB Buyer', email: 'fb-buyer-zz@test.com', phone: '01711111111',
      line1: '10 Gulshan', city: 'Dhaka', district: 'Dhaka',
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^\/admin\/orders\/.+/);

    const order = await app.prisma.order.findFirst({ where: { guestEmail: 'fb-buyer-zz@test.com' }, include: { payments: true } });
    expect(order).toBeTruthy();
    expect(order!.source).toBe('FACEBOOK');
    expect(order!.payments[0].provider).toBe('MANUAL');
    expect(order!.payments[0].status).toBe('PAID');
  });

  it('rejects a submission with no products', async () => {
    const token = await csrfFrom(app, '/admin/orders/new', cookie);
    const res = await formPost(app, '/admin/orders/new', cookie, token, {
      source: 'OTHER', name: 'X', email: 'noitems-zz@test.com', phone: '01700000000', line1: 'a', city: 'Dhaka', district: 'Dhaka',
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 4: Run it — verify then pass**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/admin.orders-create.test.ts
```
Expected: PASS (2 tests). (Run after Steps 1–2 are in place; if the route 404s, confirm the routes are inside `registerAdminOrders`.)

- [ ] **Step 5: Full-suite checkpoint + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/admin/views/order-new.eta backend/src/modules/admin/orders.ts backend/tests/admin.orders-create.test.ts
git commit -m "feat(admin): manual order create form + route (/admin/orders/new)"
```
Expected: green (169 + create 2 = 171).

---

### Task 4: Admin source display + "New order" button

**Files:**
- Modify: `backend/src/modules/admin/views/orders-list.eta`
- Modify: `backend/src/modules/admin/views/order-detail.eta`

**Interfaces:**
- Consumes: `Order.source` (Task 1). No test (template-only; verified live in Task 5 + the orders list still renders — covered by the existing admin order tests loading `/admin/orders`).

- [ ] **Step 1: Add the Source column + "New order" button in `orders-list.eta`**

Add a "New order" link near the top of the page (before the filter form or the table) — place it at the very top of the template:
```html
<p><a class="btn" href="/admin/orders/new">+ New order</a></p>
```
In the table header row, add a `Source` header (after `Customer`):
```html
  <thead><tr><th>Number</th><th>Date</th><th>Customer</th><th>Source</th><th>Status</th><th>Payment</th><th>Total</th><th></th></tr></thead>
```
In each order row, add the source cell (after the customer `<td>`):
```html
        <td><span class="pill"><%= o.source %></span></td>
```
Update the empty-state `colspan` from `7` to `8` (a Source column was added):
```html
    <% if (!it.orders.length) { %><tr><td colspan="8" class="muted">No orders yet.</td></tr><% } %>
```

- [ ] **Step 2: Show the source in `order-detail.eta`**

Add a line where the order meta is shown (near the status/date). Add:
```html
<p class="muted">Source: <strong><%= it.order.source %></strong></p>
```
(Place it near the existing order-number/status header in the template; read the file to find the right spot.)

- [ ] **Step 3: Verify the admin order pages still render + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/admin.orders.test.ts
```
Expected: PASS (the existing admin orders test loads `/admin/orders` + a detail page; the template still renders with the new column/line — `o.source`/`order.source` exist after Task 1).
```
git add backend/src/modules/admin/views/orders-list.eta backend/src/modules/admin/views/order-detail.eta
git commit -m "feat(admin): show order source (list column + detail) + New order button"
```

---

### Task 5: Verification sweep + memory

**Files:**
- Modify: `C:\Users\PC\.claude\projects\D--Roots---Rings\memory\MEMORY.md` + new `roots-rings-phase12-order-source.md`

- [ ] **Step 1: Full backend suite**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
```
Expected: green (171). (Frontend is unchanged this phase — still 53.)

- [ ] **Step 2: Live verification (controller-run)** — start the backend + open the admin (`/admin`, `admin@rootsandrings.example` / `ChangeMe123!`):
  1. `/admin/orders/new` renders the product qty list + source dropdown + payment checkbox.
  2. Create a manual **Facebook** order (qty 1 on a product, contact + shipping, "Payment received" on) → redirects to the order detail showing **Source: FACEBOOK** + a **MANUAL / PAID** payment.
  3. `/admin/orders` shows the new order with a **Source** badge; the ordered product's variant stock dropped.
  4. A normal storefront checkout still records **Source: WEBSITE**.

- [ ] **Step 3: Update memory** — create `roots-rings-phase12-order-source.md` (OrderSource enum + Order.source default WEBSITE + MANUAL payment; placeOrder tags WEBSITE; createManualOrder reuses priceItems/inventory, auto-links customer by email, paid→PAID/paidAt else pending, no email; admin /admin/orders/new form + Source column) + a one-line pointer in `MEMORY.md`.

- [ ] **Step 4: Report** the final counts + the live-verification results.

---

## Self-Review

**1. Spec coverage** (spec §2–§7 → tasks):
- §2 schema (OrderSource + Order.source + index + MANUAL) → Task 1. ✅
- §3 site orders (placeOrder WEBSITE) → Task 1; admin display (list column + detail + New-order button) → Task 4. ✅
- §4 createManualOrder (reuse pricing/inventory, customer link, paid/pending, no email) → Task 2. ✅
- §5 admin form + routes (GET/POST /admin/orders/new) → Task 3. ✅
- §6 security (server re-price, inventory path, admin-only + CSRF, source validated, server idempotency key) → Tasks 2, 3. ✅
- §7 testing (createManualOrder cases; placeOrder WEBSITE; admin route integration; regression; live) → Tasks 1, 2, 3, 5. ✅
- §8 file structure → matches Tasks 1–4 (note: the manual-order input is a typed `ManualOrderInput` interface + route-level form parsing/validation rather than a single zod body, because the form has dynamic per-product qty fields — the spec's "zod body" intent is met by the route's validation + `priceItems` server-side re-pricing). ✅

**2. Placeholder scan:** every code step has complete code; every test step has real assertions; the live checks are concrete. No TBD/TODO.

**3. Type consistency:** `ManualOrderInput` (Task 2) is imported + built identically by the admin route (Task 3). `createManualOrder(prisma, input): Promise<{orderNumber, orderId}>` — the route uses `orderId` for the redirect; the tests read it. `OrderSource` values (`WEBSITE`/`FACEBOOK`/`INSTAGRAM`/`OTHER`) are consistent across the enum (Task 1), the service (Task 2), the route validation + the form `<select>` (Task 3), and the display (Task 4). `Order.source` (Task 1) is read by the list/detail templates (Task 4) and set by `placeOrder` + `createManualOrder`. `MANUAL` payment provider (Task 1) is used by `createManualOrder` (Task 2) and asserted in the tests. `listProducts(app.prisma, {})` returns `{ items }` used by the form (Task 3). ✅
