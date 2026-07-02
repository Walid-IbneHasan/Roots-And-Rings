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
