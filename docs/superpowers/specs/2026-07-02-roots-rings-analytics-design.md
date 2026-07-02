# Roots & Rings — Phase 13 Design Spec (admin analytics & insights dashboard)

**Date:** 2026-07-02
**Status:** Approved
**Builds on:** Phase 1 (admin panel + eta views + catalog), Phase 2 (orders/`OrderItem`), Phase 12
(`Order.source` channel attribution). Adds an admin analytics dashboard that turns existing order data
into business insights, rendered with lightweight server-side SVG charts.

## 0. Decisions (confirmed)

- **Charts:** server-rendered inline **SVG** — zero dependencies, zero client JavaScript, responsive on
  phone → desktop via `viewBox` + `width:100%`. Static (no hover tooltips), which is fine.
- **Counted orders:** "live" orders only — `status NOT IN (CANCELLED, FAILED, EXPIRED, REFUNDED)`.
  Revenue = `grandTotal`.
- **Time range:** a preset **Daily / Weekly / Monthly** toggle (last 30 days / 12 weeks / 12 months). No
  custom date picker.
- **Timezone:** all time bucketing in **Asia/Dhaka (UTC+6)** via `DATE_ADD(createdAt, INTERVAL 6 HOUR)`
  (BD has no DST → exact; no tz-table dependency).
- **"Lead source" = orders-by-channel.** We only tag *orders* with a `source` (Phase 12), not
  pre-purchase traffic. The channel insight shows orders + revenue split by `Order.source`.

## 1. Goals & non-goals

**Goals:** one admin page that answers — how are sales trending (day/week/month), when do customers order
(peak hour + weekday), what sells best (products / categories / collections), and where orders come from
(channel). Lightweight + responsive on any device.

**Non-goals:** custom date-range picker, CSV/export, real-time or traffic/pixel analytics, a caching
layer, any client JS or chart library, changes to the storefront or the global admin chrome (sidebar/
layout), per-variant analytics, profit/COGS (we only have revenue).

## 2. Data model (no schema change)

All aggregations read existing tables:
- `Order` — `createdAt`, `status`, `source`, `grandTotal`.
- `OrderItem` — `orderId`, `productId` (nullable, no FK), `productName`, `quantity`, `lineTotal`.
- `Product` — `categoryId` (primary category), `collections` (M:N `Category` via `ProductCollections`).
- `Category` — `kind` (`PRODUCT_TYPE` vs `COLLECTION`), `name`.

An `OrderItem` whose `productId` is null or points to a deleted product is bucketed as **"Uncategorized"**
for category/collection insights and keyed by `productName` for the products insight.

## 3. Aggregation service (`modules/analytics/service.ts`)

Pure functions taking `(prisma, period)` (or specific args); each filters to live orders and uses raw SQL
(`prisma.$queryRaw`) for time bucketing + joins. A shared `windowStart(period)` yields the lower bound:
daily → 30 days ago, weekly → 84 days ago, monthly → 365 days ago (all relative to "now" in the query).
Everything below is computed over the selected window unless noted.

1. `getSummary(prisma, period)` → `{ orders: number; revenue: number; aov: number }` — count, `SUM(grandTotal)`,
   and average (guarded: `orders === 0 → aov 0`).
2. `getSalesOverTime(prisma, period)` → `{ label: string; orders: number; revenue: number }[]` — bucketed by
   granularity: daily `DATE(bd)`, weekly `YEARWEEK(bd, 3)`, monthly `DATE_FORMAT(bd, '%Y-%m')`. Ordered
   ascending; missing buckets may be absent (chart tolerates gaps).
3. `getPeakHours(prisma, period)` → `{ hour: 0..23; orders: number }[]` (24 entries, zero-filled) — `HOUR(bd)`.
4. `getPeakWeekdays(prisma, period)` → `{ weekday: 1..7; orders: number }[]` (7 entries, zero-filled) — `DAYOFWEEK(bd)`
   (1 = Sunday). Rendered with weekday names.
5. `getTopProducts(prisma, period, limit = 10)` → `{ name: string; units: number; revenue: number }[]` —
   group `OrderItem` by `COALESCE(productId, productName)`, label by `productName`, `SUM(quantity)` +
   `SUM(lineTotal)`, ordered by revenue desc.
6. `getTopCategories(prisma, period)` → `{ name: string; units: number; revenue: number }[]` — join
   item→`Product.categoryId`→`Category` (kind `PRODUCT_TYPE`); null → "Uncategorized"; ordered by revenue desc.
7. `getTopCollections(prisma, period)` → `{ name: string; units: number; revenue: number }[]` — join
   item→product→`ProductCollections` (M:N, kind `COLLECTION`); a line counts toward each collection its
   product belongs to; products in no collection → "None"; ordered by revenue desc.
8. `getOrdersByChannel(prisma, period)` → `{ source: OrderSource; orders: number; revenue: number }[]` —
   group live `Order` by `source`; all four sources present (zero-filled) so the donut is stable.

`Decimal` money is converted to `number` at the service boundary (raw SQL returns strings/Decimals →
coerce with `Number(...)`). The live-order filter is one shared SQL fragment reused across queries.

## 4. SVG chart helpers (`lib/charts.ts`)

