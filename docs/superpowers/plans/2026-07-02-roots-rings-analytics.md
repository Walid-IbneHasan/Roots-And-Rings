# Roots & Rings Phase 13 — Admin analytics & insights dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin `/admin/analytics` page that turns existing order data into insights (sales trend, peak time, top products/categories/collections, orders-by-channel) using lightweight server-rendered SVG charts.

**Architecture:** A pure `analytics` service aggregates orders (Prisma `aggregate`/`groupBy` for order-level; raw SQL with a `+6h` Dhaka offset for time-bucketed queries; Prisma for item→product→category/collection joins). A `lib/charts.ts` module of pure functions turns data into responsive SVG strings (`viewBox` + `width:100%`). A single admin route renders them into an eta view. No schema change, no new deps, no client JS, no storefront change.

**Tech Stack:** Fastify 5, Prisma + MySQL 8, eta admin views, Vitest, TypeScript.

## Global Constraints

- **Branch `phase-13-analytics`** (base `main` @ `4727a44`), per-task commits — Conventional Commits, body ending with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Ampersand-path gotcha:** project in `D:\Roots & Rings` — `&` breaks `npm run`. Call node directly:
  - Tests: `cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run [tests/<file>]`
- **DB `rootsandrings-db` up.** No new deps. No schema/migration. No frontend/storefront change. No change to the global admin chrome (`layout.eta`) beyond adding one nav link.
- **Counted orders = live:** `status NOT IN (CANCELLED, FAILED, EXPIRED, REFUNDED)`. Revenue = `grandTotal`.
- **Timezone:** time buckets computed on `DATE_ADD(createdAt, INTERVAL 6 HOUR)` (Asia/Dhaka, no DST).
- **Windows:** daily → last 30 days, weekly → last 84 days (12 weeks), monthly → last 365 days (12 months). ALL insights recompute over the selected window; only the sales-over-time granularity changes.
- **Charts are raw SVG** emitted with eta's **raw** tag `<%~ ... %>` (NOT `<%= %>`, which would HTML-escape the markup). This is safe because `charts.ts` internally HTML-escapes every user-authored label/value via its `esc()` helper before embedding — so raw SVG markup renders while data stays escaped.
- **Tests:** `vitest.config.ts` has `fileParallelism: false` (files run sequentially) — so DB-aggregate tests use a **snapshot-before → seed → snapshot-after → assert deltas** pattern to stay robust against the pre-existing order data in the shared dev DB. Run the full suite before each commit (no dev server running → no job-worker races).
- **Admin route pattern** (mirror `dashboard.ts`): `app.get(url, { preHandler: requireAdminSession }, ...)`, `const user = getUser(req)!`, `renderPage(reply, { template, title, user, active, csrf, data })`. `getUser`/`requireAdminSession` from `./guards`; `renderPage` from `../../lib/render`.

---

### Task 1: `lib/charts.ts` — pure SVG chart generators

**Files:**
- Create: `backend/src/lib/charts.ts`
- Test: `backend/tests/charts.test.ts`

**Interfaces:**
- Produces: `Datum { label: string; value: number; sub?: string }`; `Segment { label: string; value: number; color: string }`; `Period`-independent pure fns:
  - `barChartSVG(data: Datum[], opts?: { width?; height?; color?; labelEvery? }): string`
  - `lineChartSVG(data: Datum[], opts?: { width?; height?; color? }): string`
  - `hBarChartSVG(data: Datum[], opts?: { width?; rowHeight?; color? }): string`
  - `donutChartSVG(segments: Segment[], opts?: { size? }): string`
  - `CHANNEL_COLORS: Record<string, string>`

- [ ] **Step 1: Write the failing test — `backend/tests/charts.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { barChartSVG, lineChartSVG, hBarChartSVG, donutChartSVG, CHANNEL_COLORS } from '../src/lib/charts';

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe('charts.ts', () => {
  it('barChartSVG: one <rect> per datum, taller bar for larger value, has viewBox', () => {
    const svg = barChartSVG([{ label: 'a', value: 1 }, { label: 'b', value: 4 }]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0');
    expect(count(svg, /<rect\b/g)).toBe(2);
    const heights = [...svg.matchAll(/height="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...heights)).toBeGreaterThan(Math.min(...heights));
  });

  it('lineChartSVG: emits a polyline with one point per datum', () => {
    const svg = lineChartSVG([{ label: 'a', value: 2 }, { label: 'b', value: 5 }, { label: 'c', value: 3 }]);
    const poly = svg.match(/<polyline points="([^"]+)"/);
    expect(poly).toBeTruthy();
    expect(poly![1].trim().split(/\s+/).length).toBe(3);
  });

  it('hBarChartSVG: one bar <rect> per datum and shows the sub label', () => {
    const svg = hBarChartSVG([{ label: 'Bowl', value: 300, sub: '৳300' }, { label: 'Mug', value: 100, sub: '৳100' }]);
    expect(count(svg, /<rect\b/g)).toBe(2);
    expect(svg).toContain('৳300');
  });

  it('donutChartSVG: one arc <path> per nonzero segment', () => {
    const svg = donutChartSVG([
      { label: 'A', value: 3, color: '#111' },
      { label: 'B', value: 1, color: '#222' },
      { label: 'C', value: 0, color: '#333' },
    ]);
    expect(count(svg, /<path\b/g)).toBe(2);
  });

  it('donutChartSVG: a single 100% segment renders a full ring (circle)', () => {
    const svg = donutChartSVG([{ label: 'only', value: 5, color: '#111' }]);
    expect(svg).toContain('<circle');
  });

  it('empty / all-zero data renders a "No data yet" placeholder for every chart', () => {
    for (const svg of [barChartSVG([]), lineChartSVG([{ label: 'x', value: 0 }]), hBarChartSVG([]), donutChartSVG([])]) {
      expect(svg).toContain('No data yet');
    }
  });

  it('escapes markup in labels (no raw < from a malicious label)', () => {
    const svg = hBarChartSVG([{ label: '<script>x</script>', value: 5 }]);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('exposes stable channel colors', () => {
    expect(CHANNEL_COLORS.WEBSITE).toBeTruthy();
    expect(CHANNEL_COLORS.FACEBOOK).toBeTruthy();
    expect(CHANNEL_COLORS.INSTAGRAM).toBeTruthy();
    expect(CHANNEL_COLORS.OTHER).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

`cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/charts.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `backend/src/lib/charts.ts`**

```ts
// Pure server-side SVG chart generators. No deps, no DOM. Each returns an SVG
// string sized by viewBox so it scales to its container on any device. All
// user-authored labels/values are HTML-escaped via esc() before embedding, so
// the SVG can be emitted with eta's raw tag (<%~ %>) safely.

export interface Datum { label: string; value: number; sub?: string; }
export interface Segment { label: string; value: number; color: string; }

const C = {
  ink: '#1d1c17', clay: '#875134', celadon: '#3f4a3d', muted: '#4d4540',
  line: 'rgba(140,131,120,.3)', bar: '#875134', clayFill: '#875134',
};

export const CHANNEL_COLORS: Record<string, string> = {
  WEBSITE: '#875134', FACEBOOK: '#3b5998', INSTAGRAM: '#c13584', OTHER: '#7a736b',
};

function esc(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const FONT = 'font-family:Inter,system-ui,sans-serif';
function open(w: number, h: number, extra = ''): string {
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" style="width:100%;height:auto;${extra}${FONT}">`;
}
function empty(w: number, h: number): string {
  return open(w, h) + `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="${C.muted}" font-size="13">No data yet</text></svg>`;
}

export function barChartSVG(data: Datum[], opts: { width?: number; height?: number; color?: string; labelEvery?: number } = {}): string {
  const W = opts.width ?? 640, H = opts.height ?? 240;
  if (!data.length || data.every((d) => d.value <= 0)) return empty(W, H);
  const color = opts.color ?? C.bar;
  const padL = 8, padR = 8, padT = 12, padB = 34;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const max = Math.max(...data.map((d) => d.value), 1);
  const n = data.length, slot = chartW / n, barW = Math.max(2, slot * 0.62);
  const every = opts.labelEvery ?? (n > 16 ? Math.ceil(n / 12) : 1);
  const baseY = padT + chartH;
  let body = `<line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="${C.line}"/>`;
  data.forEach((d, i) => {
    const bh = (d.value / max) * chartH;
    const x = padL + i * slot + (slot - barW) / 2, y = baseY - bh;
    body += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}" rx="1"><title>${esc(d.label)}: ${esc(d.value)}</title></rect>`;
    if (i % every === 0) body += `<text x="${(padL + i * slot + slot / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="10" fill="${C.muted}">${esc(d.label)}</text>`;
  });
  return open(W, H) + body + '</svg>';
}

export function lineChartSVG(data: Datum[], opts: { width?: number; height?: number; color?: string } = {}): string {
  const W = opts.width ?? 640, H = opts.height ?? 240;
  if (!data.length || data.every((d) => d.value <= 0)) return empty(W, H);
  const color = opts.color ?? C.clay;
  const padL = 10, padR = 10, padT = 14, padB = 34;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const max = Math.max(...data.map((d) => d.value), 1), n = data.length;
  const xAt = (i: number) => (n === 1 ? padL + chartW / 2 : padL + (i / (n - 1)) * chartW);
  const yAt = (v: number) => padT + chartH - (v / max) * chartH;
  const pts = data.map((d, i) => `${xAt(i).toFixed(1)},${yAt(d.value).toFixed(1)}`).join(' ');
  const baseY = padT + chartH;
  const area = `${padL},${baseY} ${pts} ${(padL + chartW).toFixed(1)},${baseY}`;
  const every = n > 12 ? Math.ceil(n / 8) : 1;
  let body = `<line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="${C.line}"/>`;
  body += `<polygon points="${area}" fill="${color}" opacity="0.08"/>`;
  body += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/>`;
  data.forEach((d, i) => {
    body += `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(d.value).toFixed(1)}" r="2.5" fill="${color}"><title>${esc(d.label)}: ${esc(d.value)}</title></circle>`;
    if (i % every === 0) body += `<text x="${xAt(i).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="10" fill="${C.muted}">${esc(d.label)}</text>`;
  });
  return open(W, H) + body + '</svg>';
}

export function hBarChartSVG(data: Datum[], opts: { width?: number; rowHeight?: number; color?: string } = {}): string {
  const W = opts.width ?? 640, rowH = opts.rowHeight ?? 30;
  if (!data.length || data.every((d) => d.value <= 0)) return empty(W, 120);
  const color = opts.color ?? C.celadon;
  const H = data.length * rowH + 10;
  const labelW = 150, padR = 74, gap = 8, barMaxW = W - labelW - padR;
  const max = Math.max(...data.map((d) => d.value), 1);
  let body = '';
  data.forEach((d, i) => {
    const y = 6 + i * rowH;
    const bw = Math.max(1, (d.value / max) * barMaxW);
    const label = d.label.length > 22 ? d.label.slice(0, 21) + '…' : d.label;
    body += `<text x="${labelW - gap}" y="${y + rowH / 2 - 3}" text-anchor="end" font-size="11" fill="${C.ink}">${esc(label)}</text>`;
    body += `<rect x="${labelW}" y="${y}" width="${bw.toFixed(1)}" height="${rowH - 12}" fill="${color}" rx="1"/>`;
    body += `<text x="${(labelW + bw + gap).toFixed(1)}" y="${y + rowH / 2 - 3}" font-size="11" fill="${C.muted}">${esc(d.sub ?? d.value)}</text>`;
  });
  return open(W, H) + body + '</svg>';
}