Pure functions returning an SVG string; no DOM, no deps. Each root `<svg>` carries
`viewBox="0 0 W H"`, `preserveAspectRatio="xMidYMid meet"`, and `style="width:100%;height:auto"` so it
fills its card and scales on any device. All text/values are HTML-escaped.

- `barChartSVG(data: { label; value }[], opts)` — vertical bars scaled to `max(value)`; used for peak-hours
  (24) and peak-weekday (7). Includes axis baseline + value-proportional bar heights.
- `lineChartSVG(data: { label; value }[], opts)` — line + soft area fill for revenue-over-time; points
  scaled to the value range; x spread evenly across buckets.
- `hBarChartSVG(data: { label; value; sub? }[], opts)` — horizontal bars with left labels + a trailing
  value; used for top products / categories / collections.
- `donutChartSVG(segments: { label; value; color }[], opts)` — a ring of arc `<path>`s whose sweep angles
  are `value / total * 360°`; used for the channel split, with a legend + % labels.
- **Empty data** (all-zero or `[]`) → each helper returns a small centered "No data yet" SVG.
- A fixed on-brand palette (clay `#875134`, celadon `#3f4a3d`, ink, muted, plus 1–2 accents) is defined
  once and shared; donut segments map Website/Facebook/Instagram/Other to stable colors.

## 5. Admin route + view (`modules/admin/analytics.ts` + `views/analytics.eta`)

- `GET /admin/analytics` (`preHandler: requireAdminSession`) — reads `?period` (`daily`|`weekly`|`monthly`,
  default `daily`; anything else → `daily`), runs the eight service calls, passes plain data +
  pre-rendered SVG strings to `renderPage({ template: 'analytics', title: 'Analytics', active: 'analytics', ... })`.
- `analytics.eta` — a period toggle (three links `?period=…`, active one highlighted), a KPI stat-card row
  (orders / revenue ৳ / AOV), then cards: Sales over time (line), Peak hour (bar) + Peak weekday (bar),
  Top products (hbar), Top categories (hbar) + Top collections (hbar), Orders by channel (donut + legend).
  Cards live in the existing `.row`/`.card` flex system so they stack on narrow screens. A small
  view-scoped `<style>` block adds responsive niceties (full-width cards under a breakpoint) without
  touching global admin CSS.
- `layout.eta` — add `<a href="/admin/analytics" class="… active if active==='analytics'">Analytics</a>`
  to the sidebar nav (after Dashboard).
- Register `registerAdminAnalytics(app)` in `modules/admin/index.ts`.

## 6. Security & correctness

- Admin-only (`requireAdminSession`), read-only (GET, no mutations, no CSRF needed).
- Raw SQL uses parameterized/interval-based bounds and fixed enum/format literals — no user string is
  interpolated into SQL (the only input is `period`, mapped to a fixed set before use).
- All labels/values rendered into SVG are HTML-escaped (product/category/collection names are
  user-authored) to prevent markup injection into the page.
- Money coerced from `Decimal` once at the service boundary; percentages/AOV guard divide-by-zero.
- Live-order filter applied uniformly so cancelled/failed/expired/refunded never inflate revenue.

## 7. Testing

- **`charts.ts`** (unit): bar chart emits N `<rect>` for N data points and bar heights are proportional to
  the max; line chart emits a `<polyline>`/`<path>` with N points; donut emits N arc `<path>`s whose sweep
  sums to ~360°; every helper returns the "No data yet" SVG for empty input; output contains no unescaped
  `<`/`>` from a malicious label.
- **`analytics.service`** (integration, seeded): with mixed orders (varied `source`, `status`, `createdAt`,
  products) — revenue excludes a CANCELLED order; `getOrdersByChannel` counts each source correctly and
  includes all four; `getTopProducts` ranks by revenue; `getTopCategories`/`getTopCollections` group via the
  product join with an "Uncategorized"/"None" bucket; `getPeakHours` places an order created at a known BD
  hour in the right bucket (verifies the +6 offset); `getSummary.aov` = revenue/orders (and 0 when no orders).
- **Route** (`admin.analytics.test.ts`): `GET /admin/analytics` authed → 200 and renders an `<svg>`;
  `?period=weekly` → 200; `?period=garbage` → 200 (defaults to daily); unauthenticated → redirect to login.
- **Regression:** existing 172 backend + 53 frontend stay green.
- **Live:** open `/admin/analytics`, toggle Daily/Weekly/Monthly, confirm the KPIs, the sales line, peak
  hour/weekday bars, top products/categories/collections, and the channel donut all render and scale down
  cleanly on a narrow (phone-width) window.

## 8. File structure

**Backend (new):** `modules/analytics/service.ts`, `lib/charts.ts`, `modules/admin/analytics.ts`,
`modules/admin/views/analytics.eta`; tests `tests/charts.test.ts`, `tests/analytics.service.test.ts`,
`tests/admin.analytics.test.ts`.
**Backend (modified):** `modules/admin/index.ts` (register the route), `modules/admin/views/layout.eta`
(nav link).
**Frontend:** none.

## 9. Rollout

No migration, no new deps, no storefront/global-admin-chrome change. Reads only existing order/product
data. After Phase 13: (candidates) bKash live, order-status emails, i18n, CSV export / date-range picker,
Meilisearch, infra.