export function donutChartSVG(segments: Segment[], opts: { size?: number } = {}): string {
  const size = opts.size ?? 240;
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return empty(size, size);
  const cx = size / 2, cy = size / 2, r = size / 2 - 10, inner = r * 0.58;
  let a0 = -Math.PI / 2, body = '';
  for (const seg of segments) {
    if (seg.value <= 0) continue;
    const frac = seg.value / total;
    if (frac >= 0.999999) {
      body += `<circle cx="${cx}" cy="${cy}" r="${((r + inner) / 2).toFixed(2)}" fill="none" stroke="${seg.color}" stroke-width="${(r - inner).toFixed(2)}"><title>${esc(seg.label)}: ${esc(seg.value)} (100%)</title></circle>`;
      continue;
    }
    const a1 = a0 + frac * Math.PI * 2, large = frac > 0.5 ? 1 : 0;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const xi1 = cx + inner * Math.cos(a1), yi1 = cy + inner * Math.sin(a1);
    const xi0 = cx + inner * Math.cos(a0), yi0 = cy + inner * Math.sin(a0);
    body += `<path d="M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${xi1.toFixed(2)} ${yi1.toFixed(2)} A ${inner.toFixed(2)} ${inner.toFixed(2)} 0 ${large} 0 ${xi0.toFixed(2)} ${yi0.toFixed(2)} Z" fill="${seg.color}"><title>${esc(seg.label)}: ${esc(seg.value)} (${Math.round(frac * 100)}%)</title></path>`;
    a0 = a1;
  }
  return open(size, size, `max-width:${size}px;`) + body + '</svg>';
}
```

- [ ] **Step 4: Run the test — verify it passes**

`cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/charts.test.ts` → PASS (8 tests).

- [ ] **Step 5: Full suite + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/src/lib/charts.ts backend/tests/charts.test.ts
git commit -m "feat(analytics): pure server-side SVG chart generators (bar/line/hbar/donut)"
```
Expected: green (172 prior + 8 = 180).

---

### Task 2: `analytics/service.ts` — order-level aggregations

**Files:**
- Create: `backend/src/modules/analytics/service.ts`
- Test: `backend/tests/analytics.orders.test.ts`

**Interfaces:**
- Produces: `type Period = 'daily' | 'weekly' | 'monthly'`; `windowStart(period: Period, now?: Date): Date`;
  - `getSummary(prisma, period): Promise<{ orders: number; revenue: number; aov: number }>`
  - `getSalesOverTime(prisma, period): Promise<{ label: string; orders: number; revenue: number }[]>`
  - `getPeakHours(prisma, period): Promise<{ hour: number; orders: number }[]>` (24, zero-filled, hour 0..23)
  - `getPeakWeekdays(prisma, period): Promise<{ weekday: number; orders: number }[]>` (7, zero-filled, weekday 1..7 = Sun..Sat)
  - `getOrdersByChannel(prisma, period): Promise<{ source: string; orders: number; revenue: number }[]>` (4, WEBSITE/FACEBOOK/INSTAGRAM/OTHER)

- [ ] **Step 1: Write the failing test — `backend/tests/analytics.orders.test.ts`**

Uses snapshot-before → seed → snapshot-after → assert deltas (robust to existing DB rows; safe because `fileParallelism:false`).

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getSummary, getOrdersByChannel, getPeakHours, getPeakWeekdays, getSalesOverTime, windowStart } from '../src/modules/analytics/service';

const prisma = new PrismaClient();
const TAG = 'an-ord';
let seq = 0;

// A fixed instant 3 days ago at 03:00 UTC => 09:00 Asia/Dhaka (+6) => hour 9.
const base = new Date(); base.setUTCDate(base.getUTCDate() - 3); base.setUTCHours(3, 0, 0, 0);
const BD_HOUR = 9;
const BD_WEEKDAY = new Date(base.getTime() + 6 * 3600 * 1000).getUTCDay() + 1; // 1..7 (Sun..Sat)

async function mkOrder(over: { source?: string; status?: string; grandTotal?: number; createdAt?: Date } = {}) {
  seq++;
  return prisma.order.create({
    data: {
      orderNumber: `RR-${TAG}-${seq}`, guestEmail: `${TAG}-${seq}@test.com`, guestPhone: '0', currency: 'BDT',
      subtotal: over.grandTotal ?? 100, grandTotal: over.grandTotal ?? 100,
      idempotencyKey: `${TAG}-${seq}`, orderToken: `${TAG}tok-${seq}`,
      shippingSnapshot: { line1: 'x', city: 'Dhaka', district: 'Dhaka' },
      status: (over.status ?? 'PROCESSING') as any, source: (over.source ?? 'WEBSITE') as any,
      createdAt: over.createdAt ?? base,
    },
  });
}

const sumRev = (arr: { revenue: number }[]) => arr.reduce((s, x) => s + x.revenue, 0);
const chan = (arr: { source: string; orders: number }[], s: string) => arr.find((x) => x.source === s)!.orders;

let before: Awaited<ReturnType<typeof snapshot>>;
async function snapshot() {
  return {
    summary: await getSummary(prisma, 'daily'),
    channel: await getOrdersByChannel(prisma, 'daily'),
    hours: await getPeakHours(prisma, 'daily'),
    weekdays: await getPeakWeekdays(prisma, 'daily'),
    salesRev: sumRev(await getSalesOverTime(prisma, 'daily')),
  };
}

beforeAll(async () => {
  await prisma.order.deleteMany({ where: { guestEmail: { startsWith: `${TAG}-` } } });
  before = await snapshot();
  await mkOrder({ source: 'WEBSITE', status: 'PROCESSING', grandTotal: 500 });
  await mkOrder({ source: 'FACEBOOK', status: 'DELIVERED', grandTotal: 300 });
  await mkOrder({ source: 'FACEBOOK', status: 'PAID', grandTotal: 200 });
  await mkOrder({ source: 'INSTAGRAM', status: 'PROCESSING', grandTotal: 150 });
  await mkOrder({ source: 'WEBSITE', status: 'CANCELLED', grandTotal: 9999 }); // excluded from all
});
afterAll(async () => {
  await prisma.order.deleteMany({ where: { guestEmail: { startsWith: `${TAG}-` } } });
  await prisma.$disconnect();
});

describe('analytics order-level aggregations', () => {
  it('windowStart is earlier for a longer period', () => {
    const now = new Date('2026-07-02T00:00:00Z');
    expect(windowStart('monthly', now).getTime()).toBeLessThan(windowStart('weekly', now).getTime());
    expect(windowStart('weekly', now).getTime()).toBeLessThan(windowStart('daily', now).getTime());
  });

  it('getSummary counts 4 live orders and ৳1150 revenue (cancelled excluded)', async () => {
    const after = await snapshot();
    expect(after.summary.orders - before.summary.orders).toBe(4);
    expect(after.summary.revenue - before.summary.revenue).toBeCloseTo(1150, 2);
    expect(after.summary.aov).toBeGreaterThan(0);
  });

  it('getOrdersByChannel: all 4 sources present; deltas per channel exclude the cancelled WEBSITE order', async () => {
    const after = await snapshot();
    expect(after.channel.map((c) => c.source).sort()).toEqual(['FACEBOOK', 'INSTAGRAM', 'OTHER', 'WEBSITE']);
    expect(chan(after.channel, 'FACEBOOK') - chan(before.channel, 'FACEBOOK')).toBe(2);
    expect(chan(after.channel, 'WEBSITE') - chan(before.channel, 'WEBSITE')).toBe(1); // cancelled one excluded
    expect(chan(after.channel, 'INSTAGRAM') - chan(before.channel, 'INSTAGRAM')).toBe(1);
  });

  it('getPeakHours: 24 buckets; the +6h offset places the seeded orders in hour 9', async () => {
    const after = await snapshot();
    expect(after.hours.length).toBe(24);
    const d = after.hours[BD_HOUR].orders - before.hours[BD_HOUR].orders;
    expect(d).toBe(4); // all 4 live seeded orders share the same instant
  });

  it('getPeakWeekdays: 7 buckets; seeded orders land on the expected Dhaka weekday', async () => {
    const after = await snapshot();
    expect(after.weekdays.length).toBe(7);
    const d = after.weekdays[BD_WEEKDAY - 1].orders - before.weekdays[BD_WEEKDAY - 1].orders;
    expect(d).toBe(4);
  });

  it('getSalesOverTime: total revenue across buckets rises by ৳1150', async () => {
    const after = await snapshot();
    expect(after.salesRev - before.salesRev).toBeCloseTo(1150, 0);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

`cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/analytics.orders.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `backend/src/modules/analytics/service.ts`**

```ts
import type { PrismaClient } from '@prisma/client';

export type Period = 'daily' | 'weekly' | 'monthly';

const WINDOW_DAYS: Record<Period, number> = { daily: 30, weekly: 84, monthly: 365 };

export function windowStart(period: Period, now: Date = new Date()): Date {
  return new Date(now.getTime() - WINDOW_DAYS[period] * 24 * 60 * 60 * 1000);
}

// Live orders only (Prisma where fragment + raw-SQL fragment kept in sync).
const LIVE_STATUSES = ['CANCELLED', 'FAILED', 'EXPIRED', 'REFUNDED'];
const LIVE_WHERE = { status: { notIn: LIVE_STATUSES as any } };
const LIVE_SQL = "status NOT IN ('CANCELLED','FAILED','EXPIRED','REFUNDED')";
const BD = 'DATE_ADD(createdAt, INTERVAL 6 HOUR)'; // Asia/Dhaka, no DST

export async function getSummary(prisma: PrismaClient, period: Period) {
  const agg = await prisma.order.aggregate({
    where: { ...LIVE_WHERE, createdAt: { gte: windowStart(period) } },
    _count: { _all: true },
    _sum: { grandTotal: true },
  });
  const orders = agg._count._all;
  const revenue = Number(agg._sum.grandTotal ?? 0);
  return { orders, revenue, aov: orders ? revenue / orders : 0 };
}

export async function getOrdersByChannel(prisma: PrismaClient, period: Period) {
  const rows = await prisma.order.groupBy({
    by: ['source'],
    where: { ...LIVE_WHERE, createdAt: { gte: windowStart(period) } },
    _count: { _all: true },
    _sum: { grandTotal: true },
  });
  const by = new Map(rows.map((r) => [r.source as string, { orders: r._count._all, revenue: Number(r._sum.grandTotal ?? 0) }]));
  return (['WEBSITE', 'FACEBOOK', 'INSTAGRAM', 'OTHER'] as const).map((source) => ({
    source, orders: by.get(source)?.orders ?? 0, revenue: by.get(source)?.revenue ?? 0,
  }));
}

export async function getSalesOverTime(prisma: PrismaClient, period: Period) {
  const start = windowStart(period);
  let sql: string;
  if (period === 'daily') {
    sql = "SELECT DATE_FORMAT(" + BD + ", '%b %e') AS label, COUNT(*) AS orders, COALESCE(SUM(grandTotal),0) AS revenue "
      + "FROM `Order` WHERE " + LIVE_SQL + " AND createdAt >= ? "
      + "GROUP BY DATE(" + BD + ") ORDER BY DATE(" + BD + ") ASC";
  } else if (period === 'weekly') {
    sql = "SELECT DATE_FORMAT(MIN(" + BD + "), '%b %e') AS label, COUNT(*) AS orders, COALESCE(SUM(grandTotal),0) AS revenue "
      + "FROM `Order` WHERE " + LIVE_SQL + " AND createdAt >= ? "
      + "GROUP BY YEARWEEK(" + BD + ", 3) ORDER BY MIN(" + BD + ") ASC";
  } else {
    sql = "SELECT DATE_FORMAT(" + BD + ", '%b %Y') AS label, COUNT(*) AS orders, COALESCE(SUM(grandTotal),0) AS revenue "
      + "FROM `Order` WHERE " + LIVE_SQL + " AND createdAt >= ? "
      + "GROUP BY DATE_FORMAT(" + BD + ", '%Y-%m') ORDER BY MIN(" + BD + ") ASC";
  }
  const rows = await prisma.$queryRawUnsafe<{ label: string; orders: bigint; revenue: string }[]>(sql, start);
  return rows.map((r) => ({ label: r.label, orders: Number(r.orders), revenue: Number(r.revenue) }));
}

export async function getPeakHours(prisma: PrismaClient, period: Period) {
  const rows = await prisma.$queryRawUnsafe<{ hour: number; orders: bigint }[]>(
    "SELECT HOUR(" + BD + ") AS hour, COUNT(*) AS orders FROM `Order` "
    + "WHERE " + LIVE_SQL + " AND createdAt >= ? GROUP BY hour ORDER BY hour",
    windowStart(period),
  );
  const map = new Map(rows.map((r) => [Number(r.hour), Number(r.orders)]));
  return Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: map.get(h) ?? 0 }));
}

export async function getPeakWeekdays(prisma: PrismaClient, period: Period) {
  const rows = await prisma.$queryRawUnsafe<{ weekday: number; orders: bigint }[]>(
    "SELECT DAYOFWEEK(" + BD + ") AS weekday, COUNT(*) AS orders FROM `Order` "
    + "WHERE " + LIVE_SQL + " AND createdAt >= ? GROUP BY weekday ORDER BY weekday",
    windowStart(period),
  );
  const map = new Map(rows.map((r) => [Number(r.weekday), Number(r.orders)]));
  return Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, orders: map.get(i + 1) ?? 0 }));
}
```

- [ ] **Step 4: Run the test — verify it passes**

`cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/analytics.orders.test.ts` → PASS (6 tests). If `getPeakWeekdays` mismatches by one, re-check the `DAYOFWEEK` (1=Sun) vs the test's `getUTCDay()+1` mapping — both must be 1=Sun..7=Sat (they are; do not "fix" by shifting).

- [ ] **Step 5: Full suite + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/analytics/service.ts backend/tests/analytics.orders.test.ts
git commit -m "feat(analytics): order-level aggregations (summary, sales-over-time, peak hour/weekday, channel)"
```
Expected: green (180 + 6 = 186).

---

### Task 3: `analytics/service.ts` — item-level aggregations (products / categories / collections)

**Files:**
- Modify: `backend/src/modules/analytics/service.ts` (append 3 functions + a private helper)
- Test: `backend/tests/analytics.items.test.ts`

**Interfaces:**
- Consumes: `windowStart`, `LIVE_WHERE`, `Period` (Task 2).
- Produces:
  - `getTopProducts(prisma, period, limit?): Promise<{ name: string; units: number; revenue: number }[]>` (default limit 10, revenue desc)
  - `getTopCategories(prisma, period): Promise<{ name: string; units: number; revenue: number }[]>` (revenue desc; no-category → "Uncategorized")
  - `getTopCollections(prisma, period): Promise<{ name: string; units: number; revenue: number }[]>` (revenue desc; a line counts toward each collection its product is in; none → "None")

- [ ] **Step 1: Write the failing test — `backend/tests/analytics.items.test.ts`**

Seeds a product with a known category + collection, an order with items, and asserts deltas.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getTopProducts, getTopCategories, getTopCollections } from '../src/modules/analytics/service';

const prisma = new PrismaClient();
const TAG = 'an-item';
let productId = '', categoryName = '', collectionName = '', orderId = '';

const findByName = (arr: { name: string; revenue: number; units: number }[], name: string) => arr.find((x) => x.name === name);

beforeAll(async () => {
  await prisma.orderItem.deleteMany({ where: { sku: `${TAG}-SKU` } });
  await prisma.order.deleteMany({ where: { guestEmail: `${TAG}@test.com` } });
  await prisma.product.deleteMany({ where: { sku: `${TAG}-PSKU` } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });

  const cat = await prisma.category.create({ data: { kind: 'PRODUCT_TYPE', name: `${TAG} Vases`, slug: `${TAG}-vases` } });
  const coll = await prisma.category.create({ data: { kind: 'COLLECTION', name: `${TAG} Spring`, slug: `${TAG}-spring` } });
  categoryName = cat.name; collectionName = coll.name;
  const product = await prisma.product.create({
    data: {
      name: `${TAG} Bowl`, slug: `${TAG}-bowl`, sku: `${TAG}-PSKU`, shortDescription: 'x', description: 'x',
      basePrice: 250, isActive: true, categoryId: cat.id, collections: { connect: [{ id: coll.id }] },
    },
  });
  productId = product.id;
  const order = await prisma.order.create({
    data: {
      orderNumber: `RR-${TAG}-1`, guestEmail: `${TAG}@test.com`, guestPhone: '0', currency: 'BDT',
      subtotal: 500, grandTotal: 500, idempotencyKey: `${TAG}-1`, orderToken: `${TAG}tok-1`,
      shippingSnapshot: { line1: 'x', city: 'Dhaka', district: 'Dhaka' }, status: 'PROCESSING', source: 'WEBSITE',
      items: { create: [{ productId, productName: `${TAG} Bowl`, sku: `${TAG}-SKU`, unitPrice: 250, quantity: 2, lineTotal: 500 }] },
    },
  });
  orderId = order.id;
});
afterAll(async () => {
  await prisma.orderItem.deleteMany({ where: { sku: `${TAG}-SKU` } });
  await prisma.order.deleteMany({ where: { guestEmail: `${TAG}@test.com` } });
  await prisma.product.deleteMany({ where: { sku: `${TAG}-PSKU` } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
  await prisma.$disconnect();
});

describe('analytics item-level aggregations', () => {
  it('getTopProducts includes the seeded product with 2 units / ৳500', async () => {
    const rows = await getTopProducts(prisma, 'daily', 100);
    const p = findByName(rows, `${TAG} Bowl`);
    expect(p).toBeTruthy();
    expect(p!.units).toBe(2);
    expect(p!.revenue).toBeCloseTo(500, 2);
  });

  it('getTopCategories attributes the line to the product primary category', async () => {
    const rows = await getTopCategories(prisma, 'daily');
    const c = findByName(rows, categoryName);
    expect(c).toBeTruthy();
    expect(c!.revenue).toBeCloseTo(500, 2);
  });

  it('getTopCollections attributes the line to the product collection', async () => {
    const rows = await getTopCollections(prisma, 'daily');
    const c = findByName(rows, collectionName);
    expect(c).toBeTruthy();
    expect(c!.revenue).toBeCloseTo(500, 2);
  });

  it('respects the limit on top products', async () => {
    const rows = await getTopProducts(prisma, 'daily', 1);
    expect(rows.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

`cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/analytics.items.test.ts` → FAIL (functions not exported).

- [ ] **Step 3: Append to `backend/src/modules/analytics/service.ts`**

```ts
async function liveItems(prisma: PrismaClient, period: Period) {
  return prisma.orderItem.findMany({
    where: { order: { ...LIVE_WHERE, createdAt: { gte: windowStart(period) } } },
    select: { productId: true, productName: true, quantity: true, lineTotal: true },
  });
}

export async function getTopProducts(prisma: PrismaClient, period: Period, limit = 10) {
  const items = await liveItems(prisma, period);
  const map = new Map<string, { name: string; units: number; revenue: number }>();
  for (const it of items) {
    const key = it.productId ?? `name:${it.productName}`;
    const cur = map.get(key) ?? { name: it.productName, units: 0, revenue: 0 };
    cur.units += it.quantity;
    cur.revenue += Number(it.lineTotal);
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
}

export async function getTopCategories(prisma: PrismaClient, period: Period) {
  const items = await liveItems(prisma, period);
  const ids = [...new Set(items.map((i) => i.productId).filter((x): x is string => !!x))];
  const products = ids.length
    ? await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, category: { select: { name: true } } } })
    : [];
  const catOf = new Map(products.map((p) => [p.id, p.category?.name ?? 'Uncategorized']));
  const map = new Map<string, { name: string; units: number; revenue: number }>();
  for (const it of items) {
    const name = (it.productId && catOf.get(it.productId)) || 'Uncategorized';
    const cur = map.get(name) ?? { name, units: 0, revenue: 0 };
    cur.units += it.quantity;
    cur.revenue += Number(it.lineTotal);
    map.set(name, cur);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

export async function getTopCollections(prisma: PrismaClient, period: Period) {
  const items = await liveItems(prisma, period);
  const ids = [...new Set(items.map((i) => i.productId).filter((x): x is string => !!x))];
  const products = ids.length
    ? await prisma.product.findMany({
        where: { id: { in: ids } },
        select: { id: true, collections: { where: { kind: 'COLLECTION' }, select: { name: true } } },
      })
    : [];
  const collOf = new Map(products.map((p) => [p.id, p.collections.map((c) => c.name)]));
  const map = new Map<string, { name: string; units: number; revenue: number }>();
  for (const it of items) {
    const names = (it.productId && collOf.get(it.productId)) || [];
    const targets = names.length ? names : ['None'];
    for (const name of targets) {
      const cur = map.get(name) ?? { name, units: 0, revenue: 0 };
      cur.units += it.quantity;
      cur.revenue += Number(it.lineTotal);
      map.set(name, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}
```

- [ ] **Step 4: Run the test — verify it passes**

`cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/analytics.items.test.ts` → PASS (4 tests).

- [ ] **Step 5: Full suite + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/analytics/service.ts backend/tests/analytics.items.test.ts
git commit -m "feat(analytics): item-level aggregations (top products/categories/collections)"
```
Expected: green (186 + 4 = 190).

---

### Task 4: Admin route + view + nav

**Files:**
- Create: `backend/src/modules/admin/analytics.ts`
- Create: `backend/src/modules/admin/views/analytics.eta`
- Modify: `backend/src/modules/admin/index.ts` (register the route)
- Modify: `backend/src/modules/admin/views/layout.eta` (nav link)
- Test: `backend/tests/admin.analytics.test.ts`

**Interfaces:**
- Consumes: all 8 service fns + `Period` (Tasks 2–3); `barChartSVG`/`lineChartSVG`/`hBarChartSVG`/`donutChartSVG`/`CHANNEL_COLORS` (Task 1); `renderPage`, `getUser`, `requireAdminSession`.
- Produces: `registerAdminAnalytics(app)`; `GET /admin/analytics?period=`.

- [ ] **Step 1: Create the route `backend/src/modules/admin/analytics.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { renderPage } from '../../lib/render';
import { getUser, requireAdminSession } from './guards';
import type { Period } from '../analytics/service';
import {
  getSummary, getSalesOverTime, getPeakHours, getPeakWeekdays,
  getTopProducts, getTopCategories, getTopCollections, getOrdersByChannel,
} from '../analytics/service';
import { barChartSVG, lineChartSVG, hBarChartSVG, donutChartSVG, CHANNEL_COLORS } from '../../lib/charts';

const PERIODS: readonly string[] = ['daily', 'weekly', 'monthly'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const taka = (n: number) => '৳' + Math.round(n).toLocaleString('en-US');

export function registerAdminAnalytics(app: FastifyInstance) {
  app.get('/admin/analytics', { preHandler: requireAdminSession }, async (req, reply) => {
    const user = getUser(req)!;
    const csrf = reply.generateCsrf();
    const raw = (req.query as { period?: string }).period ?? 'daily';
    const period: Period = (PERIODS.includes(raw) ? raw : 'daily') as Period;

    const [summary, sales, hours, weekdays, products, categories, collections, channels] = await Promise.all([
      getSummary(app.prisma, period),
      getSalesOverTime(app.prisma, period),
      getPeakHours(app.prisma, period),
      getPeakWeekdays(app.prisma, period),
      getTopProducts(app.prisma, period),
      getTopCategories(app.prisma, period),
      getTopCollections(app.prisma, period),
      getOrdersByChannel(app.prisma, period),
    ]);

    const charts = {
      sales: lineChartSVG(sales.map((s) => ({ label: s.label, value: s.revenue }))),
      hours: barChartSVG(hours.map((h) => ({ label: String(h.hour), value: h.orders })), { labelEvery: 3 }),
      weekdays: barChartSVG(weekdays.map((w) => ({ label: WEEKDAYS[w.weekday - 1], value: w.orders }))),
      products: hBarChartSVG(products.map((p) => ({ label: p.name, value: p.revenue, sub: `${taka(p.revenue)} · ${p.units}u` }))),
      categories: hBarChartSVG(categories.map((c) => ({ label: c.name, value: c.revenue, sub: taka(c.revenue) }))),
      collections: hBarChartSVG(collections.map((c) => ({ label: c.name, value: c.revenue, sub: taka(c.revenue) }))),
      channels: donutChartSVG(channels.map((c) => ({ label: c.source, value: c.orders, color: CHANNEL_COLORS[c.source] ?? '#7a736b' }))),
    };

    const totalCh = channels.reduce((s, c) => s + c.orders, 0);
    const channelLegend = channels.map((c) => ({
      source: c.source, orders: c.orders, revenue: taka(c.revenue),
      pct: totalCh ? Math.round((c.orders / totalCh) * 100) : 0,
      color: CHANNEL_COLORS[c.source] ?? '#7a736b',
    }));

    return renderPage(reply, {
      template: 'analytics', title: 'Analytics', user, active: 'analytics', csrf,
      data: {
        period,
        summary: { orders: summary.orders, revenue: taka(summary.revenue), aov: taka(summary.aov) },
        charts, channelLegend,
      },
    });
  });
}
```

- [ ] **Step 2: Create the view `backend/src/modules/admin/views/analytics.eta`**

NOTE: chart SVGs use eta's **raw** tag `<%~ %>` (Eta v3 unescaped output) — never `<%= %>` for them (that would show `&lt;svg`). The KPI/legend text uses `<%= %>` (escaped).

```html
<div class="toolbar">
  <div><h1>Analytics</h1><p class="sub">Insights over the selected period</p></div>
  <div class="seg">
    <a href="/admin/analytics?period=daily" class="btn sm <%= it.period==='daily' ? '' : 'ghost' %>">Daily</a>
    <a href="/admin/analytics?period=weekly" class="btn sm <%= it.period==='weekly' ? '' : 'ghost' %>">Weekly</a>
    <a href="/admin/analytics?period=monthly" class="btn sm <%= it.period==='monthly' ? '' : 'ghost' %>">Monthly</a>
  </div>
</div>

<div class="row">
  <div class="card"><div class="l">Orders</div><div class="n"><%= it.summary.orders %></div></div>
  <div class="card"><div class="l">Revenue</div><div class="n"><%= it.summary.revenue %></div></div>
  <div class="card"><div class="l">Avg order value</div><div class="n"><%= it.summary.aov %></div></div>
</div>

<div class="card" style="margin-top:24px"><h2>Sales over time</h2><%~ it.charts.sales %></div>

<div class="row" style="margin-top:24px">
  <div class="card"><h2>Peak hour of day</h2><%~ it.charts.hours %></div>
  <div class="card"><h2>Peak day of week</h2><%~ it.charts.weekdays %></div>
</div>

<div class="card" style="margin-top:24px"><h2>Top products</h2><%~ it.charts.products %></div>

<div class="row" style="margin-top:24px">
  <div class="card"><h2>Top categories</h2><%~ it.charts.categories %></div>
  <div class="card"><h2>Top collections</h2><%~ it.charts.collections %></div>
</div>

<div class="card" style="margin-top:24px">
  <h2>Orders by channel</h2>
  <div class="row" style="align-items:center">
    <div style="flex:0 0 220px;max-width:220px"><%~ it.charts.channels %></div>
    <div style="flex:1;min-width:200px">
      <table>
        <tbody>
          <% it.channelLegend.forEach(function (c) { %>
          <tr>
            <td><span style="display:inline-block;width:10px;height:10px;background:<%= c.color %>;margin-right:8px"></span><%= c.source %></td>
            <td><%= c.orders %> orders · <%= c.revenue %></td>
            <td class="muted"><%= c.pct %>%</td>
          </tr>
          <% }) %>
        </tbody>
      </table>
    </div>
  </div>
</div>

<style>
  .seg { display: flex; gap: 6px; }
  @media (max-width: 720px) {
    main { padding: 20px 16px !important; }
    .card { min-width: 100% !important; }
  }
</style>
```

- [ ] **Step 3: Add the nav link — `backend/src/modules/admin/views/layout.eta`**

After the Dashboard nav link, add:
```html
      <a href="/admin/analytics" class="<%= it.active==='analytics'?'active':'' %>">Analytics</a>
```
(Insert it immediately after the `<a href="/admin" ...>Dashboard</a>` line, before the Products link.)

- [ ] **Step 4: Register the route — `backend/src/modules/admin/index.ts`**

Add the import alongside the others:
```ts
import { registerAdminAnalytics } from './analytics';
```
And call it inside `registerAdmin(app)` (after `registerAdminDashboard(app);`):
```ts
  registerAdminAnalytics(app);
```

- [ ] **Step 5: Write the route test — `backend/tests/admin.analytics.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loginAdmin } from './helpers';

let app: FastifyInstance;
let cookie: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  cookie = await loginAdmin(app);
});
afterAll(async () => {
  await app.close();
});

describe('admin analytics page', () => {
  it('renders with an <svg> for the default period', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/analytics', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Analytics');
    expect(res.body).toContain('<svg'); // raw SVG emitted (not escaped &lt;svg)
    expect(res.body).not.toContain('&lt;svg');
  });

  it('accepts ?period=weekly and ?period=monthly', async () => {
    for (const p of ['weekly', 'monthly']) {
      const res = await app.inject({ method: 'GET', url: `/admin/analytics?period=${p}`, headers: { cookie } });
      expect(res.statusCode).toBe(200);
    }
  });

  it('falls back to daily on an invalid period', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/analytics?period=garbage', headers: { cookie } });
    expect(res.statusCode).toBe(200);
  });

  it('blocks unauthenticated access', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/analytics' });
    expect([302, 401, 403]).toContain(res.statusCode);
  });
});
```

- [ ] **Step 6: Run the route test — verify it passes**

`cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/admin.analytics.test.ts` → PASS (4 tests). If `<svg` is missing but `&lt;svg` present, the view used `<%= %>` instead of `<%~ %>` for a chart — fix the tag.

- [ ] **Step 7: Full suite + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/src/modules/admin/analytics.ts backend/src/modules/admin/views/analytics.eta backend/src/modules/admin/index.ts backend/src/modules/admin/views/layout.eta backend/tests/admin.analytics.test.ts
git commit -m "feat(admin): analytics dashboard route + view + nav (/admin/analytics)"
```
Expected: green (190 + 4 = 194).

---

### Task 5: Verification sweep + memory

**Files:**
- Modify: `C:\Users\PC\.claude\projects\D--Roots---Rings\memory\MEMORY.md` + new `roots-rings-phase13-analytics.md`

- [ ] **Step 1: Full backend suite**

`cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run` → expect green (194). Frontend untouched (still 53).

- [ ] **Step 2: Live verification (controller-run)** — start the backend, log into `/admin`, open **Analytics** in the sidebar:
  1. The KPI cards (Orders / Revenue ৳ / AOV) render numbers.
  2. Toggle **Daily / Weekly / Monthly** — the URL gains `?period=…`, the active button highlights, charts update.
  3. Sales line, peak-hour (24 bars) + peak-weekday (7 bars), top products/categories/collections (horizontal bars), and the channel donut + legend all render.
  4. Narrow the window to phone width — SVGs scale down and cards stack (no horizontal overflow of the charts).
  5. On a fresh/empty window (e.g. a period with no orders), charts show "No data yet" rather than breaking.

- [ ] **Step 3: Update memory** — create `roots-rings-phase13-analytics.md` (analytics service: 8 aggregations, live-order filter, Dhaka +6h bucketing, preset windows; `lib/charts.ts` pure SVG generators; `/admin/analytics` route + eta view using `<%~ %>` raw for SVG; channel = Phase 12 `Order.source`) + a one-line pointer in `MEMORY.md`.

- [ ] **Step 4: Report** the final test counts + live-verification results.

---

## Self-Review

**1. Spec coverage** (spec §2–§8 → tasks):
- §3 aggregation service — 8 functions: order-level 5 (Task 2), item-level 3 (Task 3). ✅
- §4 SVG helpers — bar/line/hbar/donut + palette + esc + empty-state (Task 1). ✅
- §5 route + view + nav + register (Task 4). ✅
- §6 security — admin-only + read-only + no user string in SQL (only `period`, mapped to a fixed set) + all SVG labels escaped in `charts.ts` + raw tag noted (Tasks 1, 2, 4). ✅
- §7 testing — charts unit (Task 1), service seeded/delta (Tasks 2–3), route (Task 4), regression + live (Task 5). ✅
- §8 file structure — matches Tasks 1–4 exactly. ✅
- §0 decisions — SVG (Task 1), live orders (`LIVE_WHERE`/`LIVE_SQL`, Task 2), preset windows (`windowStart`, Task 2), Dhaka +6h (`BD`, Task 2), channel = `Order.source` (`getOrdersByChannel`, Task 2). ✅

**2. Placeholder scan:** every code step has complete code; every test step has real assertions; live checks are concrete. No TBD/TODO.

**3. Type consistency:** `Period` defined in Task 2, imported by Tasks 3 (`liveItems`) and 4 (route). `windowStart`/`LIVE_WHERE` defined Task 2, consumed Task 3. The 8 service fns' return shapes (`{ orders, revenue, aov }`, `{ label, orders, revenue }[]`, `{ hour, orders }[]`, `{ weekday, orders }[]`, `{ source, orders, revenue }[]`, `{ name, units, revenue }[]`) match exactly how Task 4 maps them into `Datum`/`Segment` for the chart helpers. `Datum {label,value,sub?}` / `Segment {label,value,color}` / `CHANNEL_COLORS` defined Task 1, consumed Task 4. `barChartSVG`/`lineChartSVG`/`hBarChartSVG`/`donutChartSVG` signatures identical across Task 1 (def) and Task 4 (call). Weekday indexing (1=Sun..7=Sat) is consistent between `getPeakWeekdays` (DAYOFWEEK), the Task 2 test, and the route's `WEEKDAYS[w.weekday-1]`. ✅
